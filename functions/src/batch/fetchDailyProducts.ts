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
import { rebuildSiteStatsForTargets } from "./rebuildSiteStats";
import {
  buildRankItemId,
  buildRankingKey,
  buildSnapshotId,
  createRunId,
  nowTimestamp,
  sleep,
  toYyyyMMdd,
} from "../util";

export type FetchDailyProductsOptions = {
  targets: FetchTarget[];
  listLimit?: number;
  detailLimit?: number;
  minIntervalMs?: number;
};

function buildMetric(product: Product, date: string): ProductDailyMetric {
  return {
    date,
    platform: product.platform,
    audience: product.audience,
    category: product.category,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    isDiscounted: product.isDiscounted,
    isOnSale: product.isOnSale,
    salesCount: product.salesCount,
    wishlistCount: product.wishlistCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    reviewCount: product.reviewCount,
    ratingBreakdown: product.ratingBreakdown,
    workType: product.workType,
    workTypeLabel: product.workTypeLabel,
    contentTypes: product.contentTypes,
    contentTypeIds: product.contentTypeIds,
    fetchedAt: nowTimestamp(),
  };
}

async function saveProductAndMetric(product: Product, date: string): Promise<void> {
  const productRef = db.collection("products").doc(product.productId);
  await productRef.set(product, { merge: true });
  await productRef.collection("dailyMetrics").doc(date).set(buildMetric(product, date), { merge: true });
}

async function saveRankingSnapshot(params: {
  target: FetchTarget;
  date: string;
  sourceUrl?: string;
  products: Product[];
}): Promise<string> {
  const rankingKey = buildRankingKey(params.target);
  const snapshotId = buildSnapshotId(params.date, rankingKey);
  const capturedAt = nowTimestamp();

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
    status: "success",
  };

  const snapshotRef = db.collection("rankingSnapshots").doc(snapshotId);
  const batch = db.batch();
  batch.set(snapshotRef, snapshot, { merge: true });

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
    batch.set(itemRef, item, { merge: true });

    const productRef = db.collection("products").doc(product.productId);
    batch.set(
      productRef,
      {
        latestRankings: [
          {
            rankingKey,
            type: params.target.rankingType,
            rank,
            capturedAt,
          },
        ],
        updatedAt: capturedAt,
      },
      { merge: true },
    );
  });

  await batch.commit();
  return snapshotId;
}

export async function fetchDailyProducts(options: FetchDailyProductsOptions): Promise<BatchRun> {
  const runId = createRunId("daily_products");
  const startedAt = nowTimestamp();
  const date = toYyyyMMdd();
  const minIntervalMs = options.minIntervalMs ?? 500;
  const detailLimit = options.detailLimit;

  const runRef = db.collection("batchRuns").doc(runId);
  const run: BatchRun = {
    runId,
    jobName: "fetchDailyProducts",
    status: "running",
    startedAt,
    fetchedProductCount: 0,
    updatedProductCount: 0,
    failedProductCount: 0,
    skippedProductCount: 0,
    rankingSnapshotIds: [],
    errorMessages: [],
    createdAt: startedAt,
  };

  await runRef.set(run);

  const errorMessages: string[] = [];
  const rankingSnapshotIds: string[] = [];
  let siteStatsIds: string[] = [];
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

      logger.info("fetch target started", {
        target,
        listLimit: options.listLimit,
        detailLimit: options.detailLimit,
        minIntervalMs,
      });

      const ranking = await adapter.fetchRankingWorkIds(target, { listLimit: options.listLimit });
      const sourceProductIds = detailLimit && detailLimit > 0
        ? ranking.sourceProductIds.slice(0, detailLimit)
        : ranking.sourceProductIds;
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
          await saveProductAndMetric(product, date);
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
          sourceUrl: ranking.sourceUrl,
          products,
        });
        rankingSnapshotIds.push(snapshotId);
      }

      if (blocked) {
        break;
      }
    }

    try {
      siteStatsIds = await rebuildSiteStatsForTargets(options.targets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorMessages.push(`siteStats failed: ${message}`);
    }

    const finishedAt = nowTimestamp();
    const status: BatchRun["status"] = blocked
      ? "blocked"
      : failedProductCount > 0 || errorMessages.some((message) => message.startsWith("siteStats failed:"))
        ? "partial"
        : "success";
    const result: BatchRun = {
      ...run,
      status,
      finishedAt,
      fetchedProductCount,
      updatedProductCount,
      failedProductCount,
      skippedProductCount,
      rankingSnapshotIds,
      siteStatsIds,
      errorMessages,
    };

    await runRef.set(result, { merge: true });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errorMessages.push(message);

    const result: BatchRun = {
      ...run,
      status: "failed",
      finishedAt: nowTimestamp(),
      fetchedProductCount,
      updatedProductCount,
      failedProductCount,
      skippedProductCount,
      rankingSnapshotIds,
      siteStatsIds,
      errorMessages,
    };

    await runRef.set(result, { merge: true });
    return result;
  }
}
