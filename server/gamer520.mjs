import * as cheerio from "cheerio";

const BASE_ORIGIN = "https://www.gamer520.com";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Per-host session cookie jar to handle gamer520 / gamers520 lightweight JS/403 cookie challenges
const hostCookies = new Map();

function getCookieHeader(host) {
  const jar = hostCookies.get(host);
  if (!jar || jar.size === 0) return "";
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeSetCookies(host, response) {
  const setCookies = response.headers.getSetCookie?.() || [];
  if (setCookies.length === 0) return false;
  let jar = hostCookies.get(host);
  if (!jar) {
    jar = new Map();
    hostCookies.set(host, jar);
  }
  let changed = false;
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const eqIdx = pair.indexOf("=");
    if (eqIdx > 0) {
      const k = pair.slice(0, eqIdx).trim();
      const v = pair.slice(eqIdx + 1).trim();
      if (jar.get(k) !== v) {
        jar.set(k, v);
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Fetch HTML from gamer520 / 520.gamers520.com with automatic cookie-challenge retry.
 */
export async function smartFetchHtml(targetUrl, referer = BASE_ORIGIN + "/") {
  const parsed = new URL(targetUrl);
  const buildHeaders = () => {
    const headers = {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      Referer: referer,
    };
    const ck = getCookieHeader(parsed.host);
    if (ck) headers.Cookie = ck;
    return headers;
  };

  let res = await fetch(targetUrl, {
    headers: buildHeaders(),
    signal: AbortSignal.timeout(15000),
  });
  let text = await res.text();
  const updatedCookies = storeSetCookies(parsed.host, res);

  // Detect lightweight cookie challenge: 403 with Set-Cookie or tiny self-reload script
  const isSelfChallenge =
    res.status === 403 ||
    (text.length < 2600 &&
      /window\.location(?:\.href)?\s*=\s*['"]\/go\?post_id=/i.test(text)) ||
    (text.length < 2000 &&
      updatedCookies &&
      /window\.location(?:\.href)?\s*=/i.test(text) &&
      !/https?:\/\//i.test(text));

  if (isSelfChallenge && updatedCookies) {
    res = await fetch(targetUrl, {
      headers: buildHeaders(),
      signal: AbortSignal.timeout(15000),
    });
    text = await res.text();
    storeSetCookies(parsed.host, res);
  }

  return {
    status: res.status,
    finalUrl: res.url || targetUrl,
    html: text,
  };
}

// LRU-like bounded caches for list pages & resolved Pan links
const listCache = new Map();
const panCache = new Map();
const galleryCache = new Map();
const LIST_TTL_MS = 3 * 60 * 1000;
const PAN_TTL_MS = 30 * 60 * 1000;
const GALLERY_TTL_MS = 30 * 60 * 1000;

export const ALLOWED_CATEGORIES = new Set([
  "",
  "pcplay",
  "ign-hot",
  "3ajuzuo",
  "gameswitch",
  "yzb",
  "xgq",
  "jinshouzhi",
  "zhangji",
]);

function splitGameTitle(rawTitle) {
  const parts = rawTitle
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { mainTitle: rawTitle.trim(), tags: [] };
  }
  return {
    mainTitle: parts[0],
    tags: parts.slice(1),
  };
}

/**
 * Parse WordPress RiPro `<article id="post-XXXX">` list/grid items + pagination.
 */
export function parseGamesPageHtml(html, currentPage = 1) {
  const $ = cheerio.load(html);
  const items = [];

  $("article[id^='post-']").each((_, el) => {
    const $el = $(el);
    const idAttr = $el.attr("id") || "";
    const idMatch = idAttr.match(/post-(\d+)/);
    if (!idMatch) return;
    const id = Number(idMatch[1]);

    const $titleLink = $el.find(".entry-title a").first();
    const rawTitle = (
      $titleLink.attr("title") ||
      $titleLink.text() ||
      ""
    ).trim();
    if (!rawTitle) return;

    const url =
      $titleLink.attr("href") || `${BASE_ORIGIN}/${id}.html`;

    const $img = $el.find(".entry-media img").first();
    const dataSrc = ($img.attr("data-src") || "").trim();
    const src = ($img.attr("src") || "").trim();
    const cover =
      dataSrc && !dataSrc.startsWith("data:")
        ? dataSrc
        : src && !src.startsWith("data:")
          ? src
          : "";

    const categories = [];
    $el.find(".meta-category a").each((__, catEl) => {
      const $cat = $(catEl);
      const name = $cat.text().trim();
      const href = $cat.attr("href") || "";
      const slug = href.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
      if (name) categories.push({ name, slug });
    });

    const excerpt = $el
      .find(".entry-excerpt")
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const $time = $el.find(".meta-date time").first();
    const datetime = $time.attr("datetime") || "";
    const dateLabel = $time.text().trim();
    const priceLabel =
      $el.find(".meta-price").text().trim() || "免费";

    const { mainTitle, tags } = splitGameTitle(rawTitle);

    items.push({
      id,
      source: "gamer520",
      rawTitle,
      mainTitle,
      tags,
      url,
      cover,
      categories,
      excerpt,
      datetime,
      dateLabel,
      priceLabel,
    });
  });

  // Parse total pages from numeric-pagination
  let totalPages = currentPage;
  $(".numeric-pagination .page-numbers, .pagination .page-numbers").each(
    (_, pEl) => {
      const txt = $(pEl).text().replace(/,/g, "").trim();
      const num = Number.parseInt(txt, 10);
      if (Number.isFinite(num) && num > totalPages) {
        totalPages = num;
      }
    }
  );

  return {
    items,
    page: currentPage,
    totalPages,
  };
}

/**
 * Fetch and parse game list (supports category, search query, and pagination).
 */
const ALLOWED_ORDERS = new Set(["date", "hot"]);

function appendOrderParam(url, order) {
  if (!order || order === "date") return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}order=${encodeURIComponent(order)}`;
}

export async function fetchGamesList({
  page = 1,
  category = "",
  search = "",
  order = "date",
} = {}) {
  const safePage = Math.max(1, Math.min(2000, Number(page) || 1));
  const cleanCat = ALLOWED_CATEGORIES.has(category) ? category : "";
  const cleanSearch = String(search || "").trim();
  const cleanOrder = ALLOWED_ORDERS.has(order) ? order : "date";

  let targetUrl;
  if (cleanSearch) {
    const encodedS = encodeURIComponent(cleanSearch);
    targetUrl =
      safePage > 1
        ? `${BASE_ORIGIN}/page/${safePage}?s=${encodedS}`
        : `${BASE_ORIGIN}/?s=${encodedS}`;
  } else if (cleanCat) {
    targetUrl =
      safePage > 1
        ? `${BASE_ORIGIN}/${cleanCat}/page/${safePage}`
        : `${BASE_ORIGIN}/${cleanCat}`;
  } else {
    targetUrl =
      safePage > 1
        ? `${BASE_ORIGIN}/page/${safePage}`
        : `${BASE_ORIGIN}/`;
  }
  targetUrl = appendOrderParam(targetUrl, cleanOrder);

  const cacheKey = `${cleanCat}|${cleanSearch}|${cleanOrder}|${safePage}`;
  const cached = listCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < LIST_TTL_MS) {
    return { ...cached.data, cached: true, sourceUrl: targetUrl };
  }

  const { status, html } = await smartFetchHtml(targetUrl);
  if (status === 404) {
    return {
      items: [],
      page: safePage,
      totalPages: Math.max(1, safePage - 1),
      category: cleanCat,
      search: cleanSearch,
      order: cleanOrder,
      sourceUrl: targetUrl,
    };
  }

  const parsed = parseGamesPageHtml(html, safePage);
  const result = {
    ...parsed,
    category: cleanCat,
    search: cleanSearch,
    order: cleanOrder,
    sourceUrl: targetUrl,
  };

  if (parsed.items.length > 0) {
    if (listCache.size > 200) {
      const oldestKey = listCache.keys().next().value;
      listCache.delete(oldestKey);
    }
    listCache.set(cacheKey, { ts: Date.now(), data: result });
  }

  return result;
}

/**
 * Extract Baidu Pan, Quark Pan, Xunlei Pan, Gofile links, pwd, and archive password
 * strictly from `.entry-content` / `.bdp-container` (avoiding site-wide nav menu promo links!).
 */
export function extractPanLinksFromHtml(html) {
  const $ = cheerio.load(html);
  // Scope strictly to article entry-content (or bdp-container) so header promo links are never matched,
  // while still capturing supplementary voice-pack / patch links outside .bdp-container.
  const $scope =
    $(".entry-content").length > 0
      ? $(".entry-content")
      : $(".bdp-container").length > 0
        ? $(".bdp-container")
        : $("article");

  const scopeHtml = $scope.html() || "";
  const scopeText = $scope.text() || "";

  const foundUrls = [];

  // 1a. Prioritize QR code `data=...` URLs inside `.bdp-container` first (main game package)
  $scope.find(".bdp-container img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src") || "";
    const m = src.match(/[?&]data=([^&"'<>]+)/i);
    if (m) {
      try {
        foundUrls.push(decodeURIComponent(m[1]));
      } catch {
        // ignore malformed URI
      }
    }
  });

  // 1b. Any remaining QR code `data=...` URLs in scope
  $scope.find("img").each((_, img) => {
    const src = $(img).attr("src") || $(img).attr("data-src") || "";
    const m = src.match(/[?&]data=([^&"'<>]+)/i);
    if (m) {
      try {
        foundUrls.push(decodeURIComponent(m[1]));
      } catch {
        // ignore malformed URI
      }
    }
  });

  // 2. Direct `<a href="...">` links in scope
  $scope.find("a[href]").each((_, a) => {
    const href = ($(a).attr("href") || "").trim();
    if (href.startsWith("http")) {
      foundUrls.push(href);
    }
  });

  // 3. Plain-text URLs in scopeHtml (for older posts with plain text links)
  const plainMatches = scopeHtml.match(
    /https?:\/\/(?:pan\.baidu\.com|pan\.quark\.cn|pan\.xunlei\.com|gofile\.io)\/[^\s"'<>&#]+(?:\?pwd=[a-zA-Z0-9]+)?/gi
  );
  if (plainMatches) {
    foundUrls.push(...plainMatches);
  }

  // Deduplicate and classify
  const uniqueUrls = [...new Set(foundUrls.map((u) => u.replace(/&amp;/g, "&").trim()))];

  const baiduLinks = [];
  const otherLinks = [];

  for (const u of uniqueUrls) {
    if (/pan\.baidu\.com\/s\//i.test(u)) {
      let pwd = "";
      try {
        pwd = new URL(u).searchParams.get("pwd") || "";
      } catch {
        const pm = u.match(/[?&]pwd=([a-zA-Z0-9]+)/i);
        if (pm) pwd = pm[1];
      }
      baiduLinks.push({ url: u, pwd });
    } else if (/pan\.quark\.cn\/s\//i.test(u)) {
      otherLinks.push({ provider: "夸克网盘", url: u });
    } else if (/pan\.xunlei\.com\/s\//i.test(u)) {
      otherLinks.push({ provider: "迅雷云盘", url: u });
    } else if (/gofile\.io\//i.test(u)) {
      otherLinks.push({ provider: "Gofile", url: u });
    }
  }

  // Fallback pwd from `.bdp-baidu .bdp-pwd-box` or `提取码: xxxx` if URL didn't carry `?pwd=`
  const domBaiduPwd =
    $scope.find(".bdp-baidu .bdp-pwd-box strong").first().text().trim() ||
    (scopeText.match(/提取码\s*[:：]\s*([a-zA-Z0-9]{4})\b/) || [])[1] ||
    "";

  if (baiduLinks.length > 0 && !baiduLinks[0].pwd && domBaiduPwd) {
    baiduLinks[0].pwd = domBaiduPwd;
    const sep = baiduLinks[0].url.includes("?") ? "&" : "?";
    baiduLinks[0].url = `${baiduLinks[0].url}${sep}pwd=${domBaiduPwd}`;
  }

  // Extract archive / file password (e.g. 解压密码:laoquzhang.com or `.copypaw`)
  let archivePassword = "";
  const headerPwdMatch = scopeText.match(
    /解压密码\s*[:：]\s*([^\s|丨<>\u3000]+)/
  );
  if (headerPwdMatch) {
    archivePassword = headerPwdMatch[1].trim();
  }
  const fileCode = $(".copypaw").first().attr("data-clipboard-text") || $(".copypaw").first().text().trim() || "";

  return {
    baiduLinks,
    otherLinks,
    archivePassword,
    fileCode,
  };
}

/**
 * Resolve Baidu Pan link for any game `postId` directly!
 * Implements the 3 paths discovered via REA:
 *   Step 1: GET /go?post_id={id} -> follow JS redirect to 520.gamers520.com or direct pan URL
 *   Step 2: If /go is empty (Switch/embedded posts), inspect /{id}.html directly for `.bdp-container`
 */
export async function resolveGamePanLinks(postId) {
  const id = Number(postId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("无效的游戏 ID");
  }

  const cached = panCache.get(id);
  if (cached && Date.now() - cached.ts < PAN_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  const detailUrl = `${BASE_ORIGIN}/${id}.html`;
  const goUrl = `${BASE_ORIGIN}/go?post_id=${id}`;

  let landingUrl = null;
  let extracted = {
    baiduLinks: [],
    otherLinks: [],
    archivePassword: "",
    fileCode: "",
  };

  // Path A: Try `/go?post_id={id}` first (fastest for PC games & trainers)
  const goRes = await smartFetchHtml(goUrl, detailUrl);
  const redirectMatch = goRes.html.match(
    /window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i
  );

  if (redirectMatch && redirectMatch[1] && !redirectMatch[1].startsWith("/go")) {
    landingUrl = new URL(redirectMatch[1], BASE_ORIGIN).href;

    if (/pan\.baidu\.com\/s\//i.test(landingUrl)) {
      let pwd = "";
      try {
        pwd = new URL(landingUrl).searchParams.get("pwd") || "";
      } catch {
        // ignore
      }
      extracted.baiduLinks.push({ url: landingUrl, pwd });
    } else if (/pan\.quark\.cn\/s\//i.test(landingUrl)) {
      extracted.otherLinks.push({ provider: "夸克网盘", url: landingUrl });
    } else if (/pan\.xunlei\.com\/s\//i.test(landingUrl)) {
      extracted.otherLinks.push({ provider: "迅雷云盘", url: landingUrl });
    } else {
      // Landing sub-site like https://520.gamers520.com/41523.html
      const landRes = await smartFetchHtml(landingUrl, detailUrl);
      extracted = extractPanLinksFromHtml(landRes.html);
    }
  }

  // Path B: If `/go` had no redirect (e.g. Switch games where `.bdp-container` is embedded in detail page)
  // or if no Baidu link was found yet, inspect `/{id}.html` directly
  if (extracted.baiduLinks.length === 0 && extracted.otherLinks.length === 0) {
    const detailRes = await smartFetchHtml(detailUrl, BASE_ORIGIN + "/");
    landingUrl = landingUrl || detailUrl;
    const fromDetail = extractPanLinksFromHtml(detailRes.html);
    extracted = {
      baiduLinks: fromDetail.baiduLinks,
      otherLinks: fromDetail.otherLinks,
      archivePassword: fromDetail.archivePassword || extracted.archivePassword,
      fileCode: fromDetail.fileCode || extracted.fileCode,
    };
  }

  const primaryBaidu = extracted.baiduLinks[0] || null;

  const data = {
    postId: id,
    source: "gamer520",
    detailUrl,
    landingUrl,
    hasBaidu: Boolean(primaryBaidu),
    baiduUrl: primaryBaidu ? primaryBaidu.url : null,
    baiduPwd: primaryBaidu ? primaryBaidu.pwd : null,
    baiduLinks: extracted.baiduLinks,
    otherLinks: extracted.otherLinks,
    archivePassword: extracted.archivePassword || "laoquzhang.com",
    fileCode: extracted.fileCode,
  };

  const usable =
    (data.baiduLinks?.length || 0) + (data.otherLinks?.length || 0) > 0;
  // 空结果不缓存，允许下次重试（含 source 回退）
  if (usable) {
    if (panCache.size > 500) {
      const oldest = panCache.keys().next().value;
      panCache.delete(oldest);
    }
    panCache.set(id, { ts: Date.now(), data });
  }

  return data;
}

/**
 * Collect promotional / screenshot images from a post's `.entry-content`.
 * Skips QR / pan / logo / tiny tracking images.
 */
export function extractGalleryImagesFromHtml(html) {
  const $ = cheerio.load(html);
  const $scope =
    $(".entry-content").length > 0
      ? $(".entry-content")
      : $("article").length > 0
        ? $("article")
        : $.root();

  const images = [];
  const seen = new Set();

  $scope.find("img").each((_, img) => {
    const src = (
      $(img).attr("data-src") ||
      $(img).attr("src") ||
      ""
    ).trim();
    if (!src || src.startsWith("data:")) return;
    if (/[?&]data=/i.test(src)) return;
    if (/qr|baidu|bdp|logo|avatar|emoji|icon|favicon|spinner|loading/i.test(src)) {
      return;
    }
    if (!/\.(jpe?g|png|webp|gif)(\?|$)/i.test(src) && !/cdn\.|steam|store_item/i.test(src)) {
      return;
    }
    const normalized = src.replace(/&amp;/g, "&");
    if (seen.has(normalized)) return;
    seen.add(normalized);
    images.push(normalized);
  });

  return images;
}

/**
 * Drop site meta / crack slogans / separator-only lines from description chunks.
 */
export function isJunkDescriptionLine(raw) {
  const text = String(raw || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return true;

  // Lone dashes / separators: -, —, －, ——, ···
  if (/^[\-–—－_·•●■□◇◆★☆=~～]+$/.test(text)) return true;
  if (text.length <= 2 && /^[\-–—－_·•]+$/.test(text)) return true;

  // Crack / unpack slogans
  if (
    /(D加密|加密已移除|免DVD|免CD|解压即撸|解压即玩|免安装|绿色版直玩|解锁补丁|免steam|免STEAM)/i.test(
      text
    ) &&
    text.length < 80
  ) {
    return true;
  }

  // On-page "how to get download" instructions
  if (
    /(用PC的用户|获取地址|立即获取|本页面顶部|点击.*?获取|右边.*?可看见|看见\s*\[?立即获取\]?)/i.test(
      text
    )
  ) {
    return true;
  }

  // Short pan / password / download meta
  if (
    text.length < 100 &&
    /(提取码|解压密码|pan\.baidu|夸克网盘|迅雷云盘|下载地址|网盘链接|百度网盘|复制链接)/i.test(
      text
    )
  ) {
    return true;
  }

  return false;
}

export function cleanDescriptionText(raw) {
  const lines = String(raw || "")
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/\u00a0/g, " ")
        // BOM / zero-width / object-replacement / private-use clutter
        .replace(/[\uFEFF\u200B-\u200D\u2060\uFFFC\uFFF9-\uFFFB]/g, "")
        .replace(/[\uE000-\uF8FF]/g, "")
        .replace(/\uFFFD/g, "")
        .replace(/[ \t]+/g, " ")
        // strip leading ornamental dashes/bullets
        .replace(/^[\-–—－·•●■□◆♦]+\s*/, "")
        .trim()
    )
    .filter((line) => !isJunkDescriptionLine(line));

  return lines.join("\n\n").trim();
}

/**
 * Full post description text from detail page (not the truncated list excerpt).
 */
export function extractDescriptionFromHtml(html) {
  const $ = cheerio.load(html);
  const $scope =
    $(".entry-content").length > 0
      ? $(".entry-content").first().clone()
      : $("article .entry-content, article").first().clone();

  if (!$scope.length) return "";

  $scope
    .find(
      "script, style, .bdp-container, .bdp-baidu, .copypaw, noscript, iframe, .social-share, .post-actions, .entry-tags, hr"
    )
    .remove();

  const chunks = [];
  $scope.find("p, h2, h3, li, blockquote").each((_, el) => {
    // 保留 <br> 分段，避免标题与正文黏在同一行
    const $el = $(el).clone();
    $el.find("br").replaceWith("\n");
    const text = $el
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n[ \t]+/g, "\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
    if (isJunkDescriptionLine(text)) return;
    chunks.push(text.replace(/^[\-–—－·•●■□◆♦]+\s*/gm, "").trim());
  });

  if (chunks.length === 0) {
    const fallback = $scope
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return cleanDescriptionText(fallback.slice(0, 2000));
  }

  return cleanDescriptionText(chunks.join("\n\n"));
}

export async function fetchGameGallery(postId) {
  const id = Number(postId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("无效的游戏 ID");
  }

  const cached = galleryCache.get(id);
  if (cached && Date.now() - cached.ts < GALLERY_TTL_MS) {
    return {
      ...cached.data,
      description: cleanDescriptionText(cached.data.description || ""),
      cached: true,
    };
  }

  const detailUrl = `${BASE_ORIGIN}/${id}.html`;
  const detailRes = await smartFetchHtml(detailUrl, BASE_ORIGIN + "/");
  const images = extractGalleryImagesFromHtml(detailRes.html);
  const description = extractDescriptionFromHtml(detailRes.html);

  const data = {
    postId: id,
    detailUrl,
    images,
    description,
  };

  if (galleryCache.size > 500) {
    const oldest = galleryCache.keys().next().value;
    galleryCache.delete(oldest);
  }
  galleryCache.set(id, { ts: Date.now(), data });

  return data;
}
