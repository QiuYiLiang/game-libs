import * as cheerio from "cheerio";
import {
  cleanDescriptionText,
  extractDescriptionFromHtml,
  extractGalleryImagesFromHtml,
  extractPanLinksFromHtml,
  smartFetchHtml,
} from "./gamer520.mjs";

export const PS_ORIGIN = "https://2468c.com";
export const PS_SOURCE = "ps2468c";

/** 源站分栏（合并进统一 PS 导航，标签仍按此区分） */
export const PS_PLATFORM_CATEGORIES = ["ps5game", "ps4", "ps-vr"];

/** 导航 / API 可识别的 PS 分类（含聚合 slug） */
export const PS_ALLOWED_CATEGORIES = new Set([
  "ps",
  "all",
  ...PS_PLATFORM_CATEGORIES,
]);

const listCache = new Map();
const panCache = new Map();
const galleryCache = new Map();
/** 详情 HTML 短缓存：gallery / pan 共用，避免同一页抓两次 */
const detailHtmlCache = new Map();
const LIST_TTL_MS = 3 * 60 * 1000;
const PAN_TTL_MS = 30 * 60 * 1000;
const GALLERY_TTL_MS = 30 * 60 * 1000;
const DETAIL_HTML_TTL_MS = 10 * 60 * 1000;

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

function cacheKey(id) {
  return `${PS_SOURCE}:${id}`;
}

function isLikelyPsDetailHtml(html) {
  if (!html || html.length < 3000) return false;
  return /bdp-container|entry-content|post-\d+/i.test(html);
}

async function fetchPsDetailHtml(id, { bypassCache = false } = {}) {
  const key = cacheKey(id);
  if (!bypassCache) {
    const cached = detailHtmlCache.get(key);
    if (
      cached &&
      Date.now() - cached.ts < DETAIL_HTML_TTL_MS &&
      isLikelyPsDetailHtml(cached.html)
    ) {
      return { status: cached.status || 200, html: cached.html, cached: true };
    }
  }
  const detailUrl = `${PS_ORIGIN}/${id}.html`;
  let detailRes = await smartFetchHtml(detailUrl, `${PS_ORIGIN}/`);
  // 挑战页 / 空壳再拉一次
  if (!isLikelyPsDetailHtml(detailRes.html) || detailRes.status >= 400) {
    detailRes = await smartFetchHtml(detailUrl, `${PS_ORIGIN}/`);
  }
  if (detailRes.status < 400 && isLikelyPsDetailHtml(detailRes.html)) {
    if (detailHtmlCache.size > 200) {
      const oldest = detailHtmlCache.keys().next().value;
      detailHtmlCache.delete(oldest);
    }
    detailHtmlCache.set(key, {
      ts: Date.now(),
      status: detailRes.status,
      html: detailRes.html,
    });
  }
  return detailRes;
}

function buildPsPanData(id, html) {
  const detailUrl = `${PS_ORIGIN}/${id}.html`;
  const extracted = extractPsFormatGroupsFromHtml(html);

  const seenBaidu = new Set();
  const baiduLinks = [];
  for (const b of extracted.baiduLinks) {
    if (seenBaidu.has(b.url)) continue;
    seenBaidu.add(b.url);
    baiduLinks.push(b);
  }

  const seenOther = new Set();
  const otherLinks = [];
  for (const o of extracted.otherLinks) {
    const k = `${o.provider}|${o.url}`;
    if (seenOther.has(k)) continue;
    seenOther.add(k);
    otherLinks.push(o);
  }

  const primaryBaidu = baiduLinks[0] || null;
  return {
    postId: id,
    source: PS_SOURCE,
    detailUrl,
    landingUrl: detailUrl,
    hasBaidu: Boolean(primaryBaidu),
    baiduUrl: primaryBaidu ? primaryBaidu.url : null,
    baiduPwd: primaryBaidu ? primaryBaidu.pwd : null,
    baiduLinks,
    otherLinks,
    formatGroups: extracted.formatGroups,
    archivePassword: extracted.archivePassword || "",
    fileCode: extracted.fileCode || "",
  };
}

function isUsablePsPan(data) {
  if (!data) return false;
  if ((data.formatGroups?.length || 0) > 0) return true;
  return (
    (data.baiduLinks?.length || 0) + (data.otherLinks?.length || 0) > 0
  );
}

function storePsPanData(id, data) {
  // 空结果不缓存，避免把一次失败锁死半小时
  if (!isUsablePsPan(data)) return;
  const key = cacheKey(id);
  if (panCache.size > 500) {
    const oldest = panCache.keys().next().value;
    panCache.delete(oldest);
  }
  panCache.set(key, { ts: Date.now(), data });
}

/**
 * 解析 2468c 列表页（RiPro article.post-grid，结构与 gamer520 接近）。
 */
export function parsePsGamesPageHtml(html, currentPage = 1) {
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
      $el.find(".entry-media img").first().attr("alt") ||
      ""
    ).trim();
    if (!rawTitle) return;

    const url = $titleLink.attr("href") || `${PS_ORIGIN}/${id}.html`;

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
    const seenCatSlugs = new Set();
    const pushCat = (name, slug) => {
      if (!name || !slug || seenCatSlugs.has(slug)) return;
      seenCatSlugs.add(slug);
      categories.push({ name, slug });
    };

    $el.find(".meta-category a").each((__, catEl) => {
      const $cat = $(catEl);
      const name = $cat.text().replace(/\s+/g, " ").trim();
      const href = $cat.attr("href") || "";
      let slug = href.replace(/^https?:\/\/[^/]+\//, "").replace(/\/$/, "");
      // 子分类 URL：ps5game/fpkg → 优先收成平台 slug
      if (slug.includes("/")) {
        const parts = slug.split("/").filter(Boolean);
        const navHit = parts.find((p) => PS_PLATFORM_CATEGORIES.includes(p));
        slug = navHit || parts[parts.length - 1] || slug;
      }
      if (name) {
        const platformName =
          slug === "ps5game"
            ? "PS5"
            : slug === "ps4"
              ? "PS4"
              : slug === "ps-vr"
                ? "PS VR"
                : name;
        pushCat(platformName, slug);
      }
    });

    // 从 class 补全平台（按完整 class token，避免 category-ps 误伤 ps5game）
    const classTokens = new Set(($el.attr("class") || "").split(/\s+/));
    for (const cat of PS_PLATFORM_CATEGORIES) {
      if (!classTokens.has(`category-${cat}`)) continue;
      const label =
        cat === "ps5game" ? "PS5" : cat === "ps4" ? "PS4" : "PS VR";
      pushCat(label, cat);
    }

    const excerpt = $el
      .find(".entry-excerpt")
      .text()
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const $time = $el.find(".meta-date time").first();
    const datetime = $time.attr("datetime") || "";
    const dateLabel = $time.text().replace(/\s+/g, " ").trim();
    const { mainTitle, tags } = splitGameTitle(rawTitle);

    items.push({
      id,
      source: PS_SOURCE,
      rawTitle,
      mainTitle,
      tags,
      url,
      cover,
      categories,
      excerpt,
      datetime,
      dateLabel,
      priceLabel: "免费",
    });
  });

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

  return { items, page: currentPage, totalPages };
}

function buildPsListUrl(category, page, search, order) {
  let targetUrl;
  if (search) {
    const encodedS = encodeURIComponent(search);
    targetUrl =
      page > 1
        ? `${PS_ORIGIN}/page/${page}?s=${encodedS}`
        : `${PS_ORIGIN}/?s=${encodedS}`;
  } else {
    targetUrl =
      page > 1
        ? `${PS_ORIGIN}/${category}/page/${page}`
        : `${PS_ORIGIN}/${category}`;
  }
  if (order === "hot") {
    targetUrl += targetUrl.includes("?") ? "&order=hot" : "?order=hot";
  }
  return targetUrl;
}

function itemTimeMs(item) {
  const t = Date.parse(item?.datetime || "");
  return Number.isFinite(t) ? t : 0;
}

async function fetchPsCategoryPage(category, page, order) {
  const targetUrl = buildPsListUrl(category, page, "", order);
  const res = await smartFetchHtml(targetUrl, `${PS_ORIGIN}/`);
  if (res.status >= 400 || !res.html || res.html.length < 1000) {
    throw new Error(`2468c 列表请求失败 (${category}, ${res.status})`);
  }
  const parsed = parsePsGamesPageHtml(res.html, page);
  return { ...parsed, sourceUrl: targetUrl };
}

/**
 * PS 列表：默认合并 PS5 / PS4 / PS VR，卡片用标签区分平台。
 * category=ps4|ps-vr|ps5game 仍可拉单栏（兼容）；ps / all / ps5game(导航) 走合并。
 */
export async function fetchPsGamesList({
  page = 1,
  category = "ps",
  search = "",
  order = "date",
} = {}) {
  const safePage = Math.max(1, Math.min(2000, Number(page) || 1));
  const rawCat = String(category || "ps").trim();
  const cleanCat = PS_ALLOWED_CATEGORIES.has(rawCat) ? rawCat : "ps";
  const cleanSearch = String(search || "").trim();
  const cleanOrder = order === "hot" ? "hot" : "date";

  const mergeAll =
    cleanCat === "ps" ||
    cleanCat === "all" ||
    // 导航历史默认 slug，统一视为「全部 PS」
    cleanCat === "ps5game";

  const cacheKeyStr = `list:${mergeAll ? "ps-all" : cleanCat}:${cleanSearch}:${cleanOrder}:${safePage}`;
  const cached = listCache.get(cacheKeyStr);
  if (cached && Date.now() - cached.ts < LIST_TTL_MS) {
    return { ...cached.data, cached: true };
  }

  let data;

  if (cleanSearch) {
    const targetUrl = buildPsListUrl("ps5game", safePage, cleanSearch, cleanOrder);
    const res = await smartFetchHtml(targetUrl, `${PS_ORIGIN}/`);
    if (res.status >= 400 || !res.html || res.html.length < 1000) {
      throw new Error(`2468c 搜索请求失败 (${res.status})`);
    }
    const parsed = parsePsGamesPageHtml(res.html, safePage);
    data = {
      ...parsed,
      category: "ps",
      search: cleanSearch,
      order: cleanOrder,
      sourceUrl: targetUrl,
      source: PS_SOURCE,
    };
  } else if (mergeAll) {
    const pages = await Promise.all(
      PS_PLATFORM_CATEGORIES.map((cat) =>
        fetchPsCategoryPage(cat, safePage, cleanOrder).catch((err) => {
          console.error("[PS list]", cat, err);
          return { items: [], page: safePage, totalPages: 1, sourceUrl: "" };
        })
      )
    );

    const byId = new Map();
    for (const block of pages) {
      for (const item of block.items || []) {
        const prev = byId.get(item.id);
        if (!prev) {
          byId.set(item.id, item);
          continue;
        }
        // 合并分类标签（同一帖可能跨栏）
        const catMap = new Map(
          [...(prev.categories || []), ...(item.categories || [])].map((c) => [
            c.slug,
            c,
          ])
        );
        byId.set(item.id, {
          ...prev,
          categories: [...catMap.values()],
        });
      }
    }

    const items = [...byId.values()].sort(
      (a, b) => itemTimeMs(b) - itemTimeMs(a)
    );
    const totalPages = Math.max(
      1,
      ...pages.map((p) => Number(p.totalPages) || 1)
    );

    data = {
      items,
      page: safePage,
      totalPages,
      category: "ps",
      search: "",
      order: cleanOrder,
      sourceUrl: `${PS_ORIGIN}/ (ps5game+ps4+ps-vr)`,
      source: PS_SOURCE,
    };
  } else {
    const parsed = await fetchPsCategoryPage(cleanCat, safePage, cleanOrder);
    data = {
      ...parsed,
      category: cleanCat,
      search: "",
      order: cleanOrder,
      source: PS_SOURCE,
    };
  }

  if (listCache.size > 80) {
    const oldest = listCache.keys().next().value;
    listCache.delete(oldest);
  }
  listCache.set(cacheKeyStr, { ts: Date.now(), data });
  return data;
}

/**
 * 从备注推导短格式名，供一级菜单展示（保留版本 / PPSA / 中配等关键信息）。
 */
export function shortFormatLabel(remark, index) {
  const raw = String(remark || "")
    .replace(/^以下为\s*/u, "")
    .replace(/^此为\s*/u, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return `格式 ${index + 1}`;

  const bits = [];

  // 版本号：v01.000.151 / v1.200.000 / 01.000.568
  const ver =
    raw.match(/\bv\d+(?:\.\d+){1,4}\b/i) ||
    raw.match(/\b\d{2}\.\d{3}\.\d{3}\b/);
  if (ver) bits.push(ver[0]);

  const ppsa = raw.match(/PPSA\d+/i);
  if (ppsa) bits.push(ppsa[0]);

  // 固件要求：4.xx / 10.xx
  const fw = raw.match(/\b\d{1,2}\.xx\b/i);
  if (fw) bits.push(fw[0]);

  if (/无中配/u.test(raw)) bits.push("无中配");
  else if (/中配/u.test(raw)) bits.push("中配");
  else if (/含中文补丁|中文补丁/u.test(raw)) bits.push("中文补丁");

  if (/exFAT/i.test(raw)) bits.push("exFAT");
  else if (/fpkg/i.test(raw)) bits.push("fpkg");
  else if (/ZSTD|LZ4/i.test(raw)) bits.push("ZSTD");
  else if (/文件夹/u.test(raw)) bits.push("文件夹");

  if (bits.length > 0) return bits.join(" · ");

  const cleaned = raw
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/格式\s*$/u, "")
    .trim();
  if (!cleaned) return `格式 ${index + 1}`;
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
}

function classifyUrl(u) {
  if (/pan\.baidu\.com\/s\//i.test(u)) {
    let pwd = "";
    try {
      pwd = new URL(u).searchParams.get("pwd") || "";
    } catch {
      const pm = u.match(/[?&]pwd=([a-zA-Z0-9]+)/i);
      if (pm) pwd = pm[1];
    }
    return { kind: "baidu", url: u, pwd };
  }
  if (/pan\.quark\.cn\/s\//i.test(u)) {
    return { kind: "other", provider: "夸克网盘", url: u };
  }
  if (/pan\.xunlei\.com\/s\//i.test(u)) {
    return { kind: "other", provider: "迅雷云盘", url: u };
  }
  if (/gofile\.io\//i.test(u)) {
    return { kind: "other", provider: "Gofile", url: u };
  }
  return null;
}

/**
 * 按 `.bdp-container` 拆成「游戏格式 → 下载方式」分组。
 */
export function extractPsFormatGroupsFromHtml(html) {
  const $ = cheerio.load(html);
  const $containers = $(".bdp-container");
  if ($containers.length === 0) {
    const flat = extractPanLinksFromHtml(html);
    if (flat.baiduLinks.length === 0 && flat.otherLinks.length === 0) {
      return { formatGroups: [], ...flat };
    }
    return {
      formatGroups: [
        {
          id: "format-0",
          label: "默认格式",
          remark: "",
          baiduLinks: flat.baiduLinks,
          otherLinks: flat.otherLinks,
          archivePassword: flat.archivePassword || "",
        },
      ],
      baiduLinks: flat.baiduLinks,
      otherLinks: flat.otherLinks,
      archivePassword: flat.archivePassword || "",
      fileCode: flat.fileCode || "",
    };
  }

  const formatGroups = [];
  const allBaidu = [];
  const allOther = [];
  let archivePassword = "";
  let fileCode = "";

  $containers.each((idx, el) => {
    const $c = $(el);
    const remark =
      $c.find(".bdp-remark-badge strong").first().text().trim() ||
      $c.find(".bdp-remark-badge").first().text().replace(/^备注[：:]\s*/u, "").trim() ||
      $c.find(".bdp-header h3").first().text().trim() ||
      "";
    const unzip =
      $c.find(".bdp-unzip-badge strong").first().text().trim() || "";
    if (unzip && !archivePassword) archivePassword = unzip;

    const foundUrls = [];
    $c.find("img").each((_, img) => {
      const src = $(img).attr("src") || $(img).attr("data-src") || "";
      const m = src.match(/[?&]data=([^&"'<>]+)/i);
      if (m) {
        try {
          foundUrls.push(decodeURIComponent(m[1]));
        } catch {
          // ignore
        }
      }
    });
    $c.find("a[href]").each((_, a) => {
      const href = ($(a).attr("href") || "").trim();
      if (href.startsWith("http")) foundUrls.push(href);
    });

    const baiduLinks = [];
    const otherLinks = [];
    const seen = new Set();
    for (const raw of foundUrls) {
      const u = raw.replace(/&amp;/g, "&").trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      const hit = classifyUrl(u);
      if (!hit) continue;
      if (hit.kind === "baidu") {
        // 卡片内提取码兜底
        let pwd = hit.pwd;
        if (!pwd) {
          pwd =
            $c.find(".bdp-pwd-box strong").first().text().trim() ||
            ($c.text().match(/提取码\s*[:：]\s*([a-zA-Z0-9]{4})\b/) || [])[1] ||
            "";
          if (pwd) {
            const sep = u.includes("?") ? "&" : "?";
            baiduLinks.push({ url: `${u}${sep}pwd=${pwd}`, pwd });
            continue;
          }
        }
        baiduLinks.push({ url: u, pwd });
      } else {
        otherLinks.push({ provider: hit.provider, url: u });
      }
    }

    if (baiduLinks.length === 0 && otherLinks.length === 0) return;

    formatGroups.push({
      id: `format-${idx}`,
      label: shortFormatLabel(remark, idx),
      remark,
      baiduLinks,
      otherLinks,
      archivePassword: unzip || "",
    });
    allBaidu.push(...baiduLinks);
    allOther.push(...otherLinks);
  });

  const fileCodeEl = $(".copypaw").first();
  fileCode =
    fileCodeEl.attr("data-clipboard-text") ||
    fileCodeEl.text().trim() ||
    "";

  return {
    formatGroups,
    baiduLinks: allBaidu,
    otherLinks: allOther,
    archivePassword,
    fileCode,
  };
}

/**
 * 解析 2468c 详情页内嵌网盘（按格式分组：百度 / 夸克 / 迅雷等）。
 */
export async function resolvePsPanLinks(postId) {
  const id = Number(postId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("无效的游戏 ID");
  }

  const key = cacheKey(id);
  const cached = panCache.get(key);
  if (cached && Date.now() - cached.ts < PAN_TTL_MS) {
    const data = { ...cached.data, cached: true };
    // 刷新短标签（备注规则更新后旧缓存也能立刻用上）
    if (Array.isArray(data.formatGroups)) {
      data.formatGroups = data.formatGroups.map((g, i) => ({
        ...g,
        label: shortFormatLabel(g.remark || g.label, i),
      }));
    }
    return data;
  }

  let detailRes = await fetchPsDetailHtml(id);
  if (detailRes.status >= 400 || !isLikelyPsDetailHtml(detailRes.html)) {
    detailHtmlCache.delete(key);
    detailRes = await fetchPsDetailHtml(id, { bypassCache: true });
  }
  if (detailRes.status >= 400 || !isLikelyPsDetailHtml(detailRes.html)) {
    throw new Error(`2468c 详情请求失败 (${detailRes.status})`);
  }

  let data = buildPsPanData(id, detailRes.html);
  if (!isUsablePsPan(data)) {
    detailHtmlCache.delete(key);
    detailRes = await fetchPsDetailHtml(id, { bypassCache: true });
    if (isLikelyPsDetailHtml(detailRes.html)) {
      data = buildPsPanData(id, detailRes.html);
    }
  }
  storePsPanData(id, data);
  return data;
}

export async function fetchPsGameGallery(postId) {
  const id = Number(postId);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("无效的游戏 ID");
  }

  const key = cacheKey(id);
  const cached = galleryCache.get(key);
  if (
    cached &&
    Date.now() - cached.ts < GALLERY_TTL_MS &&
    typeof cached.data?.description === "string" &&
    cached.data.description.trim()
  ) {
    return {
      ...cached.data,
      description: cleanDescriptionText(cached.data.description || ""),
      cached: true,
    };
  }

  const detailRes = await fetchPsDetailHtml(id);
  if (detailRes.status >= 400 || !detailRes.html) {
    throw new Error(`2468c 详情请求失败 (${detailRes.status})`);
  }

  const images = extractGalleryImagesFromHtml(detailRes.html);
  const description = extractDescriptionFromHtml(detailRes.html);
  // 同页顺带预热 pan 缓存；下载仍走点击后 /pan，但通常可命中缓存
  storePsPanData(id, buildPsPanData(id, detailRes.html));

  const data = {
    postId: id,
    source: PS_SOURCE,
    detailUrl: `${PS_ORIGIN}/${id}.html`,
    images,
    description,
  };

  if (galleryCache.size > 300) {
    const oldest = galleryCache.keys().next().value;
    galleryCache.delete(oldest);
  }
  galleryCache.set(key, { ts: Date.now(), data });
  return data;
}

export function isPsSource(source) {
  return source === PS_SOURCE || source === "ps";
}

export function isPsCategorySlug(slug) {
  return PS_ALLOWED_CATEGORIES.has(String(slug || ""));
}
