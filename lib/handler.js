// Shared request handling for the Vercel function (api/run.js) and the local dev server.
import { callClocked } from "./clocked.js";
import { generateDraft } from "./llm.js";
import { SCENARIOS, getScenario } from "./scenarios.js";
import { hasSamples, samplePipeline, sampleDraft } from "./samples.js";
import { runTrustGate, validateInput, POLICY } from "./trustgate.js";

export const DEMO_BANNER =
  "Demo mode (sample responses): no CLOCKED_API_KEY is configured, so every Clocked output on this page is an illustrative sample written in the documented response format. It is not a live API result.";

export function liveEnabled(env = process.env) {
  return Boolean(env.CLOCKED_API_KEY);
}

export function configPayload(env = process.env) {
  return {
    live: liveEnabled(env),
    llm: Boolean(env.MINIMAX_API_KEY),
    banner: liveEnabled(env) ? null : DEMO_BANNER,
    policy: POLICY,
    scenarios: SCENARIOS.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb, question: s.question, context: s.context, documents: s.documents })),
  };
}

export async function handleRun(body, deps = {}) {
  const env = deps.env ?? process.env;
  const wantDemo = body?.mode === "demo" || !liveEnabled(env);

  if (wantDemo) {
    const scn = getScenario(body?.scenarioId);
    if (!scn || !hasSamples(scn.id)) {
      return { status: 400, json: { error: "Demo mode only runs the built-in scenarios. Pick one, or configure CLOCKED_API_KEY for live calls." } };
    }
    const trace = await runTrustGate(scn, {
      mode: "demo",
      clocked: async (endpoint, reqBody) => samplePipeline(scn, reqBody),
      generate: async () => sampleDraft(scn.id),
    });
    return { status: 200, json: { mode: "demo", banner: DEMO_BANNER, scenarioId: scn.id, input: scn, trace } };
  }

  const base = body?.scenarioId ? getScenario(body.scenarioId) : null;
  const raw = {
    question: body?.question ?? base?.question,
    documents: body?.documents ?? base?.documents,
    context: body?.context ?? base?.context,
  };
  const v = validateInput(raw);
  if (!v.ok) return { status: 400, json: { error: "Invalid input", details: v.errors } };
  const trace = await runTrustGate(v.value, {
    mode: "live",
    clocked: deps.clocked ?? ((endpoint, reqBody) => callClocked(endpoint, reqBody, { apiKey: env.CLOCKED_API_KEY })),
    generate: deps.generate ?? ((args) => generateDraft(args, { apiKey: env.MINIMAX_API_KEY })),
  });
  return { status: 200, json: { mode: "live", banner: null, scenarioId: body?.scenarioId ?? null, input: v.value, trace } };
}
