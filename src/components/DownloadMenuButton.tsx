import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, Download, Loader2 } from "lucide-react";
import type {
  GameSource,
  PanFormatGroup,
  PanResolveResponse,
} from "../types";
import { PS_SOURCE, panHasLinks, sourceQuery } from "../types";

export type DownloadOption = {
  id: string;
  label: string;
  url: string;
};

type MenuPos = { top: number; left: number };
type SubSide = "left" | "right";

function shortProviderName(provider: string): string {
  if (provider === "夸克网盘") return "夸克";
  if (provider === "迅雷云盘") return "迅雷";
  return provider;
}

function optionsFromLinks(
  baiduLinks: PanResolveResponse["baiduLinks"],
  otherLinks: PanResolveResponse["otherLinks"],
  fallback?: { url: string | null; hasBaidu: boolean }
): DownloadOption[] {
  const options: DownloadOption[] = [];

  baiduLinks.forEach((b, i) => {
    options.push({
      id: `baidu-${i}`,
      label: baiduLinks.length > 1 ? `百度 #${i + 1}` : "百度网盘",
      url: b.url,
    });
  });

  if (options.length === 0 && fallback?.hasBaidu && fallback.url) {
    options.push({
      id: "baidu-primary",
      label: "百度网盘",
      url: fallback.url,
    });
  }

  const providerCount = new Map<string, number>();
  for (const o of otherLinks) {
    providerCount.set(o.provider, (providerCount.get(o.provider) || 0) + 1);
  }
  const providerSeen = new Map<string, number>();
  otherLinks.forEach((o, i) => {
    const n = (providerSeen.get(o.provider) || 0) + 1;
    providerSeen.set(o.provider, n);
    const total = providerCount.get(o.provider) || 1;
    const short = shortProviderName(o.provider);
    options.push({
      id: `other-${i}-${o.provider}`,
      label: total > 1 ? `${short} #${n}` : short,
      url: o.url,
    });
  });

  return options;
}

export function buildDownloadOptions(
  pan: PanResolveResponse
): DownloadOption[] {
  return optionsFromLinks(pan.baiduLinks, pan.otherLinks, {
    url: pan.baiduUrl,
    hasBaidu: pan.hasBaidu,
  });
}

function optionsFromFormat(group: PanFormatGroup): DownloadOption[] {
  return optionsFromLinks(group.baiduLinks, group.otherLinks);
}

function clampMenuPos(
  prefer: "top" | "bottom",
  btn: DOMRect,
  menuW: number,
  menuH: number
): MenuPos {
  const pad = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top =
    prefer === "top" ? btn.top - menuH - pad : btn.bottom + pad;
  if (top < pad) top = btn.bottom + pad;
  if (top + menuH > vh - pad) {
    const above = btn.top - menuH - pad;
    top = above >= pad ? above : Math.max(pad, vh - pad - menuH);
  }

  let left = btn.right - menuW;
  if (left < pad) left = pad;
  if (left + menuW > vw - pad) left = Math.max(pad, vw - pad - menuW);

  return { top, left };
}

function pickSubSide(item: DOMRect, subW: number): SubSide {
  const pad = 8;
  const spaceRight = window.innerWidth - item.right - pad;
  const spaceLeft = item.left - pad;
  if (spaceRight >= subW) return "right";
  if (spaceLeft >= subW) return "left";
  return spaceRight >= spaceLeft ? "right" : "left";
}

interface DownloadMenuButtonProps {
  gameId: number;
  gameTitle: string;
  source?: GameSource;
  cachedPan?: PanResolveResponse;
  onPanResolved: (postId: number, data: PanResolveResponse) => void;
  onNotify: (
    title: string,
    sub?: string,
    kind?: "success" | "warn" | "error"
  ) => void;
  placement?: "top" | "bottom";
}

export const DownloadMenuButton: React.FC<DownloadMenuButtonProps> = ({
  gameId,
  gameTitle,
  source,
  cachedPan,
  onPanResolved,
  onNotify,
  placement = "top",
}) => {
  const [open, setOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [justOpened, setJustOpened] = useState(false);
  const [hoverFormatId, setHoverFormatId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null);
  const [subSide, setSubSide] = useState<SubSide>("left");

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const openedTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  const isPs = source === PS_SOURCE;
  const formatGroups = cachedPan?.formatGroups;
  const useFormatMenu = Boolean(isPs && formatGroups && formatGroups.length > 0);

  const flatOptions = useMemo(
    () => (cachedPan ? buildDownloadOptions(cachedPan) : []),
    [cachedPan]
  );

  const hoverFormat = useMemo(
    () => formatGroups?.find((g) => g.id === hoverFormatId) || null,
    [formatGroups, hoverFormatId]
  );

  const subOptions = useMemo(
    () => (hoverFormat ? optionsFromFormat(hoverFormat) : []),
    [hoverFormat]
  );

  useEffect(() => {
    return () => {
      if (openedTimerRef.current !== null) {
        window.clearTimeout(openedTimerRef.current);
      }
      if (leaveTimerRef.current !== null) {
        window.clearTimeout(leaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (wrapRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
      setHoverFormatId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setHoverFormatId(null);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const reposition = () => {
    const btn = btnRef.current?.getBoundingClientRect();
    const menu = menuRef.current;
    if (!btn || !menu) return;
    const rect = menu.getBoundingClientRect();
    setMenuPos(clampMenuPos(placement, btn, rect.width, rect.height));
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    reposition();
    const onWin = () => reposition();
    window.addEventListener("resize", onWin);
    window.addEventListener("scroll", onWin, true);
    return () => {
      window.removeEventListener("resize", onWin);
      window.removeEventListener("scroll", onWin, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, placement, useFormatMenu, flatOptions.length, formatGroups?.length, resolving]);

  useLayoutEffect(() => {
    if (!hoverFormatId) return;
    const row = rowRefs.current[hoverFormatId];
    if (!row) return;
    const item = row.getBoundingClientRect();
    setSubSide(pickSubSide(item, 160));
  }, [hoverFormatId, subOptions.length]);

  const flashOpened = () => {
    setJustOpened(true);
    if (openedTimerRef.current !== null) {
      window.clearTimeout(openedTimerRef.current);
    }
    openedTimerRef.current = window.setTimeout(() => {
      setJustOpened(false);
      openedTimerRef.current = null;
    }, 1800);
  };

  const resolvePan = async (): Promise<PanResolveResponse | null> => {
    // 空缓存不复用，避免一次失败锁死
    if (panHasLinks(cachedPan)) return cachedPan!;
    setResolving(true);
    try {
      const res = await fetch(
        `/api/games/${gameId}/pan${sourceQuery(source)}`
      );
      const json = (await res.json()) as PanResolveResponse;
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `请求失败 (${res.status})`);
      }
      if (!panHasLinks(json)) {
        throw new Error("未解析到网盘链接，请稍后重试");
      }
      onPanResolved(gameId, json);
      return json;
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "解析网盘链接失败";
      onNotify("获取下载链接失败", msg, "error");
      return null;
    } finally {
      setResolving(false);
    }
  };

  const openUrl = (_label: string, url: string) => {
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (win) {
      flashOpened();
      onNotify("已打开页面", undefined, "success");
      setOpen(false);
      setHoverFormatId(null);
    } else {
      onNotify("打开失败", "请允许浏览器弹窗后重试", "warn");
    }
  };

  const handleToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      setHoverFormatId(null);
      return;
    }
    setHoverFormatId(null);
    setOpen(true);
    const pan = await resolvePan();
    if (!pan) {
      setOpen(false);
      return;
    }
    const groups = pan.formatGroups;
    const flat = buildDownloadOptions(pan);
    const hasGroups = Boolean(isPs && groups && groups.length > 0);
    if (!hasGroups && flat.length === 0) {
      setOpen(false);
      onNotify("未找到下载链接", gameTitle, "warn");
    }
  };

  const clearLeaveTimer = () => {
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const scheduleClearHover = () => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      setHoverFormatId(null);
      leaveTimerRef.current = null;
    }, 120);
  };

  const renderOption = (opt: DownloadOption) => (
    <button
      key={opt.id}
      type="button"
      role="menuitem"
      className="download-menu-item"
      onClick={() => openUrl(opt.label, opt.url)}
    >
      <span className="download-menu-label">{opt.label}</span>
    </button>
  );

  const menu =
    open ? (
      <div
        ref={menuRef}
        className="download-menu is-fixed"
        role="menu"
        aria-label="下载"
        style={
          menuPos
            ? { top: menuPos.top, left: menuPos.left }
            : { visibility: "hidden", top: 0, left: 0 }
        }
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {resolving && !cachedPan ? (
          <div className="download-menu-status">
            <Loader2 size={14} className="spin-icon" />
          </div>
        ) : null}

        {useFormatMenu &&
          formatGroups!.map((g) => (
            <div
              key={g.id}
              className={`download-menu-row${hoverFormatId === g.id ? " is-hot" : ""}`}
              ref={(el) => {
                rowRefs.current[g.id] = el;
              }}
              onMouseEnter={() => {
                clearLeaveTimer();
                setHoverFormatId(g.id);
              }}
              onMouseLeave={scheduleClearHover}
            >
              <button
                type="button"
                role="menuitem"
                className="download-menu-item has-sub"
                onClick={() =>
                  setHoverFormatId((prev) => (prev === g.id ? null : g.id))
                }
                title={g.remark || g.label}
              >
                <span className="download-menu-label">{g.label}</span>
                <ChevronRight size={14} aria-hidden />
              </button>
              {hoverFormatId === g.id && subOptions.length > 0 ? (
                <div
                  className={`download-submenu side-${subSide}`}
                  role="menu"
                  onMouseEnter={clearLeaveTimer}
                  onMouseLeave={scheduleClearHover}
                >
                  {subOptions.map(renderOption)}
                </div>
              ) : null}
            </div>
          ))}

        {!useFormatMenu &&
          !resolving &&
          cachedPan &&
          flatOptions.map(renderOption)}
      </div>
    ) : null;

  return (
    <div
      ref={wrapRef}
      className={`download-wrap${open ? " is-open" : ""}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {menu ? createPortal(menu, document.body) : null}
      <button
        ref={btnRef}
        type="button"
        className={`download-btn ${justOpened ? "copied" : ""}`}
        disabled={resolving && open}
        onClick={(e) => void handleToggle(e)}
        title={justOpened ? "已打开" : "下载"}
        aria-label="下载"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {resolving && open && !justOpened ? (
          <Loader2 size={15} className="spin-icon" />
        ) : justOpened ? (
          <Check size={15} />
        ) : (
          <Download size={15} />
        )}
      </button>
    </div>
  );
};
