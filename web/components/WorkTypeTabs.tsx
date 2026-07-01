import Link from "next/link";
import type { ProductRankingMode, ProductWorkType } from "@/lib/types";
import { WORK_TYPE_OPTIONS, buildWorkTypeHref, buildFilterHref } from "@/lib/workTypes";
import { RANKING_MODE_OPTIONS } from "@/lib/rankingModes";

type WorkTypeTabsProps = {
  basePath: string;
  currentWorkType?: ProductWorkType;
  currentParams?: Record<string, string | undefined>;
  paramName?: string;
  className?: string;
};

export function WorkTypeTabs({
  basePath,
  currentWorkType,
  currentParams = {},
  paramName = "workType",
  className,
}: WorkTypeTabsProps) {
  return (
    <nav className={`filterTabs${className ? ` ${className}` : ""}`} aria-label="作品形式">
      {WORK_TYPE_OPTIONS.map((option) => {
        const isActive = option.value === "all" ? !currentWorkType : currentWorkType === option.value;
        const href = buildWorkTypeHref(basePath, currentParams, option.value, paramName);

        return (
          <Link className={isActive ? "isActive" : undefined} href={href} key={option.value} scroll={false}>
            {option.label}
          </Link>
        );
      })}
    </nav>
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
          <Link className={currentRankingMode === option.value ? "isActive" : undefined} href={href} key={option.value} scroll={false}>
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
          <Link className={isActive ? "isActive" : undefined} href={href} key={option.label} scroll={false}>
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}
