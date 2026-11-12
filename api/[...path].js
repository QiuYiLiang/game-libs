import { handleApiRequest } from "../server/apiMiddleware.mjs";

/**
 * Vercel serverless entry for `/api/*`.
 * Bridges Node-style middleware used by Vite/prod server.
 */
export default async function handler(req, res) {
  // Some rewrite shapes drop the `/api` prefix — normalize for apiMiddleware.
  if (typeof req.url === "string" && !req.url.startsWith("/api")) {
    const q = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const pathOnly = req.url.split("?")[0] || "";
    req.url = `/api${pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`}${q}`;
  }

  try {
    const handled = await handleApiRequest(req, res);
    if (handled) return;
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "未知的 API 路径" }));
  } catch (err) {
    console.error("[vercel api]", err);
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(
      JSON.stringify({
        ok: false,
        error: err instanceof Error ? err.message : "上游站点请求失败",
      })
    );
  }
}

export const config = {
  maxDuration: 60,
};
