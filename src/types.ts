export interface GameCategory {
  name: string;
  slug: string;
}

export type GameSource = "gamer520" | "ps2468c";

export const PS_SOURCE: GameSource = "ps2468c";
export const DEFAULT_SOURCE: GameSource = "gamer520";

/** 统一 PS 导航及相关源站 slug */
export const PS_NAV_SLUGS = ["ps", "ps5game", "ps4", "ps-vr"] as const;

export function isPsGameSource(source?: string | null): boolean {
  return source === PS_SOURCE || source === "ps";
}

export function isPsNavSlug(slug?: string | null): boolean {
  return Boolean(
    slug && (PS_NAV_SLUGS as readonly string[]).includes(slug)
  );
}

/** 非默认源时拼到 API query */
export function sourceQuery(source?: string | null): string {
  return source && source !== DEFAULT_SOURCE
    ? `?source=${encodeURIComponent(source)}`
    : "";
}

export interface GameItem {
  id: number;
  /** 列表/网盘数据来源；PS 站与 gamer520 可能撞号，必须区分 */
  source?: GameSource;
  rawTitle: string;
  mainTitle: string;
  tags: string[];
  url: string;
  cover: string;
  categories: GameCategory[];
  excerpt: string;
  datetime: string;
  dateLabel: string;
  priceLabel: string;
}

export type SortOrder = "date" | "hot";

export interface GamesListResponse {
  ok: boolean;
  items: GameItem[];
  page: number;
  totalPages: number;
  category: string;
  search: string;
  order?: SortOrder;
  sourceUrl: string;
  cached?: boolean;
  error?: string;
}

export interface BaiduLinkEntry {
  url: string;
  pwd: string;
}

export interface OtherLinkEntry {
  provider: string;
  url: string;
}

/** PS 站按游戏格式分组的网盘（一级菜单 = 格式，二级 = 下载方式） */
export interface PanFormatGroup {
  id: string;
  /** 展示名，如 fpkg / exFAT / 文件夹 */
  label: string;
  /** 原始备注（完整说明） */
  remark?: string;
  baiduLinks: BaiduLinkEntry[];
  otherLinks: OtherLinkEntry[];
  archivePassword?: string;
}

export interface PanResolveResponse {
  ok: boolean;
  postId: number;
  source?: GameSource;
  detailUrl: string;
  landingUrl: string | null;
  hasBaidu: boolean;
  baiduUrl: string | null;
  baiduPwd: string | null;
  baiduLinks: BaiduLinkEntry[];
  otherLinks: OtherLinkEntry[];
  /** PS 等多格式资源；非空时前端走二级菜单 */
  formatGroups?: PanFormatGroup[];
  archivePassword: string;
  fileCode: string;
  cached?: boolean;
  error?: string;
}

export interface GalleryResponse {
  ok: boolean;
  postId: number;
  detailUrl: string;
  images: string[];
  description?: string;
  cached?: boolean;
  error?: string;
}

export function panHasLinks(
  pan?: Pick<
    PanResolveResponse,
    "formatGroups" | "baiduLinks" | "otherLinks"
  > | null
): boolean {
  if (!pan) return false;
  if ((pan.formatGroups?.length || 0) > 0) return true;
  return (pan.baiduLinks?.length || 0) + (pan.otherLinks?.length || 0) > 0;
}

export interface NavCategory {
  label: string;
  /** URL 语义化路径段，如 recommend / pc */
  path: string;
  /** 源站 API 分类 slug */
  slug: string;
  /** 游戏上匹配到任一即可归入该导航项（含合并分类） */
  matchSlugs?: string[];
}

export const NAV_CATEGORIES: NavCategory[] = [
  {
    label: "推荐",
    path: "recommend",
    slug: "ign-hot",
    matchSlugs: ["ign-hot", "3ajuzuo"],
  },
  {
    label: "PC",
    path: "pc",
    slug: "pcplay",
    /** Switch 移植并入 PC 导航，列表仍走 pcplay */
    matchSlugs: ["pcplay", "yzb"],
  },
  { label: "Switch", path: "switch", slug: "gameswitch" },
  {
    label: "PS",
    path: "ps",
    /** 聚合 PS5 / PS4 / PS VR；卡片标签区分平台 */
    slug: "ps",
    matchSlugs: ["ps", "ps5game", "ps4", "ps-vr"],
  },
  {
    label: "修改器",
    path: "trainer",
    slug: "xgq",
    matchSlugs: ["xgq", "jinshouzhi"],
  },
  { label: "模拟器", path: "emulator", slug: "zhangji" },
];

/** 卡片/详情标签文案；合并进导航后仍可显示独立名 */
const CATEGORY_TAG_LABELS: Record<string, string> = {
  yzb: "Switch 移植",
  ps5game: "PS5",
  ps4: "PS4",
  "ps-vr": "PS VR",
};

/** 已下线的语义 path → 合并后的 path */
const NAV_PATH_REDIRECTS: Record<string, string> = {
  "switch-port": "pc",
};

export const DEFAULT_CATEGORY_PATH = NAV_CATEGORIES[0]?.path || "recommend";

export function getNavByPath(path: string): NavCategory | undefined {
  return NAV_CATEGORIES.find((c) => c.path === path);
}

export function getNavBySlug(slug: string): NavCategory | undefined {
  return NAV_CATEGORIES.find(
    (c) => c.slug === slug || c.matchSlugs?.includes(slug)
  );
}

/** 路由段是否为合法语义 path；顺带识别旧 slug / 合并 path 以便重定向 */
export function resolveNavPath(segment: string): string | null {
  if (NAV_PATH_REDIRECTS[segment]) return NAV_PATH_REDIRECTS[segment];
  if (getNavByPath(segment)) return segment;
  const bySlug = getNavBySlug(segment);
  return bySlug?.path ?? null;
}

export function isNavCategoryPath(path: string): boolean {
  return Boolean(getNavByPath(path));
}

/**
 * 仅保留导航相关分类作标签。
 * 同一导航下不同源 slug 可保留独立文案（如 yzb →「Switch 移植」）。
 */
export function filterNavCategories(
  categories: GameCategory[]
): GameCategory[] {
  const gameSlugs = new Set(categories.map((c) => c.slug));
  const result: GameCategory[] = [];
  const seenNames = new Set<string>();

  for (const nav of NAV_CATEGORIES) {
    if (!nav.slug) continue;
    const match = nav.matchSlugs ?? [nav.slug];
    for (const slug of match) {
      if (!gameSlugs.has(slug)) continue;
      const name = CATEGORY_TAG_LABELS[slug] ?? nav.label;
      if (seenNames.has(name)) continue;
      seenNames.add(name);
      result.push({ slug, name });
    }
  }
  return result;
}
