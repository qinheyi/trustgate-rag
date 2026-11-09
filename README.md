# TrustGate — a trust layer for RAG support bots, built on Clocked

**Live demo:** https://trustgate-rag.vercel.app  ·  **Built for:** the [Clocked Build Challenge](https://clocked.rezolve.ai/challenge) (Oct 21 – Nov 10, 2026)

Retrieval-augmented support bots fail in four predictable ways:

1. a retrieved page (a forum post, an email, a scraped doc) carries **hidden instructions** — indirect prompt injection;
2. the retriever returns passages that share keywords but are **for a different customer** (enterprise vs. self-serve, another region);
3. the knowledge base holds **two versions of the same policy** and the bot quotes the outdated one;
4. the LLM **over-promises** ("we'll add a $20 credit") or **leaks internal data** copied from an agent-only note.

TrustGate sits between retrieval and the reply. It sends the question and passages through two Clocked
`/pipeline` requests and turns every Clocked output into a concrete action: quarantine, skip, drop, hand off,
cut a sentence, or send.

![flow](docs/flow.svg)

![TrustGate demo run: poisoned forum post quarantined, outdated policy dropped, invented credit and leaked contact cut](docs/screenshot.png)

*Screenshot of the demo-mode run (sample responses).*

## What each Clocked endpoint does in TrustGate

| Step | Endpoint | Input | What its output changes |
|---|---|---|---|
| 1 | **Protect** `pii` | the customer's message | `anonymized_text` is what the LLM sees (`<PERSON>`, `<EMAIL>`, `<CREDIT_CARD>`). If masking fails, the raw message is **never** sent to the LLM — the bot hands off. |
| 2 | **Guard** `injection` (`source: "content"`, one step per passage) | every retrieved passage | a verdict other than `benign` **quarantines** the passage: it never reaches the LLM, even when Rerank rates it relevant. `evidence` offsets highlight the attack in the UI. A step error fails closed (quarantine). |
| 3 | **Rerank** `rerank` (+ a Decide-style `questions.coverage`) | question, customer `context`, all passages | `action: use` passages are candidates; `expand` / `skip` (with `reason`: `different_case`, `unrelated`) are dropped and shown. The `coverage` choice (`answered` / `partial` / `not_established`) decides whether to answer, answer with a hand-off caveat, or **not draft at all**. |
| 4 | **Compare** `compare` | all passages | a `conflicting` pair among the candidates is resolved by `metadata.updated` — the older policy is dropped, the conflicting quotes are highlighted. Without dates the conflict goes to the agent-review queue. |
| 5 | (LLM) | masked question + kept passages only | MiniMax drafts 2–4 sentences (extractive fallback when no LLM key). |
| 6 | **Verify** `grounding` (explicit `claims`, one per sentence) | draft + kept passages | only sentences with verdict `supported` are sent; `not_stated` / `contradicted` sentences are cut and listed for an agent with their probabilities. Nothing supported → hand off. |
| 7 | **Protect** `pii` | the draft | grounded ≠ safe: a sentence supported by an internal note can still leak a colleague's email/phone. Sentences containing findings are cut; `anonymized_text` is what gets stored in the transcript. |

Steps 1–4 are **one** `/pipeline` request (1 + N + 2 steps, ≤ 16), steps 6–7 a second one — two round trips,
two bills, every step's output used. Groups covered: Protect + Guard (safety layer), Verify + Compare + Rerank
(knowledge layer, all three), plus a Decide question inside Rerank.

### Uncertain results, missing information, failed requests

* **Uncertain:** Rerank `coverage: partial` → the reply answers what is supported and says the rest was passed to a specialist; `not_established` → no draft, human handoff. Verify claims below the `supported` verdict are cut, not softened. Probabilities are shown, never hidden.
* **Missing information:** no `use` passage, or every passage quarantined → handoff. Missing `evidence` is shown as "no supporting passage", never invented.
* **Failed requests:** the client follows the [Errors & retries](https://clocked.rezolve.ai/docs/errors) guide — one `Idempotency-Key` per logical request, reused with the identical payload on retry; bounded exponential backoff for 429/5xx/network errors; stop on `retryAsNew`; no retries for 400/401/402/409/422. Pipeline steps are read one by one (a pipeline is `200` if any step answered): a failed guard step quarantines its passage, a failed rank/verify/scrub step fails closed to a human handoff.

## Demo mode vs. live mode

* **Live mode** (when `CLOCKED_API_KEY` is set on the server): every run makes real calls to `https://clocked.rezolve.ai/clocked/pipeline`; the UI shows each call's credits and cost from the `X-Clocked-*` headers; the question and passages are editable.
* **Demo mode** (no key): the page says **"Demo mode (sample responses)"** in a banner, on every stage card, and in the raw JSON drawer. The sample responses in [`lib/samples.js`](lib/samples.js) are hand-written in the exact structure of the recorded responses in the Clocked docs (a test checks the field sets against the doc examples in [`test/fixtures/docs-recorded.json`](test/fixtures/docs-recorded.json)); their probabilities are illustrative and their offsets are computed from the scenario text. They are not live results, and demo mode refuses custom input rather than faking an answer.

All content is synthetic (fictional "Northwind Cloud"; `example.com` addresses, `555` numbers).

## Run it

Requirements: Node.js ≥ 18. No dependencies.

```bash
git clone https://github.com/qinheyi/trustgate-rag && cd trustgate-rag
npm test                    # unit + contract tests (node:test)
npm run dev                 # http://localhost:3000 — demo mode
export CLOCKED_API_KEY=...  # from https://clocked.rezolve.ai account page
export MINIMAX_API_KEY=...  # optional, for LLM drafts
npm run dev                 # live mode
npm run smoke               # smoke test against a local server
npm run smoke -- https://trustgate-rag.vercel.app   # …or against a deployment
```

Deploy: `vercel --prod`, then set `CLOCKED_API_KEY` (and optionally `MINIMAX_API_KEY`) as Vercel environment
variables. Keys stay on the server (`api/*.js`); the browser never sees them. Live runs are rate-limited per IP.

## Architecture

```
public/            static UI (vanilla JS, dark theme, code-point-accurate highlighting)
api/run.js         POST /api/run  → lib/handler.js
api/config.js      GET  /api/config (mode, scenarios)
lib/clocked.js     raw HTTPS client: Bearer auth, Idempotency-Key, bounded retries, cost headers
lib/trustgate.js   builds the two pipelines and turns every Clocked output into a decision
lib/llm.js         MiniMax draft (OpenAI-compatible) or extractive fallback
lib/samples.js     demo-mode sample responses (documented structure, clearly flagged)
lib/scenarios.js   synthetic knowledge-base scenarios
test/              node:test suites; fixtures copied from the Clocked docs
scripts/           dev server + smoke test
```

```mermaid
flowchart LR
  Q[Customer question] --> P1
  D[Retrieved passages] --> P1
  subgraph P1["Clocked /pipeline #1"]
    PII1[pii: mask question] --> INJ[injection × N: quarantine]
    INJ --> RR[rerank + coverage decision]
    RR --> CMP[compare: conflicts]
  end
  P1 -->|coverage not_established / nothing usable| H[Human handoff]
  P1 -->|masked question + kept passages| LLM[LLM draft]
  LLM --> P2
  subgraph P2["Clocked /pipeline #2"]
    GR[grounding: claim by claim] --> PII2[pii: scrub draft]
  end
  P2 -->|supported, PII-free sentences| R[Reply]
  P2 -->|cut sentences| AR[Agent review queue]
```

## What I learned

* Clocked returns *probabilities with positions*, which makes it natural to build policy (thresholds, fail-closed rules) and an explainable UI around it instead of a yes/no filter.
* `/pipeline` steps don't feed each other, so the design question becomes "what can run on the same inputs in one admission?" — the pre-answer checks fit in one request, the post-answer checks in another.
* Grounding and privacy are separate axes: the most dangerous sentence in the demo is *supported* by the knowledge base (an agent-only note) — only Protect catches it.
* Offsets are Unicode code points; JavaScript strings are UTF-16, so every slice goes through `Array.from`.

## Credits & license

Built by Qin HEYI (GitHub [@qinheyi](https://github.com/qinheyi)) for the Clocked Build Challenge, with AI coding assistance.
Clocked API by [Rezolve.ai](https://clocked.rezolve.ai). Recorded examples in `test/fixtures/docs-recorded.json` are copied from the public Clocked docs for contract testing.
MIT License — see [LICENSE](LICENSE).
