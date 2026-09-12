import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import type {
  Product,
  ProductDailyMetric,
  ProductMetricYearDocument,
  ProductMetricYearPoint,
} from "../types";
import { db } from "../firebaseAdmin";

export const DAILY_METRICS_COLLECTION = "dailyMetrics";
export const METRIC_YEARS_COLLECTION = "metricYears";

export type MetricHistoryWriteMode = "legacy" | "year" | "dual";
export type MetricHistoryReadMode = "legacy" | "year" | "compare";

export type MetricHistoryEntry = {
  date: string;
  metric: Partial<ProductDailyMetric>;
};

export type MetricYearMutation = {
  year: string;
  data: ProductMetricYearDocument;
};

export type LoadedProductMetrics = {
  metricsByProductId: Map<string, Map<string, ProductDailyMetric>>;
  requestedReadCount: number;
  existingMetricCount: number;
};

const YEAR_POINT_FIELDS = [
  "priceCurrent",
  "priceOriginal",
  "salesCount",
  "dailySalesCount",
  "dailySalesStatus",
  "dailySalesBaseDate",
  "dailySalesNextDate",
  "dailySalesBaseCount",
  "dailySalesNextCount",
  "dailySalesRawDelta",
  "dailySalesPeriodDays",
  "periodSalesCount",
  "dailySalesCalculatedAt", "dailySalesBasis", "dailySalesObservedAt", "dailySalesDefinitionVersion",
  "fetchedAt",
] as const satisfies readonly (keyof ProductMetricYearPoint)[];

function normalizeMode<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  const normalized = value?.trim().toLowerCase();
  return allowed.includes(normalized as T) ? normalized as T : fallback;
}

export function getMetricHistoryWriteMode(): MetricHistoryWriteMode {
  return normalizeMode(
    process.env.METRIC_HISTORY_WRITE_MODE,
    ["legacy", "year", "dual"] as const,
    "legacy",
  );
}

export function getMetricHistoryReadMode(): MetricHistoryReadMode {
  return normalizeMode(
    process.env.METRIC_HISTORY_READ_MODE,
    ["legacy", "year", "compare"] as const,
    "legacy",
  );
}

export function writesLegacyMetrics(mode = getMetricHistoryWriteMode()): boolean {
  return mode === "legacy" || mode === "dual";
}

export function writesMetricYears(mode = getMetricHistoryWriteMode()): boolean {
  return mode === "year" || mode === "dual";
}

export function isValidMetricDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

export function toMetricYearPoint(
  metric: Partial<ProductDailyMetric>,
): ProductMetricYearPoint {
  const point: ProductMetricYearPoint = {};
  const source = metric as Record<string, unknown>;
  const target = point as Record<string, unknown>;
  for (const field of YEAR_POINT_FIELDS) {
    const value = source[field];
    if (value !== undefined) target[field] = value;
  }
  return point;
}

function resolveUpdatedAt(entries: MetricHistoryEntry[]): Timestamp {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const metric = entries[index]?.metric;
    if (metric?.fetchedAt) return metric.fetchedAt;
    if (metric?.dailySalesCalculatedAt) return metric.dailySalesCalculatedAt;
  }
  throw new Error("metric year mutation requires fetchedAt or dailySalesCalculatedAt");
}

export function buildMetricYearMutations(
  product: Pick<Product, "platform" | "audience" | "category">,
  entries: MetricHistoryEntry[],
): MetricYearMutation[] {
  const entriesByYear = new Map<string, MetricHistoryEntry[]>();
  for (const entry of entries) {
    if (!isValidMetricDate(entry.date)) {
      throw new Error(`invalid metric date: ${entry.date}`);
    }
    const year = entry.date.slice(0, 4);
    const current = entriesByYear.get(year) ?? [];
    current.push(entry);
    entriesByYear.set(year, current);
  }

  return [...entriesByYear.entries()].map(([year, yearEntries]) => {
    const points: Record<string, ProductMetricYearPoint> = {};
    for (const entry of yearEntries) {
      const dayKey = entry.date.slice(4);
      points[dayKey] = {
        ...(points[dayKey] ?? {}),
        ...toMetricYearPoint(entry.metric),
      };
    }
    return {
      year,
      data: {
        schemaVersion: 1,
        year,
        platform: product.platform,
        audience: product.audience,
        category: product.category,
        points,
        updatedAt: resolveUpdatedAt(yearEntries),
      },
    };
  });
}

export function metricYearRef(
  productRef: DocumentReference,
  year: string,
): DocumentReference {
  return productRef.collection(METRIC_YEARS_COLLECTION).doc(year);
}

export function decodeMetricYear(
  document: ProductMetricYearDocument,
): Map<string, ProductDailyMetric> {
  const metrics = new Map<string, ProductDailyMetric>();
  if (document.schemaVersion !== 1 || !/^\d{4}$/.test(document.year)) return metrics;

  for (const [dayKey, point] of Object.entries(document.points ?? {})) {
    const date = `${document.year}${dayKey}`;
    if (!/^\d{4}$/.test(dayKey) || !isValidMetricDate(date) || !point || typeof point !== "object") {
      continue;
    }
    metrics.set(date, {
      date,
      platform: document.platform,
      audience: document.audience,
      category: document.category,
      ...point,
      fetchedAt: point.fetchedAt ?? document.updatedAt,
    });
  }
  return metrics;
}

export function listMetricYears(startDate: string, endDate: string): string[] {
  if (!isValidMetricDate(startDate) || !isValidMetricDate(endDate) || startDate > endDate) {
    throw new Error(`invalid metric date range: ${startDate}..${endDate}`);
  }
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  return Array.from({ length: endYear - startYear + 1 }, (_, index) => String(startYear + index));
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function getAllInChunks(
  refs: FirebaseFirestore.DocumentReference[],
  chunkSize = 500,
  concurrency = 4,
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const chunks = chunkArray(refs, chunkSize);
  const snapshots: FirebaseFirestore.DocumentSnapshot[] = [];
  for (let index = 0; index < chunks.length; index += concurrency) {
    const loaded = await Promise.all(
      chunks.slice(index, index + concurrency).map((chunk) => db.getAll(...chunk)),
    );
    snapshots.push(...loaded.flat());
  }
  return snapshots;
}

async function loadLegacyDateKeys(
  productIds: string[],
  dateKeys: string[],
): Promise<LoadedProductMetrics> {
  const refs = productIds.flatMap((productId) =>
    dateKeys.map((date) =>
      db.collection("products").doc(productId).collection(DAILY_METRICS_COLLECTION).doc(date),
    ),
  );
  const snapshots = await getAllInChunks(refs);
  const metricsByProductId = new Map<string, Map<string, ProductDailyMetric>>();
  let existingMetricCount = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const productId = snapshot.ref.parent.parent?.id;
    if (!productId) continue;
    const productMetrics = metricsByProductId.get(productId) ?? new Map<string, ProductDailyMetric>();
    productMetrics.set(snapshot.id, snapshot.data() as ProductDailyMetric);
    metricsByProductId.set(productId, productMetrics);
    existingMetricCount += 1;
  }
  return { metricsByProductId, requestedReadCount: refs.length, existingMetricCount };
}

async function loadYearDateKeys(
  productIds: string[],
  dateKeys: string[],
): Promise<LoadedProductMetrics> {
  const requestedDates = new Set(dateKeys);
  const years = [...new Set(dateKeys.map((date) => date.slice(0, 4)))];
  const refs = productIds.flatMap((productId) =>
    years.map((year) => metricYearRef(db.collection("products").doc(productId), year)),
  );
  const snapshots = await getAllInChunks(refs);
  const metricsByProductId = new Map<string, Map<string, ProductDailyMetric>>();
  let existingMetricCount = 0;
  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;
    const productId = snapshot.ref.parent.parent?.id;
    if (!productId) continue;
    const productMetrics = metricsByProductId.get(productId) ?? new Map<string, ProductDailyMetric>();
    for (const [date, metric] of decodeMetricYear(snapshot.data() as ProductMetricYearDocument)) {
      if (!requestedDates.has(date)) continue;
      productMetrics.set(date, metric);
      existingMetricCount += 1;
    }
    metricsByProductId.set(productId, productMetrics);
  }
  return { metricsByProductId, requestedReadCount: refs.length, existingMetricCount };
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
    dailySalesBasis: metric.dailySalesBasis,
    dailySalesDefinitionVersion: metric.dailySalesDefinitionVersion,
    dailySalesObservedAt: metric.dailySalesObservedAt,
    periodSalesCount: metric.periodSalesCount,
  });
}

export async function loadProductMetricsForDateKeys(
  productIds: string[],
  dateKeys: string[],
  mode = getMetricHistoryReadMode(),
): Promise<LoadedProductMetrics> {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  const uniqueDateKeys = [...new Set(dateKeys)];
  if (uniqueDateKeys.some((date) => !isValidMetricDate(date))) {
    throw new Error("metric date keys must use valid YYYYMMDD values");
  }
  if (mode === "legacy") return loadLegacyDateKeys(uniqueProductIds, uniqueDateKeys);
  if (mode === "year") return loadYearDateKeys(uniqueProductIds, uniqueDateKeys);

  const [legacy, yearly] = await Promise.all([
    loadLegacyDateKeys(uniqueProductIds, uniqueDateKeys),
    loadYearDateKeys(uniqueProductIds, uniqueDateKeys),
  ]);
  for (const productId of uniqueProductIds) {
    const legacyMetrics = legacy.metricsByProductId.get(productId) ?? new Map();
    const yearMetrics = yearly.metricsByProductId.get(productId) ?? new Map();
    const mismatches = uniqueDateKeys.filter((date) =>
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
  return {
    metricsByProductId: legacy.metricsByProductId,
    requestedReadCount: legacy.requestedReadCount + yearly.requestedReadCount,
    existingMetricCount: legacy.existingMetricCount,
  };
}
