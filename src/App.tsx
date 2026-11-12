import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Flame,
  Monitor,
  Moon,
  Search,
  Settings2,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  DEFAULT_CATEGORY_PATH,
  DEFAULT_SOURCE,
  NAV_CATEGORIES,
  PS_SOURCE,
  getNavByPath,
  getNavBySlug,
  isPsNavSlug,
  panHasLinks,
  resolveNavPath,
  type GameItem,
  type GamesListResponse,
  type PanResolveResponse,
  type SortOrder,
} from "./types";
import { GameCard } from "./components/GameCard";
import { GameDetailModal } from "./components/GameDetailModal";

interface ToastMessage {
  id: number;
  title: string;
  sub?: string;
  kind: "success" | "warn" | "error";
}

type ThemeMode = "light" | "dark";

const THEME_KEY = "gamer520-theme";

function readInitialTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // ignore
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  ) {
    return "dark";
  }
  return "light";
}

function parseSortOrder(value: string | null): SortOrder {
  return value === "hot" ? "hot" : "date";
}

function parsePage(value: string | null): number {
  const n = Number.parseInt(value || "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

type NavIconProps = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/** Nintendo Switch logo（Simple Icons 官方路径） */
function SwitchConsoleIcon({ size = 15, className }: NavIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M14.176 24h3.674c3.376 0 6.15-2.774 6.15-6.15V6.15C24 2.775 21.226 0 17.85 0H14.1c-.074 0-.15.074-.15.15v23.7c.001.076.075.15.226.15m4.574-13.199c1.351 0 2.399 1.125 2.399 2.398 0 1.352-1.125 2.4-2.399 2.4-1.35 0-2.4-1.049-2.4-2.4-.075-1.349 1.05-2.398 2.4-2.398M11.4 0H6.15C2.775 0 0 2.775 0 6.15v11.7C0 21.226 2.775 24 6.15 24h5.25c.074 0 .15-.074.15-.149V.15C11.475.074 11.4 0 11.4 0M9.676 22.051H6.15a4.194 4.194 0 0 1-4.201-4.201V6.15A4.194 4.194 0 0 1 6.15 1.949H9.6zM3.75 7.199c0 1.275.975 2.25 2.25 2.25s2.25-.975 2.25-2.25c0-1.273-.975-2.25-2.25-2.25s-2.25.977-2.25 2.25" />
    </svg>
  );
}

/** 家用主机轮廓（模拟器） */
function ConsoleIcon({
  size = 15,
  strokeWidth = 2.2,
  className,
}: NavIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="2" y="7" width="20" height="11" rx="2.5" />
      <circle cx="7" cy="12.5" r="1.6" />
      <path d="M12 11.5h7" />
      <path d="M12 14h4.5" />
      <path d="M6.2 7V5.5A1.5 1.5 0 0 1 7.7 4h8.6A1.5 1.5 0 0 1 17.8 5.5V7" />
    </svg>
  );
}

/** PlayStation logo（Simple Icons） */
function PlaystationIcon({ size = 15, className }: NavIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M8.984 2.596v17.547l3.915 1.261V6.688c0-.69.304-1.151.794-.991.636.18.76.814.76 1.505v5.875c2.441 1.193 4.362-.002 4.362-3.152 0-3.237-1.126-4.675-4.438-5.827-1.307-.448-3.728-1.186-5.39-1.502zm4.656 16.241l6.296-2.275c.715-.258.826-.625.246-.818-.586-.192-1.637-.139-2.357.123l-4.205 1.5V14.98l.24-.085s1.201-.42 2.913-.615c1.696-.18 3.785.03 5.437.661 1.848.601 2.04 1.472 1.576 2.072-.465.6-1.622 1.036-1.622 1.036l-8.544 3.107V18.86zM1.807 18.6c-1.9-.545-2.214-1.668-1.352-2.32.801-.586 2.16-1.052 2.16-1.052l5.615-2.013v2.313L4.205 17c-.705.271-.825.632-.239.826.586.195 1.637.15 2.343-.12L8.247 17v2.074c-.12.03-.256.044-.39.073-1.939.331-3.996.196-6.038-.479z" />
    </svg>
  );
}

const CATEGORY_ICONS: Record<string, React.FC<NavIconProps>> = {
  recommend: Sparkles,
  pc: Monitor,
  switch: SwitchConsoleIcon,
  ps: PlaystationIcon,
  trainer: Settings2,
  emulator: ConsoleIcon,
};

function buildListPath(opts: {
  /** 语义化 path，如 recommend */
  categoryPath: string;
  search: string;
  page: number;
  order: SortOrder;
  gameId?: number | null;
}): string {
  const params = new URLSearchParams();
  if (opts.page > 1) params.set("page", String(opts.page));
  if (opts.order !== "date") params.set("order", opts.order);

  let base: string;
  if (opts.search) {
    base = "/search";
    params.set("q", opts.search);
  } else {
    base = `/c/${opts.categoryPath || DEFAULT_CATEGORY_PATH}`;
  }

  if (opts.gameId) {
    base = `${base}/game/${opts.gameId}`;
  }

  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

/** 导航入参可能是 path 或源站 slug，统一成语义 path */
function toCategoryPath(pathOrSlug: string): string {
  return (
    resolveNavPath(pathOrSlug) ||
    getNavBySlug(pathOrSlug)?.path ||
    DEFAULT_CATEGORY_PATH
  );
}

export const App: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ category?: string; gameId?: string }>();
  const [searchParams] = useSearchParams();
  const isSearchRoute = location.pathname.startsWith("/search");

  const routeCategory = params.category || "";
  const routeGameId = params.gameId ? Number(params.gameId) : null;
  const page = parsePage(searchParams.get("page"));
  const sortOrder = parseSortOrder(searchParams.get("order"));
  const activeSearch = isSearchRoute
    ? (searchParams.get("q") || "").trim()
    : "";

  const resolvedPath = useMemo(
    () => (routeCategory ? resolveNavPath(routeCategory) : null),
    [routeCategory]
  );

  const categoryPath = useMemo(() => {
    if (activeSearch) return DEFAULT_CATEGORY_PATH;
    return resolvedPath || DEFAULT_CATEGORY_PATH;
  }, [activeSearch, resolvedPath]);

  const categorySlug =
    getNavByPath(categoryPath)?.slug || NAV_CATEGORIES[0]?.slug || "ign-hot";

  const isPsList = categoryPath === "ps" || isPsNavSlug(categorySlug);

  /** 旧 slug URL（如 /c/ign-hot）→ 语义 path */
  const needsLegacyRedirect =
    !activeSearch &&
    !!routeCategory &&
    !!resolvedPath &&
    routeCategory !== resolvedPath;

  const categoryInvalid =
    !activeSearch && !!routeCategory && resolvedPath === null;

  const [games, setGames] = useState<GameItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(activeSearch);
  const [searchOpen, setSearchOpen] = useState(() => Boolean(activeSearch));
  const [totalPages, setTotalPages] = useState(1);
  const [jumpPageInput, setJumpPageInput] = useState(String(page));

  const [panCache, setPanCache] = useState<
    Record<string, PanResolveResponse>
  >({});
  const [detailGame, setDetailGame] = useState<GameItem | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [theme, setTheme] = useState<ThemeMode>(() => readInitialTheme());
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    // 与 index.html 启动脚本对齐，避免 inline 底色在切换主题后卡住
    root.style.backgroundColor = theme === "dark" ? "#070707" : "#e4e4e4";
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  useEffect(() => {
    setSearchInput(activeSearch);
    if (activeSearch) setSearchOpen(true);
  }, [activeSearch]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  const addToast = useCallback(
    (
      title: string,
      sub?: string,
      kind: "success" | "warn" | "error" = "success"
    ) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((prev) => [...prev.slice(-3), { id, title, sub, kind }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 3600);
    },
    []
  );

  const goToList = useCallback(
    (opts: {
      categoryPath?: string;
      search?: string;
      page?: number;
      order?: SortOrder;
      gameId?: number | null;
      replace?: boolean;
    }) => {
      const next = buildListPath({
        categoryPath: opts.categoryPath ?? categoryPath,
        search: opts.search ?? activeSearch,
        page: opts.page ?? page,
        order: opts.order ?? sortOrder,
        gameId: opts.gameId === undefined ? routeGameId : opts.gameId,
      });
      navigate(next, { replace: opts.replace });
    },
    [activeSearch, categoryPath, navigate, page, routeGameId, sortOrder]
  );

  const loadGames = useCallback(
    async (opts: {
      page: number;
      categorySlug: string;
      search: string;
      order: SortOrder;
    }) => {
      setLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(opts.page));
        params.set("order", opts.order);
        if (opts.categorySlug && !opts.search) {
          params.set("category", opts.categorySlug);
        }
        if (opts.search) params.set("search", opts.search);
        // PS 分类走 2468c（服务端合并 PS5/PS4/PS VR）；其余仍用 gamer520
        if (isPsNavSlug(opts.categorySlug)) {
          params.set("source", PS_SOURCE);
        }
        const res = await fetch(`/api/games?${params.toString()}`);
        const data = (await res.json()) as GamesListResponse;
        if (!res.ok || !data.ok) {
          throw new Error(data.error || `加载失败 (${res.status})`);
        }
        setGames(data.items);
        setTotalPages(Math.max(1, data.totalPages || 1));
        setJumpPageInput(String(data.page));
      } catch (err) {
        setListError(
          err instanceof Error ? err.message : "加载游戏列表失败，请稍后重试"
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (categoryInvalid || needsLegacyRedirect) return;
    loadGames({
      page,
      categorySlug,
      search: activeSearch,
      order: sortOrder,
    });
  }, [
    page,
    categorySlug,
    activeSearch,
    sortOrder,
    loadGames,
    categoryInvalid,
    needsLegacyRedirect,
  ]);

  // Sync detail modal with /game/:id
  useEffect(() => {
    if (!routeGameId || !Number.isFinite(routeGameId)) {
      setDetailGame(null);
      return;
    }
    const stateGame = (location.state as { game?: GameItem } | null)?.game;
    if (stateGame && stateGame.id === routeGameId) {
      setDetailGame(stateGame);
      return;
    }
    const fromList = games.find((g) => g.id === routeGameId);
    if (fromList) {
      setDetailGame(fromList);
      return;
    }
    setDetailGame((prev) =>
      prev?.id === routeGameId
        ? prev
        : {
            id: routeGameId,
            source: isPsList ? PS_SOURCE : DEFAULT_SOURCE,
            rawTitle: "加载中…",
            mainTitle: "加载中…",
            tags: [],
            url: "",
            cover: "",
            categories: [],
            excerpt: "",
            datetime: "",
            dateLabel: "",
            priceLabel: "",
          }
    );
  }, [routeGameId, games, location.state, isPsList]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchInput.trim();
    if (!trimmed) {
      goToList({ search: "", page: 1, gameId: null });
      return;
    }
    navigate(
      buildListPath({
        categoryPath,
        search: trimmed,
        page: 1,
        order: sortOrder,
        gameId: null,
      })
    );
  };

  const handleClearSearch = () => {
    setSearchInput("");
    setSearchOpen(false);
    goToList({
      search: "",
      categoryPath: categoryPath || DEFAULT_CATEGORY_PATH,
      page: 1,
      gameId: null,
    });
  };

  const handleCloseSearch = () => {
    if (searchInput.trim() || activeSearch) {
      handleClearSearch();
      return;
    }
    setSearchOpen(false);
  };

  /** 接受语义 path 或源站 slug */
  const handleSelectCategory = (pathOrSlug: string) => {
    const next = toCategoryPath(pathOrSlug);
    setSearchInput("");
    navigate(
      buildListPath({
        categoryPath: next,
        search: "",
        page: 1,
        order: sortOrder,
        gameId: null,
      })
    );
  };

  const handlePageChange = (nextPage: number) => {
    const clamped = Math.max(1, Math.min(totalPages, nextPage));
    if (clamped === page) return;
    goToList({ page: clamped, gameId: null });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSortChange = (order: SortOrder) => {
    if (order === sortOrder) return;
    goToList({ order, page: 1, gameId: null });
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number.parseInt(jumpPageInput, 10);
    if (Number.isFinite(num) && num >= 1) handlePageChange(num);
  };

  const panCacheKey = useCallback(
    (game: Pick<GameItem, "id" | "source">) =>
      `${game.source || DEFAULT_SOURCE}:${game.id}`,
    []
  );

  const handlePanResolved = useCallback(
    (postId: number, data: PanResolveResponse) => {
      if (!panHasLinks(data)) return;
      const source = data.source || DEFAULT_SOURCE;
      setPanCache((prev) => ({ ...prev, [`${source}:${postId}`]: data }));
    },
    []
  );

  const handleOpenDetail = (game: GameItem) => {
    navigate(
      buildListPath({
        categoryPath,
        search: activeSearch,
        page,
        order: sortOrder,
        gameId: game.id,
      }),
      { state: { game } }
    );
  };

  const handleCloseDetail = () => {
    goToList({ gameId: null });
  };

  const getVisiblePages = (): number[] => {
    const set = new Set([
      1,
      totalPages,
      page,
      page - 1,
      page + 1,
      page - 2,
      page + 2,
    ]);
    return [...set]
      .filter((p) => p >= 1 && p <= totalPages)
      .sort((a, b) => a - b);
  };

  if (categoryInvalid) {
    return <Navigate to={`/c/${DEFAULT_CATEGORY_PATH}`} replace />;
  }

  if (needsLegacyRedirect && resolvedPath) {
    const rest = location.pathname.replace(/^\/c\/[^/]+/, `/c/${resolvedPath}`);
    const qs = location.search;
    return <Navigate to={`${rest}${qs}`} replace />;
  }

  return (
    <div>
      <nav
        className={`toolbar sticky-toolbar${searchOpen ? " is-searching" : ""}`}
      >
        <div className="category-tabs" role="navigation" aria-label="分类">
          {NAV_CATEGORIES.map((item) => {
            const isActive = !activeSearch && categoryPath === item.path;
            const Icon = CATEGORY_ICONS[item.path] || Sparkles;
            return (
              <button
                key={item.path}
                type="button"
                className={`category-tab is-icon${isActive ? " active" : ""}`}
                onClick={() => handleSelectCategory(item.path)}
                aria-label={item.label}
                title={item.label}
              >
                <Icon size={15} strokeWidth={2.2} aria-hidden />
              </button>
            );
          })}
        </div>
        <form
          className={`search-form toolbar-search${searchOpen ? " is-open" : ""}`}
          onSubmit={handleSearchSubmit}
        >
          <input
            ref={searchInputRef}
            type="search"
            className="search-input"
            placeholder=""
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                handleCloseSearch();
              }
            }}
            aria-label="搜索游戏"
          />
          {(searchInput.trim() || activeSearch) && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={handleClearSearch}
              title="清空关键词"
              aria-label="清空关键词"
            >
              <X size={15} />
            </button>
          )}
          <button
            type="submit"
            className="search-icon-btn"
            title="搜索"
            aria-label="搜索"
          >
            <Search size={16} strokeWidth={2.25} />
          </button>
        </form>
        <div className="toolbar-actions">
          <button
            type="button"
            className="search-toggle"
            onClick={() => setSearchOpen(true)}
            title="搜索"
            aria-label="打开搜索"
          >
            <Search size={16} strokeWidth={2.25} />
          </button>
          <div className="sort-toggle" role="group" aria-label="排序方式">
            <button
              type="button"
              className={`sort-btn ${sortOrder === "date" ? "active" : ""}`}
              onClick={() => handleSortChange("date")}
              aria-label="按时间排序"
              title="时间"
            >
              <Clock size={15} strokeWidth={2.2} aria-hidden />
            </button>
            <button
              type="button"
              className={`sort-btn ${sortOrder === "hot" ? "active" : ""}`}
              onClick={() => handleSortChange("hot")}
              aria-label="按热度排序"
              title="热度"
            >
              <Flame size={15} strokeWidth={2.2} aria-hidden />
            </button>
          </div>
          <button
            type="button"
            className="theme-toggle"
            onClick={() =>
              setTheme((prev) => (prev === "light" ? "dark" : "light"))
            }
            title={theme === "light" ? "切换深色模式" : "切换明亮模式"}
            aria-label={theme === "light" ? "切换深色模式" : "切换明亮模式"}
          >
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </nav>

      <main className="main-container">
        {loading ? (
          <div
            className={`games-grid${isPsList ? " is-ps" : ""}`}
            aria-busy="true"
            aria-label="游戏列表加载中"
          >
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="skeleton-card"
                style={{ animationDelay: `${(i % 6) * 0.08}s` }}
              >
                <div className="skeleton-cover skeleton-shimmer" />
                <div className="skeleton-body">
                  <div className="skeleton-title-block">
                    <div className="skeleton-line skeleton-shimmer" />
                    <div className="skeleton-line skeleton-shimmer short" />
                  </div>
                  <div className="skeleton-excerpt-block">
                    <div className="skeleton-line skeleton-shimmer thin" />
                    <div className="skeleton-line skeleton-shimmer thin medium" />
                  </div>
                  <div className="skeleton-meta">
                    <div className="skeleton-line skeleton-shimmer meta-date" />
                    <div className="skeleton-circle skeleton-shimmer" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : listError ? (
          <div className="empty-state">
            <h3>加载游戏列表遇到问题</h3>
            <p style={{ marginBottom: 16 }}>{listError}</p>
            <button
              type="button"
              className="search-submit-btn"
              onClick={() =>
                loadGames({
                  page,
                  categorySlug,
                  search: activeSearch,
                  order: sortOrder,
                })
              }
            >
              重新加载
            </button>
          </div>
        ) : games.length === 0 ? (
          <div className="empty-state">
            <h3>没有找到匹配的游戏资源</h3>
            <p style={{ marginBottom: 16 }}>
              请尝试更换更简短的中文或英文游戏关键词
            </p>
            <button
              type="button"
              className="search-submit-btn"
              onClick={() => handleSelectCategory(DEFAULT_CATEGORY_PATH)}
            >
              查看推荐
            </button>
          </div>
        ) : (
          <>
            <div className={`games-grid${isPsList ? " is-ps" : ""}`}>
              {games.map((game) => (
                <GameCard
                  key={`${game.source || DEFAULT_SOURCE}:${game.id}`}
                  game={game}
                  cachedPan={panCache[panCacheKey(game)]}
                  onOpenDetail={handleOpenDetail}
                  onPanResolved={handlePanResolved}
                  onNotify={addToast}
                  onSelectCategory={handleSelectCategory}
                />
              ))}
            </div>

            {totalPages > 1 && (
              <div className="pagination-bar">
                <button
                  type="button"
                  className="page-btn is-icon"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                  aria-label="上一页"
                  title="上一页"
                >
                  <ChevronLeft size={16} strokeWidth={2.2} aria-hidden />
                </button>
                {getVisiblePages().map((p, idx, arr) => {
                  const prev = arr[idx - 1];
                  const showEllipsis = prev !== undefined && p - prev > 1;
                  return (
                    <React.Fragment key={p}>
                      {showEllipsis && (
                        <span className="page-ellipsis" aria-hidden>
                          ···
                        </span>
                      )}
                      <button
                        type="button"
                        className={`page-btn is-icon ${p === page ? "active" : ""}`}
                        onClick={() => handlePageChange(p)}
                        aria-label={`第 ${p} 页`}
                        aria-current={p === page ? "page" : undefined}
                      >
                        {p}
                      </button>
                    </React.Fragment>
                  );
                })}
                <button
                  type="button"
                  className="page-btn is-icon"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                  aria-label="下一页"
                  title="下一页"
                >
                  <ChevronRight size={16} strokeWidth={2.2} aria-hidden />
                </button>
                <form className="page-jump-form" onSubmit={handleJumpSubmit}>
                  <input
                    type="number"
                    min={1}
                    max={totalPages}
                    className="page-jump-input"
                    value={jumpPageInput}
                    onChange={(e) => setJumpPageInput(e.target.value)}
                    aria-label="输入页码，回车跳转"
                    title="回车跳转"
                  />
                </form>
              </div>
            )}
          </>
        )}
      </main>

      {detailGame && (
        <GameDetailModal
          game={detailGame}
          cachedPan={panCache[panCacheKey(detailGame)]}
          onClose={handleCloseDetail}
          onPanResolved={handlePanResolved}
          onNotify={addToast}
          onSelectCategory={(slug) => {
            handleCloseDetail();
            handleSelectCategory(slug);
          }}
        />
      )}

      {toasts.length > 0 && (
        <div className="toast-container">
          {toasts.map((t) => (
            <div key={t.id} className={`toast-item ${t.kind}`}>
              <strong>{t.title}</strong>
              {t.sub && <span className="toast-sub">{t.sub}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
