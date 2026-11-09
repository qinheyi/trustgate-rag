// Smoke test: `npm run smoke` (starts the local server) or `npm run smoke -- https://your-deployment`.
// Checks the page, /api/config and a full /api/run for every built-in scenario.
import { createServer } from "./dev-server.js";

let base = process.argv[2];
let server;
if (!base) {
  server = createServer();
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
}
const fail = (m) => { console.error(`FAIL ${m}`); process.exitCode = 1; };
const ok = (m) => console.log(`ok   ${m}`);

try {
  const page = await fetch(base + "/");
  const html = await page.text();
  page.ok && html.includes("TrustGate") ? ok(`GET / (${page.status})`) : fail(`GET / ${page.status}`);
  for (const asset of ["/app.js", "/styles.css"]) {
    const r = await fetch(base + asset);
    r.ok ? ok(`GET ${asset}`) : fail(`GET ${asset} ${r.status}`);
  }
  const cfg = await (await fetch(base + "/api/config")).json();
  ok(`GET /api/config live=${cfg.live} llm=${cfg.llm} scenarios=${cfg.scenarios.length}`);
  if (!cfg.live && !/^Demo mode \(sample responses\)/.test(cfg.banner || "")) fail("demo banner missing");
  const expected = { "double-charge": "sent_with_edits", "not-in-kb": "handoff" };
  for (const s of cfg.scenarios) {
    const t0 = Date.now();
    const r = await fetch(base + "/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cfg.live ? { scenarioId: s.id } : { scenarioId: s.id, mode: "demo" }) });
    const j = await r.json();
    if (!r.ok) { fail(`POST /api/run ${s.id}: ${r.status} ${JSON.stringify(j)}`); continue; }
    const tr = j.trace;
    const calls = tr.calls.map((c) => `${c.endpoint}${c.sample ? "(sample)" : ""}${c.meta?.cost?.credits !== undefined ? `[${c.meta.cost.credits}cr]` : ""}${c.error ? `[ERR ${c.error.status}]` : ""}`).join(",");
    const line = `POST /api/run ${s.id}: mode=${j.mode} status=${tr.final.status} calls=${calls} selected=${tr.preflight?.selected?.join("|")} ${Date.now() - t0}ms`;
    if (tr.error) fail(`${line} error=${tr.error.message}`);
    else if (!cfg.live && tr.final.status !== expected[s.id]) fail(`${line} (expected ${expected[s.id]})`);
    else ok(line);
    if (cfg.live) console.log(`     reply: ${tr.final.text}`);
  }
  const bad = await fetch(base + "/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: "x", documents: [] }) });
  bad.status === 400 ? ok("POST /api/run invalid input → 400") : fail(`invalid input → ${bad.status}`);
} finally {
  server?.close();
}
