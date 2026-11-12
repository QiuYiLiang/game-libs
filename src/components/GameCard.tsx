import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type {
  GalleryResponse,
  GameItem,
  PanResolveResponse,
} from "../types";
import { PS_SOURCE, filterNavCategories, sourceQuery } from "../types";
import { BlurUpImage } from "./BlurUpImage";
import { DownloadMenuButton } from "./DownloadMenuButton";

interface GameCardProps {
  game: GameItem;
  cachedPan?: PanResolveResponse;
  onOpenDetail: (game: GameItem) => void;
  onPanResolved: (postId: number, data: PanResolveResponse) => void;
  onNotify: (
    title: string,
    sub?: string,
    kind?: "success" | "warn" | "error"
  ) => void;
  onSelectCategory: (slug: string) => void;
}

const CAROUSEL_INTERVAL_MS = 1400;
const MAX_COVER_SLIDES = 8;

function limitCoverImages(images: string[], cover?: string): string[] {
  const list =
    images.length > 0 ? images : cover ? [cover] : [];
  return list.slice(0, MAX_COVER_SLIDES);
}

export const GameCard: React.FC<GameCardProps> = ({
  game,
  cachedPan,
  onOpenDetail,
  onPanResolved,
  onNotify,
  onSelectCategory,
}) => {
  const [imgError, setImgError] = useState(false);

  const [galleryImages, setGalleryImages] = useState<string[] | null>(null);
  const [slideIndex, setSlideIndex] = useState(0);
  const [slideInstant, setSlideInstant] = useState(false);
  const [coverFailIndex, setCoverFailIndex] = useState(0);
  const [hoveringCover, setHoveringCover] = useState(false);

  const hoverRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const galleryFetchRef = useRef<Promise<string[]> | null>(null);
  const imagesRef = useRef<string[]>([]);
  const coverFailIndexRef = useRef(0);
  const slideIndexRef = useRef(0);

  slideIndexRef.current = slideIndex;

  const stopCarousel = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const jumpSlide = (next: number, wrapJump: boolean) => {
    if (wrapJump) {
      setSlideInstant(true);
      setSlideIndex(next);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setSlideInstant(false));
      });
    } else {
      setSlideInstant(false);
      setSlideIndex(next);
    }
  };

  const startCarousel = (images: string[]) => {
    stopCarousel();
    imagesRef.current = images;
    if (images.length <= 1 || !hoverRef.current) return;
    timerRef.current = window.setInterval(() => {
      const i = slideIndexRef.current;
      if (i >= images.length - 1) jumpSlide(0, true);
      else jumpSlide(i + 1, false);
    }, CAROUSEL_INTERVAL_MS);
  };

  const goToSlide = (index: number, opts?: { wrapJump?: boolean }) => {
    const images = imagesRef.current;
    if (images.length <= 1) return;
    const next = ((index % images.length) + images.length) % images.length;
    jumpSlide(next, Boolean(opts?.wrapJump));
    startCarousel(images);
  };

  const handleDotClick = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    goToSlide(index);
  };

  const handleNavClick = (e: React.MouseEvent, delta: number) => {
    e.preventDefault();
    e.stopPropagation();
    const images = imagesRef.current;
    if (images.length <= 1) return;
    const cur = slideIndexRef.current;
    const next = (cur + delta + images.length) % images.length;
    const wrapJump =
      (delta > 0 && cur === images.length - 1) ||
      (delta < 0 && cur === 0);
    goToSlide(next, { wrapJump });
  };

  const loadGallery = async (): Promise<string[]> => {
    if (galleryImages) return galleryImages;
    if (galleryFetchRef.current) return galleryFetchRef.current;

    const task = (async () => {
      try {
        const res = await fetch(
          `/api/games/${game.id}/gallery${sourceQuery(game.source)}`
        );
        const json = (await res.json()) as GalleryResponse;
        if (!res.ok || !json.ok) {
          throw new Error(json.error || `请求失败 (${res.status})`);
        }
        const images = limitCoverImages(json.images, game.cover);
        setGalleryImages(images);
        imagesRef.current = images;
        return images;
      } catch {
        const fallback = limitCoverImages([], game.cover);
        setGalleryImages(fallback);
        imagesRef.current = fallback;
        return fallback;
      } finally {
        galleryFetchRef.current = null;
      }
    })();

    galleryFetchRef.current = task;
    return task;
  };

  const handleCoverEnter = async () => {
    hoverRef.current = true;
    setHoveringCover(true);
    const images = await loadGallery();
    if (!hoverRef.current) return;
    const start = Math.min(coverFailIndexRef.current, Math.max(images.length - 1, 0));
    setSlideIndex(start);
    startCarousel(images);
  };

  const handleCoverLeave = () => {
    hoverRef.current = false;
    setHoveringCover(false);
    stopCarousel();
    setSlideIndex(coverFailIndexRef.current);
  };

  useEffect(() => {
    return () => stopCarousel();
  }, []);

  useEffect(() => {
    setImgError(false);
    setCoverFailIndex(0);
    coverFailIndexRef.current = 0;
    setGalleryImages(null);
    setSlideIndex(0);
    galleryFetchRef.current = null;
  }, [game.id, game.cover]);

  const handleCoverImgError = async (failedSrc: string) => {
    const stripFailed = (list: string[]) =>
      list.filter((u) => u && u !== failedSrc);

    let pool =
      galleryImages && galleryImages.length > 0
        ? stripFailed(galleryImages)
        : game.cover && game.cover !== failedSrc
          ? [game.cover]
          : [];

    if (pool.length === 0) {
      const loaded = stripFailed(await loadGallery());
      pool = loaded;
    }

    setGalleryImages(pool.length > 0 ? pool : []);
    imagesRef.current = pool;

    if (pool.length === 0) {
      setImgError(true);
      return;
    }

    const nextIdx = Math.min(coverFailIndexRef.current, pool.length - 1);
    coverFailIndexRef.current = nextIdx;
    setCoverFailIndex(nextIdx);
    setSlideIndex(nextIdx);
    if (hoverRef.current) startCarousel(pool);
  };

  const listPool =
    galleryImages && galleryImages.length > 0
      ? galleryImages
      : game.cover
        ? [game.cover]
        : [];
  const activeImages =
    hoveringCover && galleryImages && galleryImages.length > 0
      ? galleryImages
      : listPool;
  const displayIndex = hoveringCover
    ? slideIndex
    : Math.min(coverFailIndex, Math.max(activeImages.length - 1, 0));
  const currentSrc =
    activeImages[Math.min(displayIndex, Math.max(activeImages.length - 1, 0))] ||
    "";
  const showDots =
    hoveringCover && galleryImages !== null && galleryImages.length > 1;

  return (
    <article
      className={`game-card is-clickable${game.source === PS_SOURCE ? " is-ps" : ""}`}
      data-post-id={game.id}
      onClick={() => onOpenDetail(game)}
      role="button"
      tabIndex={0}
      onMouseEnter={() => {
        void handleCoverEnter();
      }}
      onMouseLeave={handleCoverLeave}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenDetail(game);
        }
      }}
    >
      <div className="card-cover-wrap">
        {activeImages.length > 0 && !imgError ? (
          showDots ? (
            <div
              className={`card-cover-track${slideInstant ? " is-instant" : ""}`}
              style={{
                width: `${activeImages.length * 100}%`,
                transform: `translate3d(-${
                  (displayIndex / activeImages.length) * 100
                }%, 0, 0)`,
              }}
            >
              {activeImages.map((src, idx) => (
                <div
                  key={`${src}-${idx}`}
                  className="card-cover-slide"
                  style={{ width: `${100 / activeImages.length}%` }}
                >
                  <BlurUpImage
                    src={src}
                    alt={game.mainTitle}
                    className="card-cover-img is-carousel is-slide"
                    loading={idx <= displayIndex + 1 ? "eager" : "lazy"}
                    referrerPolicy="no-referrer"
                    onError={() => {
                      void handleCoverImgError(src);
                    }}
                  />
                </div>
              ))}
            </div>
          ) : currentSrc ? (
            <BlurUpImage
              key={currentSrc}
              src={currentSrc}
              alt={game.mainTitle}
              className="card-cover-img"
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => {
                if (currentSrc) void handleCoverImgError(currentSrc);
              }}
            />
          ) : (
            <div className="card-cover-fallback">{game.mainTitle}</div>
          )
        ) : (
          <div className="card-cover-fallback">{game.mainTitle}</div>
        )}

        {showDots && (
          <>
            <button
              type="button"
              className="cover-nav-btn prev"
              onClick={(e) => handleNavClick(e, -1)}
              aria-label="上一张"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              type="button"
              className="cover-nav-btn next"
              onClick={(e) => handleNavClick(e, 1)}
              aria-label="下一张"
            >
              <ChevronRight size={18} />
            </button>
            <div
              className="cover-carousel-dots"
              onClick={(e) => e.stopPropagation()}
            >
              {galleryImages!.map((_, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`cover-dot ${idx === slideIndex ? "active" : ""}`}
                  onClick={(e) => handleDotClick(e, idx)}
                  aria-label={`预览第 ${idx + 1} 张`}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <div className="card-body">
        <div className="card-title-row">
          <h2 className="card-title" title={game.rawTitle}>
            {game.mainTitle}
          </h2>
        </div>

        {game.excerpt && <p className="card-excerpt">{game.excerpt}</p>}

        <div className="card-meta-row">
          <div className="card-meta-left">
            <span className="card-date">
              <Clock size={12} />
              {game.dateLabel || "近期更新"}
            </span>
            {filterNavCategories(game.categories)
              .slice(0, 2)
              .map((cat) => (
                <button
                  key={cat.slug}
                  type="button"
                  className="card-meta-tag"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectCategory(cat.slug);
                  }}
                  title={`筛选分类: ${cat.name}`}
                >
                  {cat.name}
                </button>
              ))}
          </div>
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
    </article>
  );
};
