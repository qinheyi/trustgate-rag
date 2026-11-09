import { test } from "node:test";
import assert from "node:assert/strict";
import { callClocked, readCostHeaders, ClockedError } from "../lib/clocked.js";

function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: r.headers || {} });
  };
  fn.calls = calls;
  return fn;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

test("sends the three required headers to https://clocked.rezolve.ai/clocked/<endpoint>", async () => {
  const f = fakeFetch([{ status: 200, body: { model: "clocked-1.0" }, headers: { "X-Clocked-Credits": "12", "X-Clocked-Cost-Usd": "0.003", "X-Clocked-Cost-Basis": "reference" } }]);
  const { result, meta } = await callClocked("pii", { text: "x" }, { apiKey: "test-key", fetch: f });
  assert.equal(result.model, "clocked-1.0");
  assert.equal(f.calls[0].url, "https://clocked.rezolve.ai/clocked/pii");
  const h = f.calls[0].init.headers;
  assert.equal(h.Authorization, "Bearer test-key");
  assert.equal(h["Content-Type"], "application/json");
  assert.match(h["Idempotency-Key"], UUID);
  assert.deepEqual(meta.cost, { credits: 12, costUsd: 0.003, costBasis: "reference" });
});

test("retries 503 and network errors with the SAME idempotency key and identical payload", async () => {
  const f = fakeFetch([new TypeError("socket hang up"), { status: 503, body: { error: "busy" } }, { status: 200, body: { ok: 1 } }]);
  const { meta } = await callClocked("rerank", { query: "q", documents: ["a"] }, { apiKey: "k", fetch: f, backoffMs: 1 });
  assert.equal(meta.attempts, 3);
  const keys = new Set(f.calls.map((c) => c.init.headers["Idempotency-Key"]));
  const bodies = new Set(f.calls.map((c) => c.init.body));
  assert.equal(keys.size, 1);
  assert.equal(bodies.size, 1);
});

test("does not retry 400/401/402 and stops when retryAsNew is true", async () => {
  for (const status of [400, 401, 402, 422]) {
    const f = fakeFetch([{ status, body: { error: "nope" } }]);
    await assert.rejects(callClocked("pii", { text: "x" }, { apiKey: "k", fetch: f, backoffMs: 1 }), (e) => e instanceof ClockedError && e.status === status);
    assert.equal(f.calls.length, 1);
  }
  const f = fakeFetch([{ status: 500, body: { error: "ended", retryAsNew: true } }]);
  await assert.rejects(callClocked("pii", { text: "x" }, { apiKey: "k", fetch: f, backoffMs: 1 }), (e) => e.retryAsNew === true);
  assert.equal(f.calls.length, 1);
});

test("429 is retried with bounded attempts", async () => {
  const f = fakeFetch([{ status: 429, body: { error: "slow down" } }]);
  await assert.rejects(callClocked("pii", { text: "x" }, { apiKey: "k", fetch: f, backoffMs: 1, maxAttempts: 3 }), (e) => e.status === 429);
  assert.equal(f.calls.length, 3);
});

test("refuses to call without a key and rejects unknown endpoints", async () => {
  await assert.rejects(callClocked("pii", {}, { apiKey: "" }), /CLOCKED_API_KEY/);
  await assert.rejects(callClocked("summarize", {}, { apiKey: "k" }), /Unknown Clocked endpoint/);
});

test("readCostHeaders ignores missing headers", () => {
  assert.deepEqual(readCostHeaders(new Headers({ "x-clocked-transport": "replay" })), { transport: "replay" });
});
