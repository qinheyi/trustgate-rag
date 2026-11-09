import { configPayload } from "../lib/handler.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json(configPayload());
}
