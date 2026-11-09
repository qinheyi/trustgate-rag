// TrustGate UI — vanilla JS. All source text is escaped before rendering (docs: Security & data handling).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = (x) => (typeof x === "number" ? `${(x * 100).toFixed(1)}%` : "—");
const p3 = (x) => (typeof x === "number" ? x.toFixed(3) : "—");

let CONFIG = null;
let current = null; // {scenarioId, question, documents, context}

// Highlight code-point spans in text. spans: [{start,end,cls,label}]
function highlight(text, spans) {
  const cps = Array.from(String(text ?? ""));
  const sorted = [...(spans || [])].filter((s) => Number.isInteger(s.start) && Number.isInteger(s.end) && s.end > s.start).sort((a, b) => a.start - b.start);
  let out = "", pos = 0;
  for (const s of sorted) {
    if (s.start < pos) continue; // skip overlaps
    out += esc(cps.slice(pos, s.start).join(""));
    out += `<mark class="${s.cls}" title="${esc(s.title || "")}">${esc(cps.slice(s.start, s.end).join(""))}${s.label ? `<span class="t">${esc(s.label)}</span>` : ""}</mark>`;
    pos = s.end;
  }
  return out + esc(cps.slice(pos).join(""));
}

const bar = (x, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(1, x || 0)) * 100}%;background:${color}"></i></div>`;
const LEVEL_COLORS = { answers: "#10b981", elsewhere: "#60a5fa", already_given: "#a78bfa", different_case: "#f59e0b", unrelated: "#475569" };
const CLAIM_COLORS = { supported: "#10b981", contradicted: "#f43f5e", not_stated: "#f59e0b", not_a_claim: "#475569" };
function stack(obj, colors) {
  return `<div class="stack">${Object.entries(colors).filter(([k]) => typeof obj?.[k] === "number").map(([k, c]) => `<i title="${k} ${pct(obj[k])}" style="width:${obj[k] * 100}%;background:${c}"></i>`).join("")}</div>`;
}
const legend = (colors) => `<div class="legend">${Object.entries(colors).map(([k, c]) => `<span style="--c:${c}">${k}</span>`).join("")}</div>`;
const sampleTag = () => (CONFIG?.live ? "" : ` <span class="chip sample">SAMPLE RESPONSE</span>`);

// ---------------------------------------------------------------- input panel
async function init() {
  CONFIG = await fetch("/api/config").then((r) => r.json());
  const badge = $("#modeBadge");
  if (CONFIG.live) { badge.textContent = "LIVE · real Clocked API calls"; badge.className = "badge live"; }
  else {
    badge.textContent = "DEMO MODE · sample responses"; badge.className = "badge demo";
    $("#banner").innerHTML = `<b>Demo mode (sample responses).</b> ${esc(CONFIG.banner.replace(/^Demo mode \(sample responses\):\s*/, ""))}`;
    $("#banner").classList.remove("hidden");
  }
  $("#scenarioTabs").innerHTML = CONFIG.scenarios.map((s) => `<button class="tab" data-id="${esc(s.id)}">${esc(s.label)}</button>`).join("");
  $("#scenarioTabs").addEventListener("click", (e) => { const id = e.target?.dataset?.id; if (id) selectScenario(id); });
  $("#run").addEventListener("click", run);
  $("#addDoc").addEventListener("click", () => { syncFromForm(); current.documents.push({ id: `doc-${current.documents.length + 1}`, title: "", text: "" }); renderDocs(); });
  if (CONFIG.live) { $("#addDoc").classList.remove("hidden"); $("#editNote").textContent = "Live mode: edit the question and passages freely (max 8 passages, synthetic data only)."; }
  else { $("#editNote").textContent = "Demo mode runs the built-in scenarios only; editing is enabled when a Clocked API key is configured."; }
  const params = new URLSearchParams(location.search);
  const want = CONFIG.scenarios.find((x) => x.id === params.get("scenario"));
  selectScenario((want || CONFIG.scenarios[0]).id);
  if (params.get("run") === "1") run();
}

function selectScenario(id) {
  const s = CONFIG.scenarios.find((x) => x.id === id);
  current = { scenarioId: s.id, question: s.question, context: s.context, documents: s.documents.map((d) => ({ ...d })) };
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.id === id));
  $("#scenarioBlurb").textContent = s.blurb + (s.context ? `  Customer context: ${Object.entries(s.context).map(([k, v]) => `${k}=${v}`).join(", ")}.` : "");
  $("#question").value = s.question;
  $("#question").readOnly = !CONFIG.live;
  renderDocs();
}

function renderDocs() {
  const ro = !CONFIG.live;
  $("#docs").innerHTML = current.documents.map((d, i) => `
    <div class="doc" data-i="${i}">
      ${ro ? "" : `<button class="rm" title="remove" data-rm="${i}">✕</button>`}
      <div class="id">${esc(d.id)}</div>
      <div class="meta">${esc(d.title || "")}${d.metadata ? ` · ${esc(Object.entries(d.metadata).map(([k, v]) => `${k}: ${v}`).join(" · "))}` : ""}</div>
      ${ro ? `<div class="src" style="margin:0">${esc(d.text)}</div>` : `<textarea data-f="text">${esc(d.text)}</textarea>`}
    </div>`).join("");
  document.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { syncFromForm(); current.documents.splice(Number(b.dataset.rm), 1); renderDocs(); }));
}

function syncFromForm() {
  if (!CONFIG.live) return;
  current.question = $("#question").value;
  document.querySelectorAll(".doc").forEach((el) => { const i = Number(el.dataset.i); const ta = el.querySelector("textarea"); if (ta) current.documents[i].text = ta.value; });
}

async function run() {
  syncFromForm();
  const btn = $("#run");
  btn.disabled = true; btn.textContent = CONFIG.live ? "Calling Clocked…" : "Loading sample run…";
  try {
    const body = CONFIG.live ? { scenarioId: current.scenarioId, question: current.question, documents: current.documents, context: current.context } : { scenarioId: current.scenarioId, mode: "demo" };
    const res = await fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error + (json.details ? `: ${json.details.join("; ")}` : ""));
    render(json);
  } catch (e) {
    $("#results").classList.remove("hidden");
    $("#finalPanel").innerHTML = `<h2>Request failed</h2><p class="err">${esc(e.message)}</p>`;
  } finally { btn.disabled = false; btn.textContent = "Run through TrustGate →"; }
}

// ---------------------------------------------------------------- results
function render(resp) {
  const { trace, input } = resp;
  const pre = trace.preflight, post = trace.postcheck;
  $("#results").classList.remove("hidden");
  renderFlow(trace);
  renderFinal(trace);
  renderProtectIn(input, pre);
  renderGuard(input, pre);
  renderRerank(input, pre);
  renderCompare(input, pre);
  renderVerify(input, trace);
  renderProtectOut(trace);
  renderRaw(trace);
  if (!new URLSearchParams(location.search).get("run")) $("#flow").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderFlow(trace) {
  const pre = trace.preflight, post = trace.postcheck, f = trace.final;
  const nodes = [];
  const n = (nm, ep, cls, st) => nodes.push(`<div class="node ${cls}"><div class="ep">${ep}</div><div class="nm">${nm}</div><div class="st">${st}</div></div>`);
  if (!pre) { n("Pipeline #1", "/pipeline", "bad", "failed"); }
  else {
    const pii = pre.questionPii?.entities?.length ?? 0;
    n("Protect", "/pii · question", pre.maskedQuestion === null ? "bad" : pii ? "warn" : "ok", pre.maskedQuestion === null ? "failed" : pii ? `${pii} masked` : "clean");
    const q = pre.guards.filter((g) => g.flagged).length;
    n("Guard", "/injection × " + pre.guards.length, q ? "bad" : "ok", q ? `${q} quarantined` : "all benign");
    const use = pre.ranking.filter((r) => r.action === "use").length;
    n("Rerank", "/rerank", pre.ranking.length ? "ok" : "bad", pre.ranking.length ? `${use} use · ${pre.ranking.length - use} other` : "failed");
    n("Coverage", "decide question", pre.coverage?.choice === "answered" ? "ok" : pre.coverage ? "warn" : "off", pre.coverage?.choice || "—");
    n("Compare", "/compare", pre.conflicts.length ? "warn" : pre.conflictCheck ? "ok" : "off", pre.conflicts.length ? `${pre.conflicts.length} conflict` : pre.conflictCheck ? "no conflict" : "—");
  }
  n("Draft", trace.draft?.generator || "LLM", trace.draft ? "ok" : "off", trace.draft ? (trace.draft.generator === "sample" ? "sample draft" : trace.draft.generator) : "skipped");
  if (post?.grounding) {
    const cut = post.claims.filter((c) => c.removedFor === "verify").length;
    n("Verify", "/grounding", cut ? "warn" : "ok", cut ? `${cut} claim cut` : "all supported");
    const pe = post.piiEntities.length;
    n("Protect", "/pii · draft", pe ? "warn" : "ok", pe ? `${pe} found` : "clean");
  } else { n("Verify", "/grounding", "off", "skipped"); n("Protect", "/pii · draft", "off", "skipped"); }
  n("Reply", "to customer", f.status === "sent" ? "ok" : f.status === "handoff" ? "warn" : "warn", f.status.replace(/_/g, " "));
  $("#flow").innerHTML = nodes.join("");
  $("#flow").classList.remove("hidden");
}

function renderFinal(trace) {
  const f = trace.final;
  const cls = f.status === "sent" ? "sent" : f.status === "handoff" ? "handoff" : "edits";
  const chip = f.status === "sent" ? `<span class="chip c-green">SENT</span>` : f.status === "handoff" ? `<span class="chip c-violet">HANDED OFF TO A PERSON</span>` : `<span class="chip c-amber">SENT WITH EDITS</span>`;
  let draftHtml = "";
  if (trace.postcheck?.claims?.length) {
    draftHtml = `<details><summary>Compare with the raw LLM draft (what a bot without TrustGate would have sent)</summary><div class="src draft">${trace.postcheck.claims.map((c) => (c.keep ? esc(c.text) : `<s title="${c.removedFor === "pii" ? "removed: personal data" : `removed: ${esc(c.verdict)}`}">${esc(c.text)}</s>`)).join(" ")}</div></details>`;
  }
  $("#finalPanel").className = `panel final ${cls}`;
  $("#finalPanel").innerHTML = `
    <h2>Reply to the customer ${chip}${trace.mode === "demo" ? ` <span class="chip sample">DEMO · BUILT FROM SAMPLE RESPONSES</span>` : ""}</h2>
    <div class="reply">${esc(f.text)}</div>
    ${f.reasons?.length ? `<div class="muted small">Why: ${esc(f.reasons.join(" · "))}</div>` : ""}
    ${f.review?.length ? `<h3>Agent review queue</h3><ul class="list">${f.review.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : ""}
    ${draftHtml}
    ${trace.error ? `<p class="err">Error: ${esc(trace.error.message)}</p>` : ""}
    <h3>Decision log</h3><ul class="list">${[...(trace.preflight?.log || []), ...(trace.postcheck?.log || [])].map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
}

function renderProtectIn(input, pre) {
  // pre.mode is "handoff" when no draft will be generated
  const el = $("#stageProtectIn");
  if (!pre) { el.innerHTML = ""; return; }
  const ents = pre.questionPii?.entities || [];
  el.innerHTML = `<h2><span class="num">P</span> Protect · question <code>/pii</code>${sampleTag()}</h2>
    <div class="src">${highlight(input.question, ents.map((e) => ({ start: e.start, end: e.end, cls: "pii", label: e.type, title: `confidence ${e.confidence}` })))}</div>
    <h3>${pre.mode === "handoff" ? "Masked copy (no draft was generated)" : "Sent to the LLM instead"}</h3><div class="src">${esc(pre.maskedQuestion ?? "(masking failed — nothing sent)")}</div>`;
}

function renderGuard(input, pre) {
  const el = $("#stageGuard");
  if (!pre) { el.innerHTML = ""; return; }
  el.innerHTML = `<h2><span class="num">G</span> Guard · every passage <code>/injection</code>${sampleTag()}</h2>
    <table><tr><th>passage</th><th>verdict</th><th>injection</th><th>category · severity</th></tr>
    ${pre.guards.map((g) => `<tr><td><code>${esc(g.id)}</code></td><td>${g.ok ? (g.flagged ? `<span class="chip c-red">QUARANTINED</span>` : `<span class="chip c-green">benign</span>`) : `<span class="chip c-red">NOT SCREENED</span>`}</td>
      <td>${g.ok ? `${bar(g.injection, g.flagged ? "#f43f5e" : "#10b981")}<span class="prob">${p3(g.injection)}</span>` : esc(g.error)}</td><td class="small">${esc(g.category || "")}${g.severity ? ` · ${esc(g.severity)}` : ""}</td></tr>`).join("")}</table>
    ${pre.guards.filter((g) => g.flagged && g.ok).map((g) => { const d = input.documents.find((x) => x.id === g.id); return `<h3>Evidence in ${esc(g.id)}</h3><div class="src">${highlight(d?.text, (g.evidence || []).map((e) => ({ start: e.start, end: e.end, cls: "inj", title: `confidence ${e.confidence}` })))}</div>`; }).join("")}`;
}

function renderRerank(input, pre) {
  const el = $("#stageRerank");
  if (!pre) { el.innerHTML = ""; return; }
  const chip = (r) => r.action === "use" ? (r.quarantined ? `<span class="chip c-red">use → blocked</span>` : pre.selected.includes(r.id) ? `<span class="chip c-green">use</span>` : `<span class="chip c-amber">use → dropped</span>`) : r.action === "expand" ? `<span class="chip c-blue">expand</span>` : `<span class="chip c-gray">skip · ${esc(r.reason)}</span>`;
  const cov = pre.coverage;
  el.innerHTML = `<h2><span class="num">R</span> Rerank · use / expand / skip <code>/rerank</code>${sampleTag()}</h2>
    ${legend(LEVEL_COLORS)}
    <table><tr><th>#</th><th>passage</th><th>action</th><th>relevance</th><th>levels</th><th>what TrustGate did</th></tr>
    ${pre.ranking.map((r, i) => { const why = pre.dropped.find((d) => d.id === r.id); return `<tr><td>${i + 1}</td><td><code>${esc(r.id)}</code></td><td>${chip(r)}</td><td><span class="prob">${p3(r.relevance_score)}</span></td><td>${stack(r.levels, LEVEL_COLORS)}</td><td class="small">${pre.selected.includes(r.id) ? "→ sent to the LLM" : esc(why?.why || "")}</td></tr>`; }).join("")}</table>
    <h3>Coverage decision (Decide question answered by Rerank over the whole set)</h3>
    ${cov ? `<div class="kv"><span>choice <b>${esc(cov.choice)}</b></span><span>confidence <b>${p3(cov.confidence)}</b></span></div>
      <table>${Object.entries(cov.probabilities || {}).map(([k, v]) => `<tr><td style="width:160px">${esc(k)}</td><td>${bar(v, k === cov.choice ? "#10b981" : "#475569")}</td><td class="prob">${p3(v)}</td></tr>`).join("")}</table>
      <p class="muted small">answered → reply · partial → reply + hand the rest to a person · not_established → hand off without drafting.</p>` : `<p class="muted">No coverage answer.</p>`}`;
}

function renderCompare(input, pre) {
  const el = $("#stageCompare");
  if (!pre || !pre.conflictCheck) { el.innerHTML = pre ? `<h2><span class="num">C</span> Compare <code>/compare</code></h2><p class="muted">Not run (needs 2+ passages) or failed.</p>` : ""; return; }
  const docText = (id) => input.documents.find((d) => d.id === id)?.text || "";
  const docDate = (id) => input.documents.find((d) => d.id === id)?.metadata?.updated;
  el.innerHTML = `<h2><span class="num">C</span> Compare · conflicting passages <code>/compare</code>${sampleTag()}</h2>
    <div class="kv"><span>roll-up verdict <b>${esc(pre.conflictCheck.verdict)}</b></span><span>conflicting pairs <b>${pre.conflicts.length}</b></span></div>
    ${pre.conflicts.length ? pre.conflicts.map((c) => `
      <div class="kv"><span><code>${esc(c.a)}</code> ↔ <code>${esc(c.b)}</code></span><span>conflicting <b>${p3(c.probabilities?.conflicting)}</b></span>
      <span>${c.resolution?.keep ? `<span class="chip c-green">kept ${esc(c.resolution.keep)} (${esc(docDate(c.resolution.keep))})</span> <span class="chip c-red">dropped ${esc(c.resolution.drop)} (${esc(docDate(c.resolution.drop))})</span>` : c.resolution?.unresolved ? `<span class="chip c-amber">unresolved → review</span>` : `<span class="chip c-gray">not both in use</span>`}</span></div>
      <div class="pair"><div><div class="muted small">${esc(c.a)}</div><div class="src">${highlight(docText(c.a), c.findings.map((f) => ({ start: f.a?.start, end: f.a?.end, cls: "conf" })))}</div></div>
      <div><div class="muted small">${esc(c.b)}</div><div class="src">${highlight(docText(c.b), c.findings.map((f) => ({ start: f.b?.start, end: f.b?.end, cls: "conf" })))}</div></div></div>`).join("") : `<p class="muted">No conflicts between the passages.</p>`}`;
}

function renderVerify(input, trace) {
  const el = $("#stageVerify"), post = trace.postcheck;
  if (!post?.grounding) { el.innerHTML = `<h2><span class="num">V</span> Verify <code>/grounding</code></h2><p class="muted">${trace.draft ? "Verification failed — handed off." : "Skipped: no draft was generated."}</p>`; return; }
  const g = post.grounding;
  el.innerHTML = `<h2><span class="num">V</span> Verify · every sentence of the draft <code>/grounding</code>${sampleTag()}</h2>
    <div class="kv"><span>draft by <b>${esc(trace.draft.generator)}${trace.draft.model ? ` (${esc(trace.draft.model)})` : ""}</b></span><span>grounded <b>${p3(g.grounded)}</b></span><span>verdict <b>${esc(g.verdict)}</b></span><span>threshold <b>${p3(g.threshold)}</b></span><span>answers_question <b>${p3(g.answers_question)}</b></span></div>
    ${trace.draft.sample ? `<p class="muted small">The draft below is a fixed sample text (no LLM call in demo mode).</p>` : ""}
    ${trace.draft.note ? `<p class="muted small">${esc(trace.draft.note)}</p>` : ""}
    ${legend(CLAIM_COLORS)}
    ${post.claims.map((c) => {
      const d = c.evidence ? input.documents.find((x) => x.id === c.evidence.document) : null;
      const cls = c.keep ? "kept" : c.removedFor === "pii" ? "piicut" : "cut";
      const tag = c.keep ? `<span class="chip c-green">kept</span>` : c.removedFor === "pii" ? `<span class="chip c-violet">removed · personal data</span>` : `<span class="chip c-red">removed · ${esc(c.verdict)}</span>`;
      return `<div class="claim ${cls}"><div class="kv"><span>${tag}</span><span>supported <b>${p3(c.supported)}</b></span><span>contradicted <b>${p3(c.contradicted)}</b></span><span>not stated <b>${p3(c.not_stated)}</b></span></div>
        <div class="txt">${esc(c.text)}</div>${stack(c, CLAIM_COLORS)}
        ${d ? `<details><summary>evidence in <code>${esc(d.id)}</code> (confidence ${p3(c.evidence.confidence)})</summary><div class="src">${highlight(d.text, [{ start: c.evidence.start, end: c.evidence.end, cls: "ev" }])}</div></details>` : `<div class="muted small">No supporting passage in the kept sources.</div>`}</div>`;
    }).join("")}`;
}

function renderProtectOut(trace) {
  const el = $("#stageProtectOut"), post = trace.postcheck;
  if (!post?.grounding) { el.innerHTML = ""; return; }
  el.innerHTML = `<h2><span class="num">P</span> Protect · the draft <code>/pii</code>${sampleTag()}</h2>
    <p class="muted small">Grounded is not the same as safe: a sentence can be supported by an internal note and still leak a colleague's contact details.</p>
    <div class="src">${highlight(trace.draft.text, post.piiEntities.map((e) => ({ start: e.start, end: e.end, cls: "pii", label: e.type })))}</div>
    <h3>Stored in the transcript (anonymized_text)</h3><div class="src">${esc(post.transcript ?? "")}</div>`;
}

function renderRaw(trace) {
  $("#stageRaw").innerHTML = `<h2>Raw Clocked requests &amp; responses${trace.mode === "demo" ? ` <span class="chip sample">SAMPLE RESPONSES — NOT LIVE</span>` : ""}</h2>
    ${trace.calls.map((c) => `<details><summary><code>POST /clocked/${esc(c.endpoint)}</code> — ${esc(c.label)}${c.meta?.cost?.credits !== undefined ? ` · ${c.meta.cost.credits} credits · $${c.meta.cost.costUsd} (${esc(c.meta.cost.costBasis || "")})` : ""}${c.error ? ` · <span class="err">${esc(c.error.message)}</span>` : ""}</summary>
      <h3>request</h3><pre>${esc(JSON.stringify(c.request, null, 2))}</pre><h3>response${c.sample ? " (sample)" : ""}</h3><pre>${esc(JSON.stringify(c.response ?? c.error, null, 2))}</pre></details>`).join("")}`;
}

init().catch((e) => { document.body.insertAdjacentHTML("beforeend", `<p class="err" style="padding:20px">Failed to load: ${esc(e.message)}</p>`); });
