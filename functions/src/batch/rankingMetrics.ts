import type { Timestamp } from "firebase-admin/firestore";
import type {
  Product,
  ProductDailyMetric,
  ProductRankingMetrics,
  ProductSalesSnapshot,
} from "../types";

const RECENT_SALES_SNAPSHOT_LIMIT = 35;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseYyyyMMddToUtcMs(value: string): number | undefined {
  if (!/^\d{8}$/.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return utcMs;
}

function formatYyyyMMddFromUtcMs(utcMs: number): string {
  const date = new Date(utcMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

export function addDaysToDateKey(value: string, offsetDays: number): string {
  const utcMs = parseYyyyMMddToUtcMs(value);
  if (utcMs === undefined) return value;
  return formatYyyyMMddFromUtcMs(utcMs + offsetDays * 24 * 60 * 60 * 1000);
}

export function dateLikeToDateKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact?.[1] && compact[2] && compact[3]) {
    return `${compact[1]}${compact[2]}${compact[3]}`;
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!iso?.[1] || !iso[2] || !iso[3]) return undefined;
  return `${iso[1]}${iso[2]}${iso[3]}`;
}

function normalizeSnapshot(value: ProductSalesSnapshot): ProductSalesSnapshot | undefined {
  const date = dateLikeToDateKey(value.date);
  if (!date || !isFiniteNumber(value.salesCount) || value.salesCount < 0) return undefined;
  return {
    date,
    salesCount: Math.floor(value.salesCount),
    priceCurrent: isFiniteNumber(value.priceCurrent) ? value.priceCurrent : undefined,
  };
}

export function mergeRecentSalesSnapshots(
  existing: ProductSalesSnapshot[] | undefined,
  additional: ProductSalesSnapshot[],
): ProductSalesSnapshot[] {
  const snapshotsByDate = new Map<string, ProductSalesSnapshot>();
  for (const snapshot of [...(existing ?? []), ...additional]) {
    const normalized = normalizeSnapshot(snapshot);
    if (!normalized) continue;
    snapshotsByDate.set(normalized.date, normalized);
  }

  return [...snapshotsByDate.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-RECENT_SALES_SNAPSHOT_LIMIT);
}

function findSnapshot(
  snapshots: ProductSalesSnapshot[],
  date: string,
): ProductSalesSnapshot | undefined {
  return snapshots.find((snapshot) => snapshot.date === date);
}

function resolvePeriodSalesCount(params: {
  snapshots: ProductSalesSnapshot[];
  sourceDate: string;
  sourceSalesCount: number;
  releaseDate?: string;
  days: number;
}): number | undefined {
  const baseDate = addDaysToDateKey(params.sourceDate, -params.days);
  const baseSnapshot = findSnapshot(params.snapshots, baseDate);
  let baseSalesCount: number | undefined;

  if (baseSnapshot) {
    baseSalesCount = baseSnapshot.salesCount;
  } else {
    const releaseDate = dateLikeToDateKey(params.releaseDate);
    if (releaseDate && releaseDate > baseDate && releaseDate <= params.sourceDate) {
      baseSalesCount = 0;
    }
  }

  if (!isFiniteNumber(baseSalesCount)) return undefined;
  const difference = params.sourceSalesCount - baseSalesCount;
  return difference >= 0 ? difference : undefined;
}

export function resolveDailySalesCountFromMetric(
  sourceMetric: ProductDailyMetric | undefined,
  previousMetric: ProductDailyMetric | undefined,
): number | undefined {
  if (
    sourceMetric?.dailySalesStatus === "calculated" &&
    isFiniteNumber(sourceMetric.dailySalesCount) &&
    sourceMetric.dailySalesCount >= 0
  ) {
    return sourceMetric.dailySalesCount;
  }

  if (
    isFiniteNumber(sourceMetric?.salesCount) &&
    isFiniteNumber(previousMetric?.salesCount)
  ) {
    const difference = sourceMetric.salesCount - previousMetric.salesCount;
    if (difference >= 0) return difference;
  }

  return undefined;
}

export function buildRankingState(params: {
  product: Pick<
    Product,
    | "releaseDate"
    | "recentSalesSnapshots"
    | "rankingMetrics"
    | "lastDailySalesSnapshotDate"
    | "lastDailySalesSnapshotCount"
  >;
  sourceDate: string;
  sourceSalesCount: number;
  priceCurrent: number;
  additionalSnapshots?: ProductSalesSnapshot[];
  dailySalesCount?: number;
  calculatedAt: Timestamp;
}): {
  recentSalesSnapshots: ProductSalesSnapshot[];
  rankingMetrics: ProductRankingMetrics;
} {
  const sourceDate = dateLikeToDateKey(params.sourceDate) ?? params.sourceDate;
  const seedSnapshots: ProductSalesSnapshot[] = [...(params.additionalSnapshots ?? [])];

  if (
    params.product.lastDailySalesSnapshotDate &&
    isFiniteNumber(params.product.lastDailySalesSnapshotCount)
  ) {
    seedSnapshots.push({
      date: params.product.lastDailySalesSnapshotDate,
      salesCount: params.product.lastDailySalesSnapshotCount,
    });
  }

  seedSnapshots.push({
    date: sourceDate,
    salesCount: params.sourceSalesCount,
    priceCurrent: params.priceCurrent,
  });

  const recentSalesSnapshots = mergeRecentSalesSnapshots(
    params.product.recentSalesSnapshots,
    seedSnapshots,
  );
  const weeklySalesCount = resolvePeriodSalesCount({
    snapshots: recentSalesSnapshots,
    sourceDate,
    sourceSalesCount: params.sourceSalesCount,
    releaseDate: params.product.releaseDate,
    days: 7,
  });
  const monthlySalesCount = resolvePeriodSalesCount({
    snapshots: recentSalesSnapshots,
    sourceDate,
    sourceSalesCount: params.sourceSalesCount,
    releaseDate: params.product.releaseDate,
    days: 30,
  });
  const preservedDailySalesCount =
    params.product.rankingMetrics?.sourceDate === sourceDate &&
    params.product.rankingMetrics.dailyAvailable &&
    isFiniteNumber(params.product.rankingMetrics.dailySalesCount)
      ? params.product.rankingMetrics.dailySalesCount
      : undefined;
  const dailySalesCount = isFiniteNumber(params.dailySalesCount)
    ? params.dailySalesCount
    : preservedDailySalesCount;
  const dailyAvailable = isFiniteNumber(dailySalesCount) && dailySalesCount >= 0;

  return {
    recentSalesSnapshots,
    rankingMetrics: {
      sourceDate,
      priceCurrent: params.priceCurrent,
      dailySalesCount: dailyAvailable ? dailySalesCount : undefined,
      dailyRevenue: dailyAvailable ? params.priceCurrent * dailySalesCount : undefined,
      weeklySalesCount,
      monthlySalesCount,
      cumulativeSalesCount: params.sourceSalesCount,
      dailyAvailable,
      weeklyAvailable: isFiniteNumber(weeklySalesCount),
      monthlyAvailable: isFiniteNumber(monthlySalesCount),
      calculatedAt: params.calculatedAt,
    },
  };
}
