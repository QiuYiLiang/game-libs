import {
  fetchGameGallery,
  fetchGamesList,
  resolveGamePanLinks,
} from "./gamer520.mjs";
import {
  fetchPsGameGallery,
  fetchPsGamesList,
  isPsCategorySlug,
  isPsSource,
  resolvePsPanLinks,
} from "./ps2468c.mjs";

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}

function isUsablePan(data) {
  if (!data) return false;
  if ((data.formatGroups?.length || 0) > 0) return true;
  return (
    (data.baiduLinks?.length || 0) + (data.otherLinks?.length || 0) > 0
  );
}

/** 未带 source 时 gamer520 常对 PS 帖返回空；空则回退试 2468c */
async function resolvePanWithFallback(postId, source) {
  if (isPsSource(source)) {
    return resolvePsPanLinks(postId);
  }
  const primary = await resolveGamePanLinks(postId);
  if (isUsablePan(primary)) return primary;
  try {
    const ps = await resolvePsPanLinks(postId);
    if (isUsablePan(ps)) return ps;
  } catch {
    // ignore PS miss
  }
  return primary;
}

async function resolveGalleryWithFallback(postId, source) {
  if (isPsSource(source)) {
    return fetchPsGameGallery(postId);
  }
  const primary = await fetchGameGallery(postId);
  const hasContent =
    (primary.images?.length || 0) > 0 ||
    (primary.description || "").trim().length > 0;
  if (hasContent) return primary;
  try {
    const ps = await fetchPsGameGallery(postId);
    if (
      (ps.images?.length || 0) > 0 ||
      (ps.description || "").trim().length > 0
    ) {
      return ps;
    }
  } catch {
    // ignore
  }
  return primary;
}

/**
 * Connect / Node HTTP compatible middleware for `/api/*` routes.
 */
export async function handleApiRequest(req, res, next) {
  if (!req.url || !req.url.startsWith("/api/")) {
    if (next) return next();
    return false;
  }

  const urlObj = new URL(req.url, "http://localhost");
  const pathname = urlObj.pathname;

  try {
    if (req.method === "GET" && pathname === "/api/games") {
      const page = Number(urlObj.searchParams.get("page") || "1");
      const category = urlObj.searchParams.get("category") || "";
      const search = urlObj.searchParams.get("search") || "";
      const order = urlObj.searchParams.get("order") || "date";
      const source = urlObj.searchParams.get("source") || "";

      const usePs = isPsSource(source) || isPsCategorySlug(category);

      const data = usePs
        ? await fetchPsGamesList({ page, category, search, order })
        : await fetchGamesList({ page, category, search, order });
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    const panMatch = pathname.match(/^\/api\/games\/(\d+)\/pan$/);
    if (req.method === "GET" && panMatch) {
      const postId = Number(panMatch[1]);
      const source = urlObj.searchParams.get("source") || "";
      const data = await resolvePanWithFallback(postId, source);
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    const galleryMatch = pathname.match(/^\/api\/games\/(\d+)\/gallery$/);
    if (req.method === "GET" && galleryMatch) {
      const postId = Number(galleryMatch[1]);
      const source = urlObj.searchParams.get("source") || "";
      const data = await resolveGalleryWithFallback(postId, source);
      sendJson(res, 200, { ok: true, ...data });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "未知的 API 路径" });
    return true;
  } catch (err) {
    console.error("[API Error]", pathname, err);
    sendJson(res, 502, {
      ok: false,
      error: err instanceof Error ? err.message : "上游站点请求失败，请稍后重试",
    });
    return true;
  }
}
