// Draft generator. Uses MiniMax (OpenAI-compatible chat completions) when MINIMAX_API_KEY is set,
// otherwise an extractive fallback that quotes the top kept passage. Either way, the draft is
// treated as untrusted and checked by Clocked Verify + Protect before anything is sent.

const SYSTEM = [
  "You are the customer-support assistant of a SaaS company.",
  "Answer ONLY with facts stated in the passages provided. If something is not in the passages, do not say it.",
  "Write 2-4 short sentences, one fact per sentence, plain text, no lists, no greeting by name.",
  "Personal data in the question was replaced by placeholders such as <PERSON>; never repeat placeholders and never ask for card numbers, CVV codes or passwords.",
].join(" ");

export async function generateDraft({ question, passages, mode }, opts = {}) {
  const key = opts.apiKey ?? process.env.MINIMAX_API_KEY;
  if (!key) return extractiveDraft(passages);
  const base = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
  const model = process.env.MINIMAX_MODEL || "MiniMax-M3";
  const user = [
    `Customer question: ${question}`,
    "",
    ...passages.map((p, i) => `Passage ${i + 1} [${p.id}]${p.title ? ` (${p.title})` : ""}:\n${p.text}`),
    "",
    mode === "answer_with_caveat" ? "The passages may only answer part of the question; answer only that part." : "",
  ].join("\n");
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  try {
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.3,
        thinking: { type: "disabled" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
    const json = await res.json().catch(() => null);
    let text = json?.choices?.[0]?.message?.content;
    if (!res.ok || typeof text !== "string" || !text.trim()) throw new Error(`MiniMax HTTP ${res.status}`);
    text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return { text, model, generator: "minimax", sample: false };
  } catch (e) {
    const d = extractiveDraft(passages);
    d.note = `LLM unavailable (${e.message}); used extractive fallback.`;
    return d;
  }
}

export function extractiveDraft(passages) {
  const top = passages[0]?.text || "";
  const sentences = top.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 3);
  return { text: sentences.join(" "), model: null, generator: "extractive", sample: false };
}
