// Minimal raw-HTTP Clocked client that follows https://clocked.rezolve.ai/docs/authentication
// and https://clocked.rezolve.ai/docs/errors exactly:
//  - Authorization: Bearer <key>, Content-Type: application/json, Idempotency-Key: <uuid>
//  - one Idempotency-Key per logical request, reused (with the identical payload) on retries
//  - bounded exponential backoff on 429 / 5xx / network errors, stop when retryAsNew is true
//  - the HTTP body *is* the result (no `data` wrapper for raw HTTP)
import { randomUUID } from "node:crypto";

export const CLOCKED_BASE = process.env.CLOCKED_BASE_URL || "https://clocked.rezolve.ai/clocked";
export const ENDPOINTS = ["decide", "extract", "fill", "pii", "injection", "script", "grounding", "compare", "rerank", "pipeline"];

export class ClockedError extends Error {
  constructor(message, { status = 0, body = null, retryAsNew = false, endpoint = "" } = {}) {
    super(message);
    this.name = "ClockedError";
    this.status = status;
    this.body = body;
    this.retryAsNew = retryAsNew;
    this.endpoint = endpoint;
  }
}

const COST_HEADERS = {
  modelMs: "x-clocked-model-ms",
  credits: "x-clocked-credits",
  costUsd: "x-clocked-cost-usd",
  costBasis: "x-clocked-cost-basis",
  transport: "x-clocked-transport",
};

export function readCostHeaders(headers) {
  const out = {};
  for (const [k, h] of Object.entries(COST_HEADERS)) {
    const v = headers?.get ? headers.get(h) : undefined;
    if (v !== null && v !== undefined) out[k] = /^(modelMs|credits|costUsd)$/.test(k) ? Number(v) : v;
  }
  return out;
}

function isRetryable(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POST one Clocked endpoint.
 * @returns {Promise<{result: object, meta: {endpoint, status, idempotencyKey, attempts, elapsedMs, cost}}>}
 */
export async function callClocked(endpoint, body, opts = {}) {
  if (!ENDPOINTS.includes(endpoint)) throw new Error(`Unknown Clocked endpoint: ${endpoint}`);
  const apiKey = opts.apiKey ?? process.env.CLOCKED_API_KEY;
  if (!apiKey) throw new ClockedError("CLOCKED_API_KEY is not set", { status: 0, endpoint });
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 115_000; // gateway allows up to 110 s per model request
  const idempotencyKey = opts.idempotencyKey ?? randomUUID();
  const payload = JSON.stringify(body); // identical payload for every retry of this attempt
  const started = Date.now();
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(`${CLOCKED_BASE}/${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: payload,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // Unknown outcome: retry the SAME attempt (same key, same payload).
      lastErr = new ClockedError(`Network error calling /${endpoint}: ${e.message}`, { endpoint });
      if (attempt < maxAttempts) { await sleep(backoff(attempt, opts)); continue; }
      throw lastErr;
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    if (res.ok) {
      return {
        result: json,
        meta: {
          endpoint, status: res.status, idempotencyKey, attempts: attempt,
          elapsedMs: Date.now() - started, cost: readCostHeaders(res.headers),
        },
      };
    }

    const message = (json && (json.error || json.detail && JSON.stringify(json.detail))) || `HTTP ${res.status}`;
    const retryAsNew = Boolean(json && json.retryAsNew);
    lastErr = new ClockedError(`/${endpoint} failed (${res.status}): ${message}`, {
      status: res.status, body: json, retryAsNew, endpoint,
    });
    if (retryAsNew || !isRetryable(res.status) || attempt === maxAttempts) throw lastErr;
    await sleep(backoff(attempt, opts));
  }
  throw lastErr;
}

function backoff(attempt, opts) {
  const base = opts.backoffMs ?? 600;
  return Math.min(base * 2 ** (attempt - 1), 8000) + Math.floor(Math.random() * 100);
}
