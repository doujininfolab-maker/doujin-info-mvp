"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ProductImage } from "@/lib/types";

function imageSrc(image?: ProductImage): string {
  return image?.url || image?.thumbnailUrl || "/no-image.svg";
}

export function ProductImageGallery({ title, images }: { title: string; images: ProductImage[] }) {
  const sortedImages = useMemo(
    () => [...images].sort((a, b) => a.displayOrder - b.displayOrder),
    [images],
  );
  const [activeIndex, setActiveIndex] = useState(0);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const safeActiveIndex = Math.min(activeIndex, Math.max(sortedImages.length - 1, 0));
  const mainImage = sortedImages[safeActiveIndex];
  const mainSrc = imageSrc(mainImage);
  const canMove = sortedImages.length > 1;

  useEffect(() => {
    const activeThumb = thumbRefs.current[safeActiveIndex];
    activeThumb?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center",
    });
  }, [safeActiveIndex]);

  const move = (delta: number) => {
    if (!canMove) return;
    setActiveIndex((current) => {
      const next = current + delta;
      if (next < 0) return sortedImages.length - 1;
      if (next >= sortedImages.length) return 0;
      return next;
    });
  };

  return (
    <div className="gallery">
      <div className="gallery__mainFrame">
        {canMove ? (
          <button
            type="button"
            className="gallery__nav gallery__nav--prev"
            onClick={() => move(-1)}
            aria-label="前の画像"
          >
            ‹
          </button>
        ) : null}
        <img className="gallery__main" src={mainSrc} alt={title} />
        {canMove ? (
          <button
            type="button"
            className="gallery__nav gallery__nav--next"
            onClick={() => move(1)}
            aria-label="次の画像"
          >
            ›
          </button>
        ) : null}
      </div>

      {sortedImages.length > 1 ? (
        <div className="gallery__thumbStrip">
          <button
            type="button"
            className="gallery__thumbNav"
            onClick={() => move(-1)}
            aria-label="前の画像"
          >
            ‹
          </button>
          <div className="gallery__thumbs" aria-label="作品画像一覧">
            {sortedImages.map((image, index) => {
              const src = imageSrc(image);
              const isActive = index === safeActiveIndex;
              return (
                <button
                  key={`${image.displayOrder}_${src}`}
                  type="button"
                  className={`gallery__thumbButton${isActive ? " isActive" : ""}`}
                  ref={(element) => {
                    thumbRefs.current[index] = element;
                  }}
                  onClick={() => setActiveIndex(index)}
                  aria-label={`${index + 1}枚目の画像を表示`}
                  aria-current={isActive ? "true" : undefined}
                >
                  <img className="gallery__thumb" src={src} alt={`${title} サンプル${index + 1}`} loading="lazy" />
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="gallery__thumbNav"
            onClick={() => move(1)}
            aria-label="次の画像"
          >
            ›
          </button>
        </div>
      ) : null}
    </div>
  );
}
