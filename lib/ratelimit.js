// Best-effort per-instance limiter so a public live demo cannot drain the account's credits.
const hits = new Map();
export function allow(key, { limit = Number(process.env.RUNS_PER_WINDOW || 20), windowMs = 10 * 60_000, now = Date.now() } = {}) {
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= limit) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return true;
}
