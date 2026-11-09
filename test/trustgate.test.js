import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPreflight, interpretPreflight, buildPostcheck, interpretPostcheck, runTrustGate, validateInput, HANDOFF_REPLY } from "../lib/trustgate.js";
import { getScenario } from "../lib/scenarios.js";
import { samplePipeline, sampleDraft } from "../lib/samples.js";

const DOCS = JSON.parse(readFileSync(new URL("./fixtures/docs-recorded.json", import.meta.url)));
const scn = getScenario("double-charge");

test("pipeline #1 has pii, one injection step per passage (source content), rerank with coverage question, compare", () => {
  const body = buildPreflight(scn);
  assert.equal(body.text, scn.question);
  assert.equal(body.on_error, "continue");
  assert.ok(body.steps.length <= 16);
  const eps = body.steps.map((s) => Object.keys(s).find((k) => k !== "name" && k !== "stop"));
  assert.deepEqual(eps, ["pii", ...scn.documents.map(() => "injection"), "rerank", "compare"]);
  for (const [i, d] of scn.documents.entries()) {
    const st = body.steps[i + 1];
    assert.equal(st.name, `guard:${d.id}`);
    assert.equal(st.injection.text, d.text);
    assert.equal(st.injection.source, "content");
  }
  const rr = body.steps.at(-2).rerank;
  assert.equal(rr.query, scn.question);
  assert.equal(rr.documents.length, scn.documents.length);
  assert.equal(rr.questions.coverage.type, "choice");
  assert.ok(Object.keys(rr.questions.coverage.criteria).includes("not_established"));
  assert.equal(body.steps.at(-1).compare.documents.length, scn.documents.length);
  assert.equal(body.steps[0].pii.anonymize, "replace");
});

test("compare is omitted for a single passage", () => {
  const body = buildPreflight({ question: "q", documents: [{ id: "a", text: "t" }] });
  assert.ok(!body.steps.some((s) => s.compare));
});

test("demo run: guard quarantines the poisoned post, compare drops the outdated policy, verify cuts the invented credit, pii cuts the leaked contact", async () => {
  const t = await runTrustGate(scn, { mode: "demo", clocked: async (e, b) => samplePipeline(scn, b), generate: async () => sampleDraft(scn.id) });
  assert.equal(t.error, null);
  assert.deepEqual(t.preflight.selected, ["refund-policy-2026"]);
  assert.ok(t.preflight.guards.find((g) => g.id === "community-thread-8812").flagged);
  assert.ok(t.preflight.maskedQuestion.includes("<PERSON>"));
  assert.ok(!t.preflight.maskedQuestion.includes("Maria Lopez"));
  assert.equal(t.final.status, "sent_with_edits");
  assert.ok(!t.final.text.includes("$20"));
  assert.ok(!t.final.text.includes("Dana"));
  assert.ok(t.final.text.includes("5-7 business days"));
  assert.equal(t.calls.length, 2);
  assert.ok(t.calls.every((c) => c.sample === true && c.response._sample === true));
});

test("demo run: question outside the KB is handed off without drafting", async () => {
  const s = getScenario("not-in-kb");
  let drafted = false;
  const t = await runTrustGate(s, { mode: "demo", clocked: async (e, b) => samplePipeline(s, b), generate: async () => { drafted = true; return sampleDraft(s.id); } });
  assert.equal(t.final.status, "handoff");
  assert.equal(t.final.text, HANDOFF_REPLY);
  assert.equal(drafted, false);
  assert.equal(t.calls.length, 1);
});

// --- contract tests against the recorded responses published in the Clocked docs ---

test("interprets the documented Rerank recorded response (use/expand/skip)", () => {
  const req = DOCS.rerank.request;
  const documents = req.documents.map((d) => ({ id: d.id, text: d.text, title: d.title }));
  const resp = {
    steps: [
      { name: "mask-question", status: 200, result: { entities: [], counts: {}, anonymized_text: req.query } },
      ...documents.map((d) => ({ name: `guard:${d.id}`, status: 200, result: { ...DOCS.injection.response, verdict: "benign", evidence: [] } })),
      { name: "rank", status: 200, result: DOCS.rerank.response },
    ],
  };
  const pre = interpretPreflight(resp, { documents });
  assert.deepEqual(pre.selected, ["hs-bikes"]);
  assert.equal(pre.mode, "answer");
  assert.ok(pre.dropped.some((d) => d.id === "luggage-overview" && /expand/.test(d.why)));
  assert.ok(pre.dropped.some((d) => d.id === "regional-bikes" && /different_case/.test(d.why)));
});

test("interprets the documented Guard recorded response as a quarantine", () => {
  const documents = [{ id: "email", text: DOCS.injection.request.text }];
  const pre = interpretPreflight({ steps: [{ name: "mask-question", status: 200, result: DOCS.pii.response }, { name: "guard:email", status: 200, result: DOCS.injection.response }] }, { documents });
  assert.equal(pre.guards[0].flagged, true);
  assert.equal(pre.guards[0].category, "instruction override");
  assert.equal(pre.mode, "handoff"); // no ranking step → fail closed
});

test("interprets the documented Verify recorded response claim by claim", () => {
  const g = DOCS.grounding;
  const claims = g.response.claims.map((c) => {
    const start = g.request.answer.indexOf(c.claim);
    return { text: c.claim, start, end: start + c.claim.length };
  });
  const post = interpretPostcheck({ steps: [{ name: "verify", status: 200, result: g.response }, { name: "scrub", status: 200, result: { entities: [], counts: {}, anonymized_text: g.request.answer } }] }, { draft: g.request.answer, claims });
  assert.deepEqual(post.claims.map((c) => c.keep), [true, false, false, false]);
  assert.equal(post.final.status, "sent_with_edits");
  assert.equal(post.final.text, "An expired connector certificate caused the payroll sign-in incident.");
  assert.equal(post.final.review.length, 3);
});

test("interprets the documented Pipeline response with a skipped step", () => {
  const pre = interpretPreflight({ steps: DOCS.pipeline.response.steps.map((s, i) => ({ ...s, name: ["mask-question", "guard:t", "rank"][i] })) }, { documents: [{ id: "t", text: DOCS.pipeline.request.text }] });
  assert.equal(pre.mode, "handoff");
  assert.ok(pre.reasons.some((r) => /ranking failed \(stopped after/.test(r)));
});

// --- failure handling ---

test("a guard step that errors fails closed (passage quarantined)", () => {
  const documents = [{ id: "a", text: "x" }];
  const pre = interpretPreflight({ steps: [
    { name: "mask-question", status: 200, result: { entities: [], anonymized_text: "q" } },
    { name: "guard:a", status: 422, error: { detail: "bad" } },
    { name: "rank", status: 200, result: { results: [{ index: 0, id: "a", action: "use", relevance_score: 0.9, document_score: 0.9, levels: {} }], answers: { coverage: { choice: "answered" } } } },
  ] }, { documents });
  assert.equal(pre.guards[0].flagged, true);
  assert.deepEqual(pre.selected, []);
  assert.equal(pre.mode, "handoff");
});

test("partial coverage adds a caveat; unresolved conflicts (no dates) are flagged", () => {
  const documents = [{ id: "a", text: "x" }, { id: "b", text: "y" }];
  const ok = { entities: [], anonymized_text: "q" };
  const benign = { verdict: "benign", injection: 0.01 };
  const pre = interpretPreflight({ steps: [
    { name: "mask-question", status: 200, result: ok },
    { name: "guard:a", status: 200, result: benign }, { name: "guard:b", status: 200, result: benign },
    { name: "rank", status: 200, result: { results: [{ index: 0, id: "a", action: "use" }, { index: 1, id: "b", action: "use" }], answers: { coverage: { choice: "partial", confidence: 0.6 } } } },
    { name: "conflicts", status: 200, result: { verdict: "conflicts", pairs: [{ a: "a", b: "b", relation: "conflicting", conflicts: [] }] } },
  ] }, { documents });
  assert.equal(pre.mode, "answer_with_caveat");
  assert.deepEqual(pre.selected, ["a", "b"]);
  assert.ok(pre.conflicts[0].resolution.unresolved);
});

test("postcheck failure hands off; a whole-request failure hands off with the error", async () => {
  const post = interpretPostcheck({ steps: [{ name: "verify", status: 500, error: "x" }, { name: "scrub", status: 200, result: { entities: [] } }] }, { draft: "A.", claims: [{ text: "A.", start: 0, end: 2 }] });
  assert.equal(post.final.status, "handoff");
  const t = await runTrustGate(scn, { mode: "live", clocked: async () => { const e = new Error("401 bad key"); e.status = 401; throw e; }, generate: async () => ({ text: "" }) });
  assert.equal(t.final.status, "handoff");
  assert.equal(t.error.status, 401);
  assert.equal(t.calls[0].error.status, 401);
});

test("postcheck request verifies explicit sentence claims against kept passages only", () => {
  const { body, claims } = buildPostcheck({ draft: "One. Two.", question: "q", documents: [{ id: "a", text: "t", title: "x" }] });
  assert.deepEqual(body.steps[0].grounding.claims, ["One.", "Two."]);
  assert.deepEqual(body.steps[0].grounding.documents, [{ id: "a", text: "t" }]);
  assert.equal(body.steps[0].grounding.evidence, "all");
  assert.equal(body.text, "One. Two.");
  assert.equal(claims.length, 2);
});

test("validateInput enforces limits and sanitises ids", () => {
  assert.equal(validateInput({ question: "", documents: [] }).ok, false);
  const v = validateInput({ question: "q", documents: [{ id: "a b/c", text: "t", metadata: { updated: "2026-01-01", bad: { x: 1 } } }] });
  assert.equal(v.ok, true);
  assert.equal(v.value.documents[0].id, "a-b-c");
  assert.deepEqual(v.value.documents[0].metadata, { updated: "2026-01-01" });
  assert.equal(validateInput({ question: "q", documents: Array.from({ length: 9 }, (_, i) => ({ id: `d${i}`, text: "t" })) }).ok, false);
});
