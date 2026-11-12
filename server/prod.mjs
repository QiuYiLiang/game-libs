import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./apiMiddleware.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");
const port = Number(process.env.PORT || 4173);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const handled = await handleApiRequest(req, res);
  if (handled) return;

  const urlObj = new URL(req.url || "/", `http://localhost:${port}`);
  let relPath = decodeURIComponent(urlObj.pathname);
  if (relPath === "/") relPath = "/index.html";

  const filePath = path.join(distDir, relPath);
  if (filePath.startsWith(distDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  const indexHtml = path.join(distDir, "index.html");
  if (fs.existsSync(indexHtml)) {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    fs.createReadStream(indexHtml).pipe(res);
    return;
  }

  res.statusCode = 404;
  res.end("Not Found (run npm run build first)");
});

server.listen(port, () => {
  console.log(`Gamer520 Next server listening on http://localhost:${port}`);
});
