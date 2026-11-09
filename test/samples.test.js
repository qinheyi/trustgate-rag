// Demo-mode samples must use the documented response structure, and their offsets must be real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCENARIOS } from "../lib/scenarios.js";
import { samplePipeline, sampleDraft, hasSamples } from "../lib/samples.js";
import { buildPreflight, buildPostcheck } from "../lib/trustgate.js";
import { cpSlice } from "../lib/text.js";

const DOCS = JSON.parse(readFileSync(new URL("./fixtures/docs-recorded.json", import.meta.url)));
const keys = (o) => Object.keys(o).sort();
const OPTIONAL = new Set(["timing", "usage", "stages", "pdf", "mentions", "checks", "residual", "residual_verdict", "answers", "_sample"]);
function sameShape(sample, documented, label) {
  const a = keys(sample).filter((k) => !OPTIONAL.has(k));
  const b = keys(documented).filter((k) => !OPTIONAL.has(k));
  assert.deepEqual(a, b, `${label}: sample keys differ from the documented recorded response`);
}

function allSteps() {
  const out = [];
  for (const scn of SCENARIOS) {
    const pre = samplePipeline(scn, buildPreflight(scn)).result;
    out.push({ scn, kind: "pre", resp: pre });
    const draft = sampleDraft(scn.id).text;
    if (draft) {
      const { body } = buildPostcheck({ draft, question: "q", documents: scn.documents.filter((d) => d.id === "refund-policy-2026") });
      out.push({ scn, kind: "post", resp: samplePipeline(scn, body).result, draft });
    }
  }
  return out;
}

test("every built-in scenario has samples and every sample step answered 200", () => {
  for (const s of SCENARIOS) assert.ok(hasSamples(s.id));
  for (const { resp } of allSteps()) {
    assert.equal(resp._sample, true);
    sameShape(resp, DOCS.pipeline.response, "pipeline envelope");
    for (const st of resp.steps) assert.equal(st.status, 200, `${st.name} has no sample`);
  }
});

test("sample results have the same fields as the recorded responses in the docs", () => {
  for (const { resp } of allSteps()) {
    for (const st of resp.steps) {
      const r = st.result;
      if (st.endpoint === "injection") sameShape(r, DOCS.injection.response, st.name);
      if (st.endpoint === "pii") {
        sameShape(r, DOCS.pii.response, st.name);
        for (const e of r.entities) assert.deepEqual(keys(e), keys(DOCS.pii.response.entities[0]));
      }
      if (st.endpoint === "rerank") {
        sameShape(r, DOCS.rerank.response, st.name);
        for (const x of r.results) {
          const ref = DOCS.rerank.response.results.find((y) => (y.reason ? 1 : 0) === (x.reason ? 1 : 0));
          assert.deepEqual(keys(x), keys(ref));
          assert.ok(Math.abs(Object.values(x.levels).reduce((a, b) => a + b, 0) - 1) < 1e-3, "levels sum to 1");
          assert.equal(x.relevance_score, x.levels.answers);
        }
        assert.deepEqual(keys(r.answers.coverage), keys(DOCS.decide.response.answers.route));
      }
      if (st.endpoint === "compare") {
        sameShape(r, DOCS.compare.response, st.name);
        for (const p of r.pairs) assert.deepEqual(keys(p), keys(DOCS.compare.response.pairs[0]));
      }
      if (st.endpoint === "grounding") {
        sameShape(r, DOCS.grounding.response, st.name);
        for (const c of r.claims) {
          const ref = DOCS.grounding.response.claims.find((y) => ("evidence" in y) === ("evidence" in c));
          assert.deepEqual(keys(c), keys(ref));
        }
      }
    }
  }
});

test("every sample offset points at the quoted text in the original source", () => {
  for (const { scn, resp, draft } of allSteps()) {
    const text = (id) => scn.documents.find((d) => d.id === id).text;
    for (const st of resp.steps) {
      const r = st.result;
      if (st.endpoint === "injection") for (const e of r.evidence) assert.equal(cpSlice(text(st.name.slice(6)), e.start, e.end), e.quote);
      if (st.endpoint === "pii") {
        const src = st.name === "mask-question" ? scn.question : draft;
        for (const e of r.entities) assert.equal(cpSlice(src, e.start, e.end), e.value);
      }
      if (st.endpoint === "compare") for (const p of r.pairs) for (const f of [...p.duplicates, ...p.conflicts]) {
        assert.equal(cpSlice(text(f.a.document), f.a.start, f.a.end), f.a.quote);
        assert.equal(cpSlice(text(f.b.document), f.b.start, f.b.end), f.b.quote);
      }
      if (st.endpoint === "grounding") for (const c of r.claims) if (c.evidence) assert.equal(cpSlice(text(c.evidence.document), c.evidence.start, c.evidence.end), c.evidence.quote);
    }
  }
});
