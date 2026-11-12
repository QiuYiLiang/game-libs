import React, { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  X,
} from "lucide-react";
import type {
  GalleryResponse,
  GameItem,
  PanResolveResponse,
} from "../types";
import { filterNavCategories, sourceQuery } from "../types";
import { BlurUpImage } from "./BlurUpImage";
import { DownloadMenuButton } from "./DownloadMenuButton";

interface GameDetailModalProps {
  game: GameItem;
  cachedPan?: PanResolveResponse;
  onClose: () => void;
  onPanResolved: (postId: number, data: PanResolveResponse) => void;
  onNotify: (
    title: string,
    sub?: string,
    kind?: "success" | "warn" | "error"
  ) => void;
  onSelectCategory: (slug: string) => void;
}

export const GameDetailModal: React.FC<GameDetailModalProps> = ({
  game,
  cachedPan,
  onClose,
  onPanResolved,
  onNotify,
  onSelectCategory,
}) => {
  const [images, setImages] = useState<string[]>(
    game.cover ? [game.cover] : []
  );
  const [description, setDescription] = useState("");
  const [detailLoading, setDetailLoading] = useState(true);
  const [slideIndex, setSlideIndex] = useState(0);
  /** PS5 媒体切换：出图后缩虚化 + 进图侧向压入 */
  const [slideAnim, setSlideAnim] = useState<{
    from: number;
    to: number;
    dir: "next" | "prev";
  } | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const thumbsWrapRef = useRef<HTMLDivElement | null>(null);
  const autoTimerRef = useRef<number | null>(null);
  const slideAnimTimerRef = useRef<number | null>(null);
  const slideIndexRef = useRef(0);
  const slideAnimRef = useRef<typeof slideAnim>(null);
  const imagesRef = useRef(images);
  const [thumbCols, setThumbCols] = useState(4);

  const PS5_SLIDE_MS = 520;

  slideIndexRef.current = slideIndex;
  slideAnimRef.current = slideAnim;
  imagesRef.current = images;

  const stopAutoPlay = () => {
    if (autoTimerRef.current !== null) {
      window.clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  };

  const clearSlideAnimTimer = () => {
    if (slideAnimTimerRef.current !== null) {
      window.clearTimeout(slideAnimTimerRef.current);
      slideAnimTimerRef.current = null;
    }
  };

  const runPs5Slide = (toRaw: number) => {
    const list = imagesRef.current;
    const count = list.length;
    if (count <= 1) return;
    const to = ((toRaw % count) + count) % count;

    // 动画中再切：先落到当前目标，再开下一段
    let from = slideIndexRef.current;
    if (slideAnimRef.current) {
      from = slideAnimRef.current.to;
      setSlideIndex(from);
      slideIndexRef.current = from;
    }
    if (to === from) return;

    let dir: "next" | "prev" = to > from ? "next" : "prev";
    if (from === count - 1 && to === 0) dir = "next";
    if (from === 0 && to === count - 1) dir = "prev";

    clearSlideAnimTimer();
    setSlideAnim({ from, to, dir });
    slideAnimTimerRef.current = window.setTimeout(() => {
      setSlideIndex(to);
      slideIndexRef.current = to;
      setSlideAnim(null);
      slideAnimTimerRef.current = null;
    }, PS5_SLIDE_MS);
  };

  const startAutoPlay = (count: number) => {
    stopAutoPlay();
    if (count <= 1) return;
    autoTimerRef.current = window.setInterval(() => {
      const cur = slideAnimRef.current?.to ?? slideIndexRef.current;
      runPs5Slide(cur + 1);
    }, 3600);
  };

  const goPrev = () => {
    if (imagesRef.current.length <= 1) return;
    const cur = slideAnimRef.current?.to ?? slideIndexRef.current;
    runPs5Slide(cur - 1);
    startAutoPlay(imagesRef.current.length);
  };

  const goNext = () => {
    if (imagesRef.current.length <= 1) return;
    const cur = slideAnimRef.current?.to ?? slideIndexRef.current;
    runPs5Slide(cur + 1);
    startAutoPlay(imagesRef.current.length);
  };

  const goTo = (index: number) => {
    runPs5Slide(index);
    startAutoPlay(imagesRef.current.length);
  };

  /** 加载失败的图直接剔除，当作不存在 */
  const removeBrokenImage = (failedSrc: string) => {
    setImages((prev) => {
      const idx = prev.indexOf(failedSrc);
      if (idx < 0) return prev;
      const next = prev.filter((u) => u !== failedSrc);
      const nextIndex =
        next.length === 0
          ? 0
          : idx < slideIndex
            ? slideIndex - 1
            : Math.min(slideIndex, next.length - 1);
      queueMicrotask(() => {
        clearSlideAnimTimer();
        setSlideAnim(null);
        setSlideIndex(nextIndex);
        slideIndexRef.current = nextIndex;
        startAutoPlay(next.length);
      });
      return next;
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") goPrev();
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goNext();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      stopAutoPlay();
      clearSlideAnimTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, images.length]);

  useEffect(() => {
    let cancelled = false;
    clearSlideAnimTimer();
    setSlideAnim(null);
    setSlideIndex(0);
    slideIndexRef.current = 0;
    setDescription("");
    setDetailLoading(true);
    setImages(game.cover ? [game.cover] : []);
    (async () => {
      try {
        const res = await fetch(
          `/api/games/${game.id}/gallery${sourceQuery(game.source)}`
        );
        const json = (await res.json()) as GalleryResponse;
        if (cancelled) return;
        if (res.ok && json.ok) {
          if (json.images.length > 0) {
            setImages(json.images);
            startAutoPlay(json.images.length);
          } else if (game.cover) {
            setImages([game.cover]);
          }
          setDescription(
            json.description?.trim() || game.excerpt?.trim() || ""
          );
        } else if (game.cover) {
          setImages([game.cover]);
          setDescription(game.excerpt?.trim() || "");
        } else {
          setDescription(game.excerpt?.trim() || "");
        }
      } catch {
        if (cancelled) return;
        if (game.cover) setImages([game.cover]);
        setDescription(game.excerpt?.trim() || "");
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      stopAutoPlay();
    };
  }, [game.id, game.cover, game.excerpt, game.source]);

  const activeSlide = slideAnim?.to ?? slideIndex;

  useEffect(() => {
    const el = thumbRefs.current[activeSlide];
    if (el) {
      el.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth",
      });
    }
  }, [activeSlide]);

  /* 按缩略图区域剩余宽高自适应列数：能铺下就放大铺满，太多再滚动 */
  useEffect(() => {
    const wrap = thumbsWrapRef.current;
    const n = images.length;
    if (!wrap || n <= 1) return;

    const GAP = 6;
    const MIN_W = 72;
    const MAX_COLS = 7;

    const update = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w <= 0) return;

      const maxCols = Math.min(MAX_COLS, n);
      const minCols = Math.min(2, maxCols);
      const widthCap = Math.max(
        minCols,
        Math.min(maxCols, Math.floor((w + GAP) / (MIN_W + GAP)))
      );

      let chosen: number | null = null;
      // 列越少图越大；优先选仍能装进剩余高度的最少列数
      for (let cols = minCols; cols <= widthCap; cols++) {
        const tw = (w - GAP * (cols - 1)) / cols;
        if (tw < MIN_W - 0.5) continue;
        const th = (tw * 9) / 16;
        const rows = Math.ceil(n / cols);
        const totalH = rows * th + Math.max(0, rows - 1) * GAP;
        if (h <= 0 || totalH <= h + 1) {
          chosen = cols;
          break;
        }
      }

      if (chosen == null) {
        // 装不下：用尽量多的列，缩短纵向高度，交给滚动条
        chosen = widthCap;
      }

      setThumbCols(chosen);
    };

    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [images.length]);

  return (
    <div
      className="modal-backdrop detail-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={game.mainTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="detail-close-btn"
          onClick={onClose}
          title="关闭"
        >
          <X size={18} />
        </button>

        <div className="detail-layout">
          <div
            className={`detail-media ${images.length > 1 ? "has-thumbs" : ""}`}
          >
            <div className="detail-gallery ps5-media">
              {images.length === 0 ? (
                <div className="ps5-slide is-current">
                  <div className="card-cover-fallback">{game.mainTitle}</div>
                </div>
              ) : slideAnim ? (
                <>
                  <div
                    className={`ps5-slide is-out is-out-${slideAnim.dir}`}
                    key={`out-${slideAnim.from}-${slideAnim.to}`}
                  >
                    <BlurUpImage
                      src={images[slideAnim.from]}
                      alt=""
                      className="detail-gallery-img is-slide"
                      referrerPolicy="no-referrer"
                      onError={() =>
                        removeBrokenImage(images[slideAnim.from])
                      }
                    />
                  </div>
                  <div
                    className={`ps5-slide is-in is-in-${slideAnim.dir}`}
                    key={`in-${slideAnim.from}-${slideAnim.to}`}
                  >
                    <BlurUpImage
                      src={images[slideAnim.to]}
                      alt={`${game.mainTitle} ${slideAnim.to + 1}`}
                      className="detail-gallery-img is-slide"
                      referrerPolicy="no-referrer"
                      onError={() => removeBrokenImage(images[slideAnim.to])}
                    />
                  </div>
                </>
              ) : (
                <div className="ps5-slide is-current">
                  <BlurUpImage
                    key={images[slideIndex]}
                    src={images[slideIndex]}
                    alt={`${game.mainTitle} ${slideIndex + 1}`}
                    className="detail-gallery-img is-slide"
                    referrerPolicy="no-referrer"
                    onError={() => removeBrokenImage(images[slideIndex])}
                  />
                </div>
              )}

              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    className="detail-nav-btn prev"
                    onClick={goPrev}
                    aria-label="上一张"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <button
                    type="button"
                    className="detail-nav-btn next"
                    onClick={goNext}
                    aria-label="下一张"
                  >
                    <ChevronRight size={20} />
                  </button>
                </>
              )}
            </div>

            {images.length > 1 && (
              <div
                ref={thumbsWrapRef}
                className="detail-thumbs"
                style={
                  {
                    "--thumb-cols": String(thumbCols),
                  } as React.CSSProperties
                }
                aria-label="图片缩略图"
              >
                {images.map((src, idx) => (
                  <button
                    key={`${src}-${idx}`}
                    type="button"
                    ref={(el) => {
                      thumbRefs.current[idx] = el;
                    }}
                    className={`detail-thumb ${idx === activeSlide ? "active" : ""}`}
                    onClick={() => goTo(idx)}
                    aria-label={`切换到第 ${idx + 1} 张`}
                    aria-current={idx === activeSlide ? "true" : undefined}
                  >
                    <BlurUpImage
                      src={src}
                      alt=""
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={() => removeBrokenImage(src)}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="detail-body">
            <div className="detail-title-row">
              <h2 className="detail-title">{game.mainTitle}</h2>
            </div>

            {(() => {
              const cats = filterNavCategories(game.categories);
              if (cats.length === 0) return null;
              return (
                <div className="detail-cats">
                  {cats.map((cat) => (
                    <button
                      key={cat.slug}
                      type="button"
                      className="cat-badge"
                      onClick={() => {
                        onSelectCategory(cat.slug);
                        onClose();
                      }}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              );
            })()}

            {detailLoading ? (
              <div
                className="detail-excerpt-skeleton"
                aria-busy="true"
                aria-label="详情加载中"
              >
                <div className="skeleton-line skeleton-shimmer" />
                <div className="skeleton-line skeleton-shimmer medium" />
                <div className="skeleton-line skeleton-shimmer" />
                <div className="skeleton-line skeleton-shimmer short" />
                <div className="skeleton-line skeleton-shimmer thin" />
                <div className="skeleton-line skeleton-shimmer thin medium" />
                <div className="skeleton-line skeleton-shimmer thin" />
                <div className="skeleton-line skeleton-shimmer thin short" />
                <div className="skeleton-line skeleton-shimmer thin medium" />
                <div className="skeleton-line skeleton-shimmer thin" />
                <div className="skeleton-line skeleton-shimmer short" />
              </div>
            ) : description ? (
              <div className="detail-excerpt">
                {description.split(/\n+/).map((para, idx) => (
                  <p key={idx}>{para}</p>
                ))}
              </div>
            ) : null}

            <div className="card-meta-row detail-meta">
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                <Clock size={12} />
                {game.dateLabel || "近期更新"}
              </span>
              <DownloadMenuButton
                gameId={game.id}
                gameTitle={game.mainTitle}
                source={game.source}
                cachedPan={cachedPan}
                onPanResolved={onPanResolved}
                onNotify={onNotify}
                placement="top"
              />
            </div>

          </div>
        </div>
      </div>
    </div>
  );
};
