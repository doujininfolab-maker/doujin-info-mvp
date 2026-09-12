import type { Product, ProductDailyMetric } from "../types";
import { buildReleaseDaySalesPatch } from "./releaseDaySales";

/** Builds a correction only from a retained D+1 observation, never today's total. */
export function planReleaseDayBackfill(product: Product, metric: ProductDailyMetric): {
  productPatch: Partial<Product>; metricPatch: Partial<ProductDailyMetric>;
} | undefined {
  if (product.releaseDaySales || metric.date !== product.releaseDate?.slice(0, 10).replaceAll("-", "") ||
      ["invalid_snapshot_date", "sales_count_missing", "negative_delta", "multi_day_gap"].includes(metric.dailySalesStatus ?? "") ||
      !metric.fetchedAt || typeof metric.priceCurrent !== "number" || !Number.isFinite(metric.priceCurrent) || metric.priceCurrent < 0) return undefined;
  const observed = metric.fetchedAt;
  const batchDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(observed.toDate()).replaceAll("-", "");
  const patch = buildReleaseDaySalesPatch({ product: { ...product, salesCount: metric.salesCount, priceCurrent: metric.priceCurrent }, metricDate: metric.date, batchDate, observedAt: observed });
  const initial = patch?.productPatch.releaseDaySales;
  if (!initial) return undefined;
  const productPatch: Partial<Product> = { releaseDaySales: initial };
  if (product.recentSalesSnapshots?.some((point) => point.date === metric.date)) {
    productPatch.recentSalesSnapshots = product.recentSalesSnapshots.map((point) => point.date === metric.date ? { ...point, salesCount: initial.count, priceCurrent: initial.priceCurrent } : point);
  }
  if (product.rankingMetrics?.sourceDate === metric.date) {
    productPatch.rankingMetrics = { ...product.rankingMetrics, dailySalesCount: initial.count, dailyRevenue: initial.count * initial.priceCurrent, dailyAvailable: true };
  }
  // Current totals and the current normal-day baseline are deliberately retained.
  return { productPatch, metricPatch: patch.metricPatch };
}
