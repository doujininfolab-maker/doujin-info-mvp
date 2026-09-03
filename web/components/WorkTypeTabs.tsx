"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProductRankingMode, ProductWorkType } from "@/lib/types";
import { WORK_TYPE_OPTIONS, buildWorkTypeHref, buildFilterHref } from "@/lib/workTypes";
import { RANKING_MODE_OPTIONS } from "@/lib/rankingModes";

type WorkTypeTabsProps = {
  basePath: string;
  currentWorkType?: ProductWorkType;
  currentParams?: Record<string, string | undefined>;
  paramName?: string;
  className?: string;
  scrollControls?: boolean;
};

export function WorkTypeTabs({
  basePath,
  currentWorkType,
  currentParams = {},
  paramName = "workType",
  className,
  scrollControls = true,
}: WorkTypeTabsProps) {
  const tabsRef = useRef<HTMLElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(scrollControls);

  const updateScrollState = useCallback(() => {
    const element = tabsRef.current;
    if (!element || !scrollControls) return;

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollLeft(element.scrollLeft > 2);
    setCanScrollRight(element.scrollLeft < maxScrollLeft - 2);
  }, [scrollControls]);

  useEffect(() => {
    const element = tabsRef.current;
    if (!element || !scrollControls) return;

    updateScrollState();
    const frame = requestAnimationFrame(updateScrollState);
    element.addEventListener("scroll", updateScrollState, { passive: true });
    const resizeObserver = new ResizeObserver(updateScrollState);
    resizeObserver.observe(element);

    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", updateScrollState);
      resizeObserver.disconnect();
    };
  }, [scrollControls, updateScrollState]);

  const scrollBy = (direction: -1 | 1) => {
    const element = tabsRef.current;
    if (!element) return;
    element.scrollBy({ left: Math.round(element.clientWidth * 0.72) * direction, behavior: "smooth" });
    window.setTimeout(updateScrollState, 260);
  };

  const tabs = (
    <nav ref={tabsRef} className={`filterTabs${className ? ` ${className}` : ""}`} aria-label="作品形式">
      {WORK_TYPE_OPTIONS.map((option) => {
        const isActive = option.value === "all" ? !currentWorkType : currentWorkType === option.value;
        const href = buildWorkTypeHref(basePath, currentParams, option.value, paramName);

        return (
          <Link className={isActive ? "isActive" : undefined} href={href} key={option.value} prefetch={false} scroll={false}>
            {option.label}
          </Link>
        );
      })}
    </nav>
  );

  if (!scrollControls) return tabs;

  return (
    <div className={`filterTabsScroll${canScrollLeft ? " canScrollLeft" : ""}${canScrollRight ? " canScrollRight" : ""}`}>
      {canScrollLeft ? (
        <button type="button" className="filterTabsScroll__button filterTabsScroll__button--left" aria-label="前の作品形式を表示" onClick={() => scrollBy(-1)}>
          ‹
        </button>
      ) : null}
      {tabs}
      {canScrollRight ? (
        <button type="button" className="filterTabsScroll__button filterTabsScroll__button--right" aria-label="次の作品形式を表示" onClick={() => scrollBy(1)}>
          ›
        </button>
      ) : null}
    </div>
  );
}

type RankingModeTabsProps = {
  basePath: string;
  currentRankingMode: ProductRankingMode;
  currentParams?: Record<string, string | undefined>;
  paramName?: string;
  className?: string;
};

export function RankingModeTabs({
  basePath,
  currentRankingMode,
  currentParams = {},
  paramName = "rankingMode",
  className,
}: RankingModeTabsProps) {
  return (
    <nav className={`rankingModeTabs${className ? ` ${className}` : ""}`} aria-label="ランキング種別">
      {RANKING_MODE_OPTIONS.map((option) => {
        const href = buildFilterHref(basePath, currentParams, {
          [paramName]: option.value === "dailyRevenue" ? undefined : option.value,
        });

        return (
          <Link className={currentRankingMode === option.value ? "isActive" : undefined} href={href} key={option.value} prefetch={false} scroll={false}>
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

export const DISCOUNT_FILTER_OPTIONS = [
  { label: "全て", value: undefined },
  { label: "30%OFF以上", value: 30 },
  { label: "50%OFF以上", value: 50 },
  { label: "70%OFF以上", value: 70 },
  { label: "90%OFF以上", value: 90 },
] as const;

type DiscountTabsProps = {
  basePath: string;
  currentDiscountRateMin?: number;
  currentParams?: Record<string, string | undefined>;
};

export function DiscountTabs({ basePath, currentDiscountRateMin, currentParams = {} }: DiscountTabsProps) {
  return (
    <nav className="filterTabs filterTabs--discount" aria-label="割引率">
      {DISCOUNT_FILTER_OPTIONS.map((option) => {
        const isActive = option.value === undefined ? currentDiscountRateMin === undefined : currentDiscountRateMin === option.value;
        const href = buildFilterHref(basePath, currentParams, { discount: option.value });

        return (
          <Link className={isActive ? "isActive" : undefined} href={href} key={option.label} prefetch={false} scroll={false}>
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
