import { handleRun } from "../lib/handler.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "POST only" });
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: "Body must be JSON" }); }
  }
  try {
    const out = await handleRun(body || {});
    res.setHeader("Cache-Control", "no-store");
    return res.status(out.status).json(out.json);
  } catch (e) {
    return res.status(500).json({ error: "Internal error", message: e.message });
  }
}
