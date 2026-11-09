import { handleRun, liveEnabled } from "../lib/handler.js";
import { allow } from "../lib/ratelimit.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Body must be JSON" }); }
  }
  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (liveEnabled() && body?.mode !== "demo" && !allow(ip)) {
    return res.status(429).json({ error: "Too many live runs from this address; try again in a few minutes." });
  }
  try {
    const out = await handleRun(body || {});
    res.setHeader("Cache-Control", "no-store");
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ error: "Internal error", message: e.message });
  }
}
