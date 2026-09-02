import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { buildDailySalesPatch } from "../batch/fetchDailyPriorityProducts";
import type { Product } from "../types";

const baseProduct = {
  productId: "dlsite_doujin_RJTEST",
  sourceProductId: "RJTEST",
  platform: "dlsite",
  audience: "female",
  category: "doujin",
  title: "test",
  salesCount: 130,
} as Product;

const existingProduct = {
  ...baseProduct,
  salesCount: 120,
  lastDailySalesSnapshotDate: "20260830",
  lastDailySalesSnapshotCount: 120,
} as Product;

const calculatedAt = Timestamp.fromMillis(1_000);

const sameDay = buildDailySalesPatch({
  product: baseProduct,
  metricDate: "20260830",
  existingProduct,
  calculatedAt,
});
assert.deepEqual(sameDay.metricPatch, {}, "same-day retry must preserve the stored daily delta");
assert.equal(sameDay.productPatch.lastDailySalesSnapshotCount, 130);

const nextDay = buildDailySalesPatch({
  product: baseProduct,
  metricDate: "20260831",
  existingProduct,
  calculatedAt,
});
assert.equal(nextDay.metricPatch.dailySalesStatus, "calculated");
assert.equal(nextDay.metricPatch.dailySalesCount, 10);
assert.equal(nextDay.metricPatch.dailySalesPeriodDays, 1);

console.log("Daily priority sales patch unit tests passed.");
