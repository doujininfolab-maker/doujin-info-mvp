"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function ScrollRail({
  children,
  className = "",
  ariaLabel,
}: {
  children: React.ReactNode;
  className?: string;
  ariaLabel: string;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
    const nextLeft = el.scrollLeft > 2;
    const nextRight = el.scrollLeft < maxScrollLeft - 2;
    setCanScrollLeft(nextLeft);
    setCanScrollRight(nextRight);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;

    updateScrollState();
    const frame = requestAnimationFrame(updateScrollState);

    el.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [updateScrollState, children]);

  const scrollBy = (direction: -1 | 1) => {
    const el = railRef.current;
    if (!el) return;
    const amount = Math.max(220, Math.floor(el.clientWidth * 0.76));
    el.scrollBy({ left: amount * direction, behavior: "smooth" });
    window.setTimeout(updateScrollState, 260);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const el = railRef.current;
    if (!el) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const canScroll = el.scrollWidth > el.clientWidth;
    if (!canScroll) return;
    event.preventDefault();
    el.scrollLeft += event.deltaY;
    updateScrollState();
  };

  const wrapperClass = [
    "scrollRailWrap",
    canScrollLeft ? "canScrollLeft" : "",
    canScrollRight ? "canScrollRight" : "",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={wrapperClass}>
      {canScrollLeft ? (
        <button className="railButton railButton--left" type="button" onClick={() => scrollBy(-1)} aria-label="左へスクロール">
          ‹
        </button>
      ) : null}
      <div ref={railRef} className="scrollRail" onWheel={handleWheel} aria-label={ariaLabel} tabIndex={0}>
        {children}
      </div>
      {canScrollRight ? (
        <button className="railButton railButton--right" type="button" onClick={() => scrollBy(1)} aria-label="右へスクロール">
          ›
        </button>
      ) : null}
    </div>
  );
}
