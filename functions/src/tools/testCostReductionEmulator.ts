import { executeVisibilityChange } from "../visibility/contentVisibilityAdmin";
import { planReleaseDayBackfill } from "../batch/backfillReleaseDaySales";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import { releaseConfirmationContentType, buildDailySalesPatch, FirestoreWriteBuffer, saveProductAndMetric } from "../batch/fetchDailyPriorityProducts";
import { buildDailySalesDeltaUpdate } from "../batch/fetchGirlsReleaseOldProducts";
import { buildReleaseDaySalesPatch, preserveReleaseDayMetric } from "../batch/releaseDaySales";
import { buildMetricYearMutations } from "../firestore/productMetricHistory";
import { buildRankingState } from "../batch/rankingMetrics";
import { captureGenreSourceRevision, genreSourceRef, publishGenreDetailView, readGenreSource, withGenreSourceMutation, queueGenreDetailView, packGenreRows } from "../batch/genreDetailView";
import { getProductsForSiteStats } from "../batch/rebuildSiteStats";
import type { Product } from "../types";

assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? "", /^127\.0\.0\.1:8188$/);
assert.equal(process.env.GCLOUD_PROJECT, "demo-cost-review");
process.env.GENRE_DETAIL_AGGREGATION_ENABLED = "true";
process.env.METRIC_HISTORY_WRITE_MODE = "year";
const segment = { platform: "dlsite", audience: "female", category: "doujin" } as const;
const at = (day: string) => Timestamp.fromDate(new Date(`${day}T02:00:00+09:00`));
const product = { ...segment, productId: "dlsite_doujin_INITIAL", sourceProductId: "INITIAL", title: "初日確認", releaseDate: "2026-09-01", salesCount: 50, priceCurrent: 100, isActive: true, sourceIsActive: true, genres: ["テスト"], genreIds: ["dlsite:test"], tags: [], images: [], sourceUrl: "https://example.invalid/item" } as unknown as Product;

async function run() {
  for (const id of [product.productId, "atomic_0", "atomic_1", "atomic_2", "late_INITIAL"]) {
    await db.doc(`products/${id}/metricYears/2026`).delete();
    await db.doc(`products/${id}`).delete();
  }
  await db.doc(`products/${product.productId}/dailyMetrics/20260801`).delete();
  const buffer = new FirestoreWriteBuffer(5);
  let existing: Product | undefined;
  for (const [date, metricDate, count, expected] of [
    ["2026-09-01", "20260901", 50, null], ["2026-09-02", "20260901", 120, 120],
    ["2026-09-03", "20260902", 200, 80], ["2026-09-04", "20260903", 260, 60],
  ] as const) {
    const saved = await saveProductAndMetric({ writeBuffer: buffer, product: { ...product, salesCount: count }, metricDate, batchDate: date.replaceAll("-", ""), observedAt: at(date), existingProduct: existing });
    await buffer.flush();
    existing = { ...existing, ...saved.product };
    const point = (await db.doc(`products/${product.productId}/metricYears/2026`).get()).data()!.points[metricDate.slice(4)];
    assert.equal(point.dailySalesCount, expected);
    assert.equal(existing.lastDailySalesSnapshotCount, count);
    if (expected !== null) assert.equal(existing.rankingMetrics?.dailySalesCount, expected);
  }
  assert.equal((await db.doc(`products/${product.productId}`).collection("dailyMetrics").get()).size, 0);
  assert.equal(existing!.releaseDaySales!.count, 120);
  const year = (await db.doc(`products/${product.productId}/metricYears/2026`).get()).data()!;
  assert.equal(year.points["0901"].dailySalesBasis, "release_day_cumulative");
  assert.equal(year.points["0901"].salesCount, 120);
  assert.equal(year.points["0901"].dailySalesObservedAt.toMillis(), at("2026-09-02").toMillis());
  assert.equal(buffer.writeOperationCount, 8, "one product + one year write per observation");
  for (const count of [0, 120]) {
    const patch = buildReleaseDaySalesPatch({ product: { ...product, salesCount: count }, metricDate: "20260901", batchDate: "20260902", observedAt: at("2026-09-02") });
    assert.equal(patch?.metricPatch.dailySalesCount, count, "first seen D+1 does not require an earlier snapshot");
  }
  for (const override of [
    { observedAt: at("2026-09-03") }, { product: { ...product, salesCount: -1 } },
    { product: { ...product, salesCount: undefined } }, { existingProduct: { ...product, releaseDate: "2026-08-31" } },
  ]) {
    const patch = buildReleaseDaySalesPatch({ product, metricDate: "20260901", batchDate: "20260902", observedAt: at("2026-09-02"), ...override });
    assert.notEqual(patch?.metricPatch.dailySalesStatus, "calculated");
    assert.deepEqual(patch?.productPatch ?? {}, {});
  }
  assert.equal(buildReleaseDaySalesPatch({ product, metricDate: "20260902", batchDate: "20260903", observedAt: at("2026-09-03") }), undefined, "D+2 never fabricates D");
  const missed = buildDailySalesPatch({ product: { ...product, salesCount: 200 }, metricDate: "20260902", batchDate: "20260903", observedAt: at("2026-09-03"), calculatedAt: at("2026-09-03"), existingProduct: { ...product, lastDailySalesSnapshotDate: "20260901", lastDailySalesSnapshotCount: 50, lastDailySalesSnapshotFetchedAt: at("2026-09-01") } });
  assert.equal(missed.metricPatch.dailySalesCount, null);
  assert.equal(missed.metricPatch.dailySalesStatus, "multi_day_gap");
  assert.equal(missed.metricPatch.dailySalesPeriodDays, 2);
  assert.equal(releaseConfirmationContentType({ ...product, contentTypeIds: ["dlsite:bl"] }), "bl");
  assert.equal(releaseConfirmationContentType({ ...product, contentTypeIds: ["dlsite:tl", "dlsite:bl"] }), "tl");
  const protectedMetric = preserveReleaseDayMetric(existing, "20260901", { dailySalesCount: 70, salesCount: 999 });
  assert.equal(protectedMetric.dailySalesCount, 120);
  assert.equal(protectedMetric.salesCount, 120);
  const oldWriter = buildDailySalesDeltaUpdate({ product: { ...product, salesCount: 300 }, currentDate: "20260905", salesDate: "20260904", existingProduct: existing, calculatedAt: at("2026-09-05") });
  assert.deepEqual(oldWriter.productPatch, {}, "old collector cannot shift the priority date basis");
  assert.equal(oldWriter.previousMetricDate, undefined);
  const ordinary = buildDailySalesPatch({ product: { ...product, salesCount: 300 }, metricDate: "20260904", existingProduct: existing, calculatedAt: at("2026-09-05") });
  assert.equal(ordinary.metricPatch.dailySalesCount, 40);
  const dec = { ...product, releaseDate: "2026-12-31" };
  const crossYear = buildReleaseDaySalesPatch({ product: dec, metricDate: "20261231", batchDate: "20270101", observedAt: at("2027-01-01") })!;
  assert.equal(buildMetricYearMutations(dec, [{ date: "20261231", metric: { ...crossYear.metricPatch, fetchedAt: at("2027-01-01") } }])[0]!.year, "2026");
  const rank = buildRankingState({ product: existing!, sourceDate: "20260904", sourceSalesCount: 300, priceCurrent: 100, dailySalesCount: 40, calculatedAt: at("2026-09-05") });
  assert.equal(rank.rankingMetrics.weeklySalesCount, 300, "initial daily count does not double-count the weekly cumulative total");

  const historicalProduct = { ...existing!, releaseDaySales: undefined };
  const historicalMetric = { ...year.points["0901"], date: "20260901", ...segment, fetchedAt: at("2026-09-02"), priceCurrent: 100, dailySalesCount: 70 };
  const historicalPlan = planReleaseDayBackfill(historicalProduct, historicalMetric)!;
  assert.equal(historicalPlan.metricPatch.dailySalesCount, 120);
  assert.equal(historicalPlan.productPatch.lastDailySalesSnapshotDate, undefined);
  assert.equal(historicalPlan.productPatch.salesCount, undefined);
  assert.equal(planReleaseDayBackfill(historicalProduct, { ...historicalMetric, fetchedAt: at("2026-09-01") }), undefined);
  assert.equal(planReleaseDayBackfill(historicalProduct, { ...historicalMetric, fetchedAt: at("2026-09-03") }), undefined);
  await db.doc("products/retro_PROOF").set({ ...historicalProduct, productId: "retro_PROOF", isActive: false, sourceIsActive: false });
  await db.doc("products/retro_PROOF/metricYears/2026").set({ ...year, points: { ...year.points, "0901": historicalMetric } });
  const grouped = new FirestoreWriteBuffer(5);
  for (let i = 0; i < 3; i++) {
    await saveProductAndMetric({ writeBuffer: grouped, product: { ...product, productId: `atomic_${i}`, isActive: false, sourceIsActive: false }, metricDate: "20260901", batchDate: "20260902", observedAt: at("2026-09-02") });
  }
  assert.equal(grouped.commitCount, 1);
  for (let i = 0; i < 3; i++) {
    assert.equal((await db.doc(`products/atomic_${i}`).get()).exists, i < 2);
    assert.equal((await db.doc(`products/atomic_${i}/metricYears/2026`).get()).exists, i < 2);
  }
  await grouped.flush();

  const lateBuffer = new FirestoreWriteBuffer();
  const rawLate = { ...product, productId: "late_INITIAL", isActive: false, sourceIsActive: false };
  await saveProductAndMetric({ writeBuffer: lateBuffer, product: rawLate, metricDate: "20260901", batchDate: "20260901", observedAt: at("2026-09-01") });
  await lateBuffer.flush();
  const beforeLate = (await db.doc("products/late_INITIAL").get()).data() as Product;
  await saveProductAndMetric({ writeBuffer: lateBuffer, product: { ...rawLate, salesCount: 120 }, metricDate: "20260901", batchDate: "20260902", observedAt: at("2026-09-03"), existingProduct: beforeLate });
  await lateBuffer.flush();
  assert.equal((await db.doc("products/late_INITIAL/metricYears/2026").get()).data()!.points["0901"].salesCount, 50);
  assert.equal((await db.doc("products/late_INITIAL").get()).data()!.lastDailySalesSnapshotCount, 50);
  const beforeInvalidVisibility = (await genreSourceRef().get()).data();
  await assert.rejects(() => executeVisibilityChange({ caseId: "", performedBy: "local" } as Parameters<typeof executeVisibilityChange>[0]));
  assert.deepEqual((await genreSourceRef().get()).data(), beforeInvalidVisibility);
  const invalidBuffer = new FirestoreWriteBuffer();
  await assert.rejects(() => saveProductAndMetric({ writeBuffer: invalidBuffer, product: { ...product, productId: "invalid_metric", releaseDate: "2020-01-01" }, metricDate: "20260230", batchDate: "20260301", observedAt: at("2026-03-01") }), /invalid metric date/);
  assert.equal(invalidBuffer.writeOperationCount, 0, "invalid history must not enqueue a product-only write");
  const failingBuffer = new FirestoreWriteBuffer();
  await saveProductAndMetric({ writeBuffer: failingBuffer, product: { ...product, productId: "failed_commit", title: "x".repeat(1100000), isActive: false, sourceIsActive: false }, metricDate: "20260901", batchDate: "20260902", observedAt: at("2026-09-02") });
  await assert.rejects(() => failingBuffer.flush());
  assert.equal((await db.doc("products/failed_commit").get()).exists, false);
  assert.equal((await db.doc("products/failed_commit/metricYears/2026").get()).exists, false);
  for (const mode of ["legacy", "dual"] as const) {
    process.env.METRIC_HISTORY_WRITE_MODE = mode;
    const modeBuffer = new FirestoreWriteBuffer();
    await saveProductAndMetric({ writeBuffer: modeBuffer, product: { ...product, productId: `mode_${mode}`, isActive: false, sourceIsActive: false }, metricDate: "20260901", batchDate: "20260902", observedAt: at("2026-09-02") });
    await modeBuffer.flush();
    assert.equal((await db.doc(`products/mode_${mode}/dailyMetrics/20260901`).get()).data()!.dailySalesCount, 50);
    assert.equal(modeBuffer.writeOperationCount, mode === "dual" ? 3 : 2);
  }
  process.env.METRIC_HISTORY_WRITE_MODE = "year";
  const legacyRef = db.doc(`products/${product.productId}/dailyMetrics/20260801`);
  await legacyRef.set({ date: "20260801", salesCount: 7 });
  const retainedBefore = (await legacyRef.get()).updateTime!.toMillis();
  const yearOnly = new FirestoreWriteBuffer();
  await saveProductAndMetric({ writeBuffer: yearOnly, product: { ...product, salesCount: 300 }, metricDate: "20260904", batchDate: "20260905", observedAt: at("2026-09-05"), existingProduct: existing });
  await yearOnly.flush();
  assert.equal((await legacyRef.get()).updateTime!.toMillis(), retainedBefore, "year mode retains old dailyMetrics unchanged");

  // Deterministic fixtures include ties, hidden/missing/null counts, multiple
  // content types, old work-type aliases, and more than one packed block.
  for (let start = 0; start < 1205; start += 350) {
    const batch = db.batch();
    for (let i = start; i < Math.min(1205, start + 350); i++) {
      const id = `dlsite_doujin_TEST${String(i).padStart(4, "0")}`;
      const row = { ...product, productId: id, sourceProductId: id, title: `検証作品 ${i}`, salesCount: Math.floor((1205 - i) / 3), contentTypeIds: [i % 2 ? "dlsite:bl" : "dlsite:tl"], workType: ["comic", "voice", "game", "novel", "cg", "movie", "other", "マンガ"][i % 8], seller: { sellerId: `RG${i % 7}`, sellerName: `サークル ${i % 7}` }, isActive: i !== 100, genreIds: ["dlsite:test", ...(i < 5 ? ["dlsite:small"] : [])] };
      if (i === 1203) delete (row as Partial<Product>).salesCount;
      if (i === 1204) (row as unknown as { salesCount: null }).salesCount = null;
      batch.set(db.collection("products").doc(id), row);
    }
    await batch.commit();
  }
  const products = await getProductsForSiteStats(segment);
  const before = await readGenreSource();
  let published = await publishGenreDetailView({ segment, products, revision: before.revision });
  assert.equal(published.published, true);
  assert.ok(published.blocks >= 5);
  await withGenreSourceMutation(async () => {
    const active = await readGenreSource();
    assert.ok(Object.keys(active.writers).length > 0);
    assert.equal((await publishGenreDetailView({ segment, products, revision: active.revision })).published, false);
    await queueGenreDetailView({ segment, products, revision: active.revision });
  });
  await withGenreSourceMutation(async () => {
    const alone = await captureGenreSourceRevision();
    assert.ok(alone >= 0);
    await genreSourceRef().update({ "writers.foreign": true });
    const unsafeRevision = await captureGenreSourceRevision();
    assert.equal(unsafeRevision, -1);
    const { FieldValue } = await import("firebase-admin/firestore");
    await genreSourceRef().update({ "writers.foreign": FieldValue.delete() });
    assert.equal((await publishGenreDetailView({ segment, products, revision: unsafeRevision })).published, false);
  });
  await publishGenreDetailView({ segment, products, revision: await captureGenreSourceRevision() });
  assert.deepEqual((await readGenreSource()).writers, {});
  assert.equal((await publishGenreDetailView({ segment, products, revision: before.revision })).published, false, "older captured source cannot publish");
  const oversize = [{ productId: "large", title: "x".repeat(5 * 1024 * 1024) }];
  assert.throws(() => packGenreRows(oversize), /size limit/);
  console.log(JSON.stringify({ status: "passed", metricWrites: buffer.writeOperationCount, dailyMetricWrites: 0, initialSales: 120, followingSales: [80, 60], genreProducts: products.length, genreBlocks: published.blocks, source: await readGenreSource() }));
}
run().then(() => db.terminate()).catch((error) => { console.error(error); process.exitCode = 1; });
