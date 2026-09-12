import type { Product, ProductDailyMetric } from "../types";
import { toYyyyMMdd } from "../util";

/** Only an observation on D+1 can establish the release-day cumulative total. */
export function buildReleaseDaySalesPatch(params: {
  product: Product;
  existingProduct?: Product;
  metricDate: string;
  batchDate?: string;
  observedAt?: FirebaseFirestore.Timestamp;
}): { metricPatch: Partial<ProductDailyMetric>; productPatch: Partial<Product> } | undefined {
  const { product, existingProduct, observedAt, batchDate, metricDate } = params;
  const releaseDate = product.releaseDate?.slice(0, 10).replaceAll("-", "");
  const confirmed = existingProduct?.releaseDaySales;
  // Other collectors and invalid observations must never erase a confirmed point.
  if (confirmed?.date === metricDate) return { metricPatch: {}, productPatch: {} };
  if (!releaseDate || !/^\d{8}$/.test(releaseDate) || releaseDate !== metricDate || !observedAt || !batchDate) return undefined;
  const releaseUtc = new Date(`${product.releaseDate!.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(releaseUtc.getTime()) || releaseUtc.toISOString().slice(0, 10).replaceAll("-", "") !== releaseDate) return undefined;
  const nextDate = new Date(releaseUtc.getTime() + 86400000).toISOString().slice(0, 10).replaceAll("-", "");
  const count = product.salesCount;
  if (batchDate !== nextDate || toYyyyMMdd(observedAt.toDate()) !== nextDate ||
      typeof count !== "number" || !Number.isFinite(count) || count < 0 ||
      (existingProduct?.releaseDate && existingProduct.releaseDate.slice(0, 10) !== product.releaseDate?.slice(0, 10)) ||
      (existingProduct?.lastDailySalesSnapshotDate && existingProduct.lastDailySalesSnapshotDate > metricDate) ||
      (existingProduct?.lastDailySalesSnapshotFetchedAt && existingProduct.lastDailySalesSnapshotFetchedAt.toMillis() > observedAt.toMillis())) {
    // On D itself the existing provisional snapshot path is used. A late or
    // inconsistent D+1 observation must not advance the normal-day baseline.
    if (batchDate > releaseDate) return { metricPatch: { dailySalesCount: null, dailySalesStatus: typeof count !== "number" || !Number.isFinite(count) ? "sales_count_missing" : count < 0 ? "negative_delta" : "invalid_snapshot_date" }, productPatch: {} };
    return undefined;
  }
  const priceCurrent = product.priceCurrent ?? product.priceOriginal ?? 0;
  return {
    metricPatch: {
      dailySalesCount: count,
      dailySalesStatus: "calculated",
      dailySalesBasis: "release_day_cumulative",
      dailySalesObservedAt: observedAt,
      dailySalesDefinitionVersion: 1,
      dailySalesBaseDate: releaseDate,
      dailySalesNextDate: nextDate,
      dailySalesBaseCount: 0,
      dailySalesNextCount: count,
      dailySalesRawDelta: count,
      dailySalesPeriodDays: 1,
      dailySalesCalculatedAt: observedAt,
    },
    productPatch: {
      dailySalesSnapshotBasis: "priority_metric_date",
      releaseDaySales: { date: releaseDate, count, priceCurrent, observedAt, definitionVersion: 1 },
      lastDailySalesSnapshotDate: metricDate,
      lastDailySalesSnapshotCount: count,
      lastDailySalesSnapshotFetchedAt: observedAt,
      lastDailySalesDeltaCalculatedDate: metricDate,
    },
  };
}

export function preserveReleaseDayMetric(product: Product | undefined, date: string, metric: Partial<ProductDailyMetric>): Partial<ProductDailyMetric> {
  const confirmed = product?.releaseDaySales;
  if (!confirmed || confirmed.date !== date) return metric;
  return {
    ...metric,
    salesCount: confirmed.count,
    priceCurrent: confirmed.priceCurrent,
    dailySalesCount: confirmed.count,
    dailySalesStatus: "calculated",
    dailySalesBasis: "release_day_cumulative",
    dailySalesObservedAt: confirmed.observedAt,
    dailySalesDefinitionVersion: 1,
    fetchedAt: confirmed.observedAt,
    dailySalesCalculatedAt: confirmed.observedAt,
    dailySalesBaseDate: date,
    dailySalesNextDate: toYyyyMMdd(confirmed.observedAt.toDate()),
    dailySalesBaseCount: 0,
    dailySalesNextCount: confirmed.count,
    dailySalesRawDelta: confirmed.count,
    dailySalesPeriodDays: 1,
  };
}
