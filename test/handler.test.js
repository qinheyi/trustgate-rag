import { test } from "node:test";
import assert from "node:assert/strict";
import { handleRun, configPayload, DEMO_BANNER } from "../lib/handler.js";
import { samplePipeline } from "../lib/samples.js";
import { getScenario } from "../lib/scenarios.js";

test("without CLOCKED_API_KEY the app is in clearly labelled demo mode", async () => {
  const cfg = configPayload({});
  assert.equal(cfg.live, false);
  assert.match(cfg.banner, /^Demo mode \(sample responses\)/);
  const out = await handleRun({ scenarioId: "double-charge" }, { env: {} });
  assert.equal(out.status, 200);
  assert.equal(out.json.mode, "demo");
  assert.equal(out.json.banner, DEMO_BANNER);
  assert.ok(out.json.trace.calls.every((c) => c.sample));
});

test("demo mode refuses custom input instead of faking results", async () => {
  const out = await handleRun({ question: "anything", documents: [{ id: "x", text: "y" }] }, { env: {} });
  assert.equal(out.status, 400);
});

test("with a key, live mode calls the injected Clocked client (never samples)", async () => {
  const scn = getScenario("double-charge");
  const seen = [];
  const out = await handleRun({ scenarioId: "double-charge" }, {
    env: { CLOCKED_API_KEY: "test" },
    clocked: async (endpoint, body) => { seen.push(endpoint); const r = samplePipeline(scn, body); delete r.result._sample; return { result: r.result, meta: { cost: { credits: 5 } } }; },
    generate: async () => ({ text: "The duplicate charge is refunded automatically to your original payment method within 5-7 business days.", generator: "test", sample: false }),
  });
  assert.equal(out.json.mode, "live");
  assert.equal(out.json.banner, null);
  assert.deepEqual(seen, ["pipeline", "pipeline"]);
  assert.ok(out.json.trace.calls.every((c) => c.sample === false));
  assert.equal(configPayload({ CLOCKED_API_KEY: "x" }).live, true);
});

test("live mode validates input", async () => {
  const out = await handleRun({ question: "", documents: [] }, { env: { CLOCKED_API_KEY: "t" }, clocked: async () => { throw new Error("should not be called"); } });
  assert.equal(out.status, 400);
});

test("rate limiter allows a bounded number of live runs per window", async () => {
  const { allow } = await import("../lib/ratelimit.js");
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(allow("ip-test", { limit: 3, now }), true);
  assert.equal(allow("ip-test", { limit: 3, now }), false);
  assert.equal(allow("ip-test", { limit: 3, now: now + 11 * 60_000 }), true);
});
