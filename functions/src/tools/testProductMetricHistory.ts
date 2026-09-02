import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import {
  buildMetricYearMutations,
  decodeMetricYear,
  isValidMetricDate,
  listMetricYears,
  toMetricYearPoint,
} from "../firestore/productMetricHistory";
import type { Product, ProductDailyMetric } from "../types";

const product = {
  platform: "dlsite",
  audience: "female",
  category: "doujin",
} satisfies Pick<Product, "platform" | "audience" | "category">;

function metric(date: string, salesCount: number, dailySalesCount: number): ProductDailyMetric {
  return {
    date,
    ...product,
    priceCurrent: 770,
    priceOriginal: 1100,
    salesCount,
    dailySalesCount,
    dailySalesStatus: "calculated",
    dailySalesBaseDate: String(Number(date) - 1),
    dailySalesNextDate: date,
    dailySalesBaseCount: salesCount - dailySalesCount,
    dailySalesNextCount: salesCount,
    dailySalesRawDelta: dailySalesCount,
    dailySalesPeriodDays: 1,
    dailySalesCalculatedAt: Timestamp.fromMillis(1_000),
    fetchedAt: Timestamp.fromMillis(2_000),
  };
}

function run(): void {
  assert.equal(isValidMetricDate("20240229"), true);
  assert.equal(isValidMetricDate("20230229"), false);
  assert.equal(isValidMetricDate("20241301"), false);
  assert.deepEqual(listMetricYears("20251231", "20260101"), ["2025", "2026"]);
  assert.deepEqual(listMetricYears("20260101", "20261231"), ["2026"]);

  const point = toMetricYearPoint({
    ...metric("20260831", 100, 4),
    rating: 4.8,
    wishlistCount: 99,
  });
  assert.equal(point.salesCount, 100);
  assert.equal(point.dailySalesCount, 4);
  assert.equal("rating" in point, false);
  assert.equal("wishlistCount" in point, false);

  const sameYear = buildMetricYearMutations(product, [
    { date: "20260830", metric: { dailySalesCount: 3, dailySalesStatus: "calculated", dailySalesCalculatedAt: Timestamp.fromMillis(1_500) } },
    { date: "20260831", metric: metric("20260831", 100, 4) },
  ]);
  assert.equal(sameYear.length, 1, "same-year corrections must be coalesced into one write");
  assert.deepEqual(Object.keys(sameYear[0]?.data.points ?? {}).sort(), ["0830", "0831"]);

  const crossYear = buildMetricYearMutations(product, [
    { date: "20251231", metric: metric("20251231", 90, 2) },
    { date: "20260101", metric: metric("20260101", 95, 5) },
  ]);
  assert.equal(crossYear.length, 2);

  const decoded = decodeMetricYear(sameYear[0]!.data);
  assert.equal(decoded.get("20260831")?.salesCount, 100);
  assert.equal(decoded.get("20260831")?.priceCurrent, 770);
  assert.equal(decoded.get("20260830")?.dailySalesCount, 3);
  assert.equal(decoded.get("20260831")?.platform, "dlsite");

  assert.throws(
    () => buildMetricYearMutations(product, [{ date: "20260229", metric: metric("20260228", 1, 1) }]),
    /invalid metric date/,
  );

  console.log("Product metric history unit tests passed.");
}

run();
