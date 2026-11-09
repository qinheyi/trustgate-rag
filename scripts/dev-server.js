// Local server: serves public/ and the two API routes, mirroring the Vercel deployment.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { handleRun, configPayload } from "../lib/handler.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "public");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    try {
      if (url.pathname === "/api/config") return send(200, configPayload());
      if (url.pathname === "/api/run") {
        if (req.method !== "POST") return send(405, { error: "POST only" });
        let raw = "";
        for await (const c of req) raw += c;
        let body;
        try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: "Body must be JSON" }); }
        const out = await handleRun(body);
        return send(out.status, out.json);
      }
      const p = normalize(url.pathname === "/" ? "/index.html" : url.pathname).replace(/^(\.\.[/\\])+/, "");
      const file = join(root, p);
      if (!file.startsWith(root)) return send(403, { error: "forbidden" });
      const data = await readFile(file);
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      if (e.code === "ENOENT") return send(404, { error: "not found" });
      send(500, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  createServer().listen(port, () => console.log(`TrustGate on http://localhost:${port} (${process.env.CLOCKED_API_KEY ? "live" : "demo"} mode)`));
}
