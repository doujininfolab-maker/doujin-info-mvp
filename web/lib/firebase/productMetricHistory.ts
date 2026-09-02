import type { DocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import type {
  ProductDailyMetric,
  ProductMetricYearDocument,
} from "../types";

const PRODUCTS_COLLECTION = "products";
const DAILY_METRICS_COLLECTION = "dailyMetrics";
const METRIC_YEARS_COLLECTION = "metricYears";

export type MetricHistoryReadMode = "legacy" | "year" | "compare";

export type ProductMetricRangeLoad = {
  metricsByProductId: Map<string, Map<string, ProductDailyMetric>>;
  documentReadCount: number;
};

function getReadMode(): MetricHistoryReadMode {
  const value = process.env.METRIC_HISTORY_READ_MODE?.trim().toLowerCase();
  return value === "year" || value === "compare" ? value : "legacy";
}

function logReadSummary(
  mode: MetricHistoryReadMode,
  productCount: number,
  startDate: string,
  endDate: string,
  result: ProductMetricRangeLoad,
): void {
  if (process.env.METRIC_HISTORY_DEBUG !== "true") return;
  console.info("Metric history read", {
    mode,
    productCount,
    startDate,
    endDate,
    documentReadCount: result.documentReadCount,
  });
}

function isValidDateKey(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

export function listMetricYears(startDate: string, endDate: string): string[] {
  if (!isValidDateKey(startDate) || !isValidDateKey(endDate) || startDate > endDate) {
    throw new Error(`invalid metric date range: ${startDate}..${endDate}`);
  }
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => String(startYear + index));
}

function decodeMetricYear(
  snapshot: DocumentSnapshot,
  startDate: string,
  endDate: string,
): Map<string, ProductDailyMetric> {
  const metrics = new Map<string, ProductDailyMetric>();
  if (!snapshot.exists) return metrics;
  const document = snapshot.data() as ProductMetricYearDocument;
  if (document.schemaVersion !== 1 || !/^\d{4}$/.test(document.year)) return metrics;

  for (const [dayKey, point] of Object.entries(document.points ?? {})) {
    const date = `${document.year}${dayKey}`;
    if (!/^\d{4}$/.test(dayKey) || !isValidDateKey(date) || date < startDate || date > endDate) {
      continue;
    }
    metrics.set(date, {
      date,
      platform: document.platform,
      audience: document.audience,
      category: document.category,
      ...point,
      fetchedAt: point.fetchedAt ?? document.updatedAt ?? "",
    });
  }
  return metrics;
}

async function loadYearMetrics(
  productIds: string[],
  startDate: string,
  endDate: string,
): Promise<ProductMetricRangeLoad> {
  const db = getAdminDb();
  const years = listMetricYears(startDate, endDate);
  const refs = productIds.flatMap((productId) =>
    years.map((year) =>
      db.collection(PRODUCTS_COLLECTION).doc(productId).collection(METRIC_YEARS_COLLECTION).doc(year),
    ),
  );
  const snapshots = refs.length ? await db.getAll(...refs) : [];
  const metricsByProductId = new Map<string, Map<string, ProductDailyMetric>>();

  for (const snapshot of snapshots) {
    const productId = snapshot.ref.parent.parent?.id;
    if (!productId) continue;
    const productMetrics = metricsByProductId.get(productId) ?? new Map<string, ProductDailyMetric>();
    for (const [date, metric] of decodeMetricYear(snapshot, startDate, endDate)) {
      productMetrics.set(date, metric);
    }
    metricsByProductId.set(productId, productMetrics);
  }
  return { metricsByProductId, documentReadCount: refs.length };
}

async function loadLegacyMetrics(
  productIds: string[],
  startDate: string,
  endDate: string,
): Promise<ProductMetricRangeLoad> {
  const db = getAdminDb();
  const metricsByProductId = new Map<string, Map<string, ProductDailyMetric>>();
  let documentReadCount = 0;

  await Promise.all(productIds.map(async (productId) => {
    const snapshot = await db
      .collection(PRODUCTS_COLLECTION)
      .doc(productId)
      .collection(DAILY_METRICS_COLLECTION)
      .where("date", ">=", startDate)
      .where("date", "<=", endDate)
      .orderBy("date", "asc")
      .get();
    documentReadCount += snapshot.size;
    metricsByProductId.set(productId, new Map(snapshot.docs.map((doc) => {
      const metric = doc.data() as ProductDailyMetric;
      return [metric.date || doc.id, metric];
    })));
  }));

  return { metricsByProductId, documentReadCount };
}

function comparableMetric(metric: ProductDailyMetric | undefined): string {
  if (!metric) return "missing";
  return JSON.stringify({
    date: metric.date,
    priceCurrent: metric.priceCurrent,
    priceOriginal: metric.priceOriginal,
    salesCount: metric.salesCount,
    dailySalesCount: metric.dailySalesCount,
    dailySalesStatus: metric.dailySalesStatus,
    periodSalesCount: metric.periodSalesCount,
  });
}

function logComparison(
  productIds: string[],
  legacy: ProductMetricRangeLoad,
  yearly: ProductMetricRangeLoad,
): void {
  for (const productId of productIds) {
    const legacyMetrics = legacy.metricsByProductId.get(productId) ?? new Map();
    const yearMetrics = yearly.metricsByProductId.get(productId) ?? new Map();
    const dates = new Set([...legacyMetrics.keys(), ...yearMetrics.keys()]);
    const mismatches = [...dates].filter((date) =>
      comparableMetric(legacyMetrics.get(date)) !== comparableMetric(yearMetrics.get(date)),
    );
    if (mismatches.length) {
      console.warn("Metric history comparison mismatch", {
        productId,
        mismatchCount: mismatches.length,
        sampleDates: mismatches.slice(0, 10),
      });
    }
  }
}

export async function loadProductMetricRange(
  productId: string,
  startDate: string,
  endDate: string,
): Promise<ProductMetricRangeLoad> {
  return loadProductMetricRanges([productId], startDate, endDate);
}

export async function loadProductMetricRanges(
  productIds: string[],
  startDate: string,
  endDate: string,
): Promise<ProductMetricRangeLoad> {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  const mode = getReadMode();
  if (mode === "year") {
    const result = await loadYearMetrics(uniqueProductIds, startDate, endDate);
    logReadSummary(mode, uniqueProductIds.length, startDate, endDate, result);
    return result;
  }
  if (mode === "legacy") {
    const result = await loadLegacyMetrics(uniqueProductIds, startDate, endDate);
    logReadSummary(mode, uniqueProductIds.length, startDate, endDate, result);
    return result;
  }

  const [legacy, yearly] = await Promise.all([
    loadLegacyMetrics(uniqueProductIds, startDate, endDate),
    loadYearMetrics(uniqueProductIds, startDate, endDate),
  ]);
  logComparison(uniqueProductIds, legacy, yearly);
  const result = {
    metricsByProductId: legacy.metricsByProductId,
    documentReadCount: legacy.documentReadCount + yearly.documentReadCount,
  };
  logReadSummary(mode, uniqueProductIds.length, startDate, endDate, result);
  return result;
}
