import type { ProductRankingMode } from "./types";
import { buildFilterHref } from "./workTypes";

export const RANKING_MODE_OPTIONS: Array<{ label: string; value: ProductRankingMode }> = [
  { label: "日間売上", value: "dailyRevenue" },
  { label: "日間", value: "daily" },
  { label: "週間", value: "weekly" },
  { label: "月間", value: "monthly" },
  { label: "累計", value: "cumulative" },
];

const validRankingModeValues = new Set(RANKING_MODE_OPTIONS.map((option) => option.value));

export function parseRankingMode(value: string | string[] | undefined): ProductRankingMode {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "dailyRevenue";
  return validRankingModeValues.has(raw as ProductRankingMode) ? (raw as ProductRankingMode) : "dailyRevenue";
}

export function buildRankingModeHref(
  basePath: string,
  current: Record<string, string | undefined>,
  rankingMode: ProductRankingMode,
  paramName = "rankingMode",
): string {
  return buildFilterHref(basePath, current, { [paramName]: rankingMode === "dailyRevenue" ? undefined : rankingMode });
}
