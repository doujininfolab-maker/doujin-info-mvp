import { logger } from "firebase-functions";
import { db } from "../firebaseAdmin";
import type {
  BatchRun,
  FetchTarget,
  Product,
  ProductDailyMetric,
  RankingSnapshot,
  RankingSnapshotItem,
} from "../types";
import { BlockedAccessError } from "../adapters/types";
import { getAdapterForTarget } from "../adapters";
import {
  buildRankItemId,
  buildRankingKey,
  buildSnapshotId,
  createRunId,
  nowTimestamp,
  sleep,
  toIsoDateJst,
  toYyyyMMdd,
  withoutUndefined,
} from "../util";

export type FetchDailyProductsOptions = {
  targets: FetchTarget[];
  minIntervalMs?: number;
  maxProductIdsPerTarget?: number;
};

function buildMetric(product: Product, date: string, dateIso: string): ProductDailyMetric {
  return {
    date,
    dateIso,
    platform: product.platform,
    audience: product.audience,
    category: product.category,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    isDiscounted: product.isDiscounted,
    salesCount: product.salesCount,
    wishlistCount: product.wishlistCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    reviewCount: product.reviewCount,
    fetchedAt: nowTimestamp(),
  };
}

async function saveProductAndMetric(product: Product, date: string, dateIso: string): Promise<void> {
  const productRef = db.collection("products").doc(product.productId);
  await productRef.set(withoutUndefined(product), { merge: true });
  await productRef.collection("dailyMetrics").doc(date).set(withoutUndefined(buildMetric(product, date, dateIso)), { merge: true });
}

async function saveRankingSnapshot(params: {
  target: FetchTarget;
  date: string;
  dateIso: string;
  sourceUrl?: string;
  products: Product[];
}): Promise<string> {
  const rankingKey = buildRankingKey(params.target);
  const snapshotId = buildSnapshotId(params.date, rankingKey);
  const capturedAt = nowTimestamp();

  const snapshotItems = params.products.map((product, index) => ({
    productId: product.productId,
    sourceProductId: product.sourceProductId,
    rank: index + 1,
    title: product.title,
    sourceUrl: product.sourceUrl,
  }));

  const snapshot: RankingSnapshot = {
    snapshotId,
    platform: params.target.platform,
    audience: params.target.audience,
    category: params.target.category,
    rankingType: params.target.rankingType,
    rankingKey,
    date: params.date,
    sourceUrl: params.sourceUrl,
    capturedAt,
    fetchedAt: capturedAt,
    itemCount: params.products.length,
    items: snapshotItems,
    status: "success",
  };

  const snapshotRef = db.collection("rankingSnapshots").doc(snapshotId);
  const batch = db.batch();
  batch.set(snapshotRef, withoutUndefined({ ...snapshot, dateIso: params.dateIso }), { merge: true });

  params.products.forEach((product, index) => {
    const rank = index + 1;
    const item: RankingSnapshotItem = {
      snapshotId,
      platform: params.target.platform,
      audience: params.target.audience,
      category: params.target.category,
      rankingType: params.target.rankingType,
      rankingKey,
      rank,
      productId: product.productId,
      sourceProductId: product.sourceProductId,
      capturedAt,
    };

    const itemRef = snapshotRef.collection("items").doc(buildRankItemId(rank, product.productId));
    batch.set(itemRef, withoutUndefined(item), { merge: true });

    const productRef = db.collection("products").doc(product.productId);
    batch.set(
      productRef,
      withoutUndefined({
        latestRankings: [
          {
            rankingKey,
            type: params.target.rankingType,
            rank,
            capturedAt,
          },
        ],
        updatedAt: capturedAt,
      }),
      { merge: true },
    );
  });

  await batch.commit();
  return snapshotId;
}

export async function fetchDailyProducts(options: FetchDailyProductsOptions): Promise<BatchRun> {
  const runId = createRunId("daily_products");
  const startedAt = nowTimestamp();
  const startedAtMs = Date.now();
  const date = toYyyyMMdd();
  const dateIso = toIsoDateJst();
  const minIntervalMs = options.minIntervalMs ?? 1500;
  const maxProductIdsPerTarget = options.maxProductIdsPerTarget ?? 10;

  const runRef = db.collection("batchRuns").doc(runId);
  const primaryTarget = options.targets[0];
  const run: BatchRun = {
    runId,
    jobName: "fetchDailyProducts",
    source: primaryTarget?.platform ?? "unknown",
    target: primaryTarget ? `${primaryTarget.audience}/${primaryTarget.category}` : "unknown",
    platform: primaryTarget?.platform,
    audience: primaryTarget?.audience,
    category: primaryTarget?.category,
    status: "running",
    startedAt,
    fetchedProductCount: 0,
    updatedProductCount: 0,
    failedProductCount: 0,
    skippedProductCount: 0,
    fetchedCount: 0,
    savedCount: 0,
    skippedCount: 0,
    errorCount: 0,
    errors: [],
    rankingSnapshotIds: [],
    errorMessages: [],
    createdAt: startedAt,
  };

  await runRef.set(withoutUndefined(run));

  const errorMessages: string[] = [];
  const rankingSnapshotIds: string[] = [];
  let fetchedProductCount = 0;
  let updatedProductCount = 0;
  let failedProductCount = 0;
  let skippedProductCount = 0;
  let blocked = false;

  try {
    for (const target of options.targets) {
      const adapter = getAdapterForTarget(target);
      if (!adapter) {
        skippedProductCount += 1;
        errorMessages.push(`adapter not found: ${JSON.stringify(target)}`);
        continue;
      }

      logger.info("fetch target started", target);

      let ranking;
      try {
        ranking = await adapter.fetchRankingWorkIds(target);
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          blocked = true;
          errorMessages.push(`blocked: ${target.rankingType}: ${error.message}`);
          break;
        }

        failedProductCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        errorMessages.push(`ranking failed: ${target.rankingType}: ${message}`);
        continue;
      }

      const sourceProductIds = ranking.sourceProductIds.slice(0, maxProductIdsPerTarget);
      const products: Product[] = [];

      for (const sourceProductId of sourceProductIds) {
        try {
          // ガード設計:
          // - ログイン不要の公開ページ/APIのみ対象
          // - CAPTCHA回避はしない
          // - 429/403が返ったら即停止し、BlockedAccessErrorを投げる
          // - 取得間隔を空ける
          // - 画像はダウンロードせずURLのみ保存する
          // - 商品説明文は必要最低限にする
          // - 失敗したsourceProductIdはbatchRuns.errorMessagesに記録する
          if (minIntervalMs > 0) {
            await sleep(minIntervalMs);
          }

          const raw = await adapter.fetchProductDetail(sourceProductId);
          const product = adapter.normalizeProduct(raw, target);
          await saveProductAndMetric(product, date, dateIso);
          products.push(product);
          fetchedProductCount += 1;
          updatedProductCount += 1;
        } catch (error) {
          if (error instanceof BlockedAccessError) {
            blocked = true;
            errorMessages.push(`blocked: ${sourceProductId}: ${error.message}`);
            break;
          }

          failedProductCount += 1;
          const message = error instanceof Error ? error.message : String(error);
          errorMessages.push(`failed: ${sourceProductId}: ${message}`);
        }
      }

      if (products.length > 0) {
        const snapshotId = await saveRankingSnapshot({
          target,
          date,
          dateIso,
          sourceUrl: ranking.sourceUrl,
          products,
        });
        rankingSnapshotIds.push(snapshotId);
      }

      if (blocked) {
        break;
      }
    }

    const finishedAt = nowTimestamp();
    const status: BatchRun["status"] = blocked
      ? "blocked"
      : errorMessages.length > 0 && updatedProductCount > 0
        ? "partial"
        : errorMessages.length > 0
          ? "failed"
          : "success";
    const durationMs = Date.now() - startedAtMs;
    const result: BatchRun = {
      ...run,
      status,
      finishedAt,
      durationMs,
      fetchedProductCount,
      updatedProductCount,
      failedProductCount,
      skippedProductCount,
      fetchedCount: fetchedProductCount,
      savedCount: updatedProductCount,
      skippedCount: skippedProductCount,
      errorCount: errorMessages.length,
      errors: errorMessages.slice(0, 50),
      rankingSnapshotIds,
      errorMessages,
    };

    await runRef.set(withoutUndefined(result), { merge: true });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessages.push(message);

    const result: BatchRun = {
      ...run,
      status: "failed",
      finishedAt: nowTimestamp(),
      durationMs: Date.now() - startedAtMs,
      fetchedProductCount,
      updatedProductCount,
      failedProductCount,
      skippedProductCount,
      fetchedCount: fetchedProductCount,
      savedCount: updatedProductCount,
      skippedCount: skippedProductCount,
      errorCount: errorMessages.length,
      errors: errorMessages.slice(0, 50),
      rankingSnapshotIds,
      errorMessages,
    };

    await runRef.set(withoutUndefined(result), { merge: true });
    return result;
  }
}
