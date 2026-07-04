import { logger } from "firebase-functions";
import { db } from "../firebaseAdmin";
import type {
  BatchRun,
  FetchTarget,
  Product,
  ProductDailyMetric,
  RankingSnapshot,
  RankingSnapshotItem,
  RankingSummary,
} from "../types";
import type { DiscoveredProductSource } from "../adapters/types";
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
  /**
   * 重複排除後に詳細取得する最大件数。0の場合は一覧取得だけ行う。
   */
  detailLimit?: number;
  minIntervalMs?: number;
  /**
   * trueの場合、一覧URLの取得・重複排除だけ行い、商品詳細ページにはアクセスしない。
   */
  listOnly?: boolean;
  /**
   * 指定時間以内に取得済みの商品は詳細再取得しない。ランキング情報だけ更新する。
   */
  skipFreshHours?: number;
};

type TargetRankingState = {
  target: FetchTarget;
  sourceUrl?: string;
  products: DiscoveredProductSource[];
};

type DiscoveredAppearance = {
  target: FetchTarget;
  rank: number;
  sourceUrl?: string;
  listUrl?: string;
};

type DiscoveredProduct = {
  sourceProductId: string;
  sourceUrl?: string;
  primaryTarget: FetchTarget;
  appearances: DiscoveredAppearance[];
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
  latestRankingsByProduct?: Map<string, RankingSummary[]>;
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

    const rankingSummary: RankingSummary = {
      rankingKey,
      type: params.target.rankingType,
      rank,
      capturedAt,
    };
    const currentSummaries = params.latestRankingsByProduct?.get(product.productId) ?? [];
    const latestRankings = [
      rankingSummary,
      ...currentSummaries.filter((summary) => summary.rankingKey !== rankingKey),
    ].slice(0, 20);
    params.latestRankingsByProduct?.set(product.productId, latestRankings);

    const productRef = db.collection("products").doc(product.productId);
    batch.set(
      productRef,
      {
        latestRankings,
        updatedAt: capturedAt,
      },
      { merge: true },
    );
  });

  await batch.commit();
  return snapshotId;
}

function buildProductIdForTarget(target: FetchTarget, sourceProductId: string): string {
  return `${target.platform}_${target.category}_${sourceProductId}`;
}

function isFreshProduct(product: Product | undefined, skipFreshHours: number | undefined): boolean {
  if (!product || skipFreshHours === undefined || skipFreshHours <= 0) return false;

  const timestamp = product.lastFetchedAt ?? product.fetchedAt ?? product.updatedAt;
  const fetchedAtMs = timestamp?.toMillis?.();
  if (!fetchedAtMs) return false;

  const freshUntilMs = fetchedAtMs + skipFreshHours * 60 * 60 * 1000;
  return freshUntilMs > Date.now();
}

async function loadExistingProduct(target: FetchTarget, sourceProductId: string): Promise<Product | undefined> {
  const productId = buildProductIdForTarget(target, sourceProductId);
  const snapshot = await db.collection("products").doc(productId).get();
  if (!snapshot.exists) return undefined;
  return snapshot.data() as Product;
}

function normalizeDiscoveredSources(ranking: { sourceProductIds: string[]; products?: DiscoveredProductSource[] }): DiscoveredProductSource[] {
  if (ranking.products && ranking.products.length > 0) return ranking.products;
  return ranking.sourceProductIds.map((sourceProductId, index) => ({
    sourceProductId,
    rank: index + 1,
  }));
}

function addDiscoveredProduct(params: {
  map: Map<string, DiscoveredProduct>;
  target: FetchTarget;
  product: DiscoveredProductSource;
}): void {
  const { map, target, product } = params;
  const existing = map.get(product.sourceProductId);
  const appearance: DiscoveredAppearance = {
    target,
    rank: product.rank ?? (existing?.appearances.length ?? 0) + 1,
    sourceUrl: product.sourceUrl,
    listUrl: product.listUrl,
  };

  if (existing) {
    existing.appearances.push(appearance);
    existing.sourceUrl ??= product.sourceUrl;
    return;
  }

  map.set(product.sourceProductId, {
    sourceProductId: product.sourceProductId,
    sourceUrl: product.sourceUrl,
    primaryTarget: target,
    appearances: [appearance],
  });
}

export async function fetchDailyProducts(options: FetchDailyProductsOptions): Promise<BatchRun> {
  const runId = createRunId("daily_products");
  const startedAt = nowTimestamp();
  const date = toYyyyMMdd();
  const minIntervalMs = options.minIntervalMs ?? 500;
  const detailLimit = options.detailLimit;
  const listOnly = options.listOnly === true || detailLimit === 0;

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
  const latestRankingsByProduct = new Map<string, RankingSummary[]>();
  const targetRankings: TargetRankingState[] = [];
  const discoveredBySourceProductId = new Map<string, DiscoveredProduct>();
  const productBySourceProductId = new Map<string, Product>();
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

      try {
        logger.info("fetch target list started", {
          target,
          listLimit: options.listLimit,
          detailLimit: options.detailLimit,
          minIntervalMs,
          listOnly,
          skipFreshHours: options.skipFreshHours,
        });

        const ranking = await adapter.fetchRankingWorkIds(target, { listLimit: options.listLimit });
        const products = normalizeDiscoveredSources(ranking);
        targetRankings.push({
          target,
          sourceUrl: ranking.sourceUrl,
          products,
        });

        for (const product of products) {
          addDiscoveredProduct({ map: discoveredBySourceProductId, target, product });
        }

        logger.info("fetch target list finished", {
          target,
          sourceUrl: ranking.sourceUrl,
          listedCount: products.length,
          uniqueDiscoveredCount: discoveredBySourceProductId.size,
        });
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          blocked = true;
          const message = `blocked while listing ${JSON.stringify(target)}: ${error.message}`;
          errorMessages.push(message);
          logger.error("fetch target list blocked; stop current batch", { target, message: error.message });
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        errorMessages.push(`list failed: ${JSON.stringify(target)}: ${message}`);
        logger.warn("fetch target list failed; continue next target", { target, message });
      }
    }

    const discoveredProducts = Array.from(discoveredBySourceProductId.values());
    logger.info("fetch list phase finished", {
      targetCount: targetRankings.length,
      uniqueDiscoveredCount: discoveredProducts.length,
      listOnly,
      detailLimit,
    });

    const detailTargets = listOnly
      ? []
      : typeof detailLimit === "number"
        ? discoveredProducts.slice(0, Math.max(0, detailLimit))
        : discoveredProducts;

    if (listOnly) {
      skippedProductCount += discoveredProducts.length;
      logger.info("detail fetch skipped by listOnly", {
        uniqueDiscoveredCount: discoveredProducts.length,
      });
    }

    for (const [index, discovered] of detailTargets.entries()) {
      const progress = `${index + 1}/${detailTargets.length}`;
      const adapter = getAdapterForTarget(discovered.primaryTarget);
      if (!adapter) {
        skippedProductCount += 1;
        errorMessages.push(`adapter not found for discovered product: ${discovered.sourceProductId}`);
        continue;
      }

      try {
        const existingProduct = await loadExistingProduct(discovered.primaryTarget, discovered.sourceProductId);
        if (isFreshProduct(existingProduct, options.skipFreshHours)) {
          productBySourceProductId.set(discovered.sourceProductId, existingProduct as Product);
          skippedProductCount += 1;
          logger.info("detail fetch skipped because product is fresh", {
            sourceProductId: discovered.sourceProductId,
            productId: existingProduct?.productId,
            progress,
            skipFreshHours: options.skipFreshHours,
          });
          continue;
        }

        if (minIntervalMs > 0) {
          await sleep(minIntervalMs);
        }

        logger.info("detail fetch started", {
          sourceProductId: discovered.sourceProductId,
          sourceUrl: discovered.sourceUrl,
          primaryTarget: discovered.primaryTarget,
          appearanceCount: discovered.appearances.length,
          progress,
        });

        const raw = await adapter.fetchProductDetail(discovered.sourceProductId, { sourceUrl: discovered.sourceUrl });
        const product = adapter.normalizeProduct(raw, discovered.primaryTarget);
        await saveProductAndMetric(product, date);
        productBySourceProductId.set(discovered.sourceProductId, product);
        fetchedProductCount += 1;
        updatedProductCount += 1;

        logger.info("detail fetch succeeded", {
          sourceProductId: discovered.sourceProductId,
          productId: product.productId,
          progress,
        });
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          blocked = true;
          errorMessages.push(`blocked: ${discovered.sourceProductId}: ${error.message}`);
          logger.error("detail fetch blocked; stop current batch", {
            sourceProductId: discovered.sourceProductId,
            progress,
            message: error.message,
          });
          break;
        }

        failedProductCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        errorMessages.push(`failed: ${discovered.sourceProductId}: ${message}`);
        logger.warn("detail fetch failed; continue next product", {
          sourceProductId: discovered.sourceProductId,
          sourceUrl: discovered.sourceUrl,
          progress,
          message,
        });
      }
    }

    if (!listOnly) {
      for (const ranking of targetRankings) {
        const products = ranking.products
          .map((product) => productBySourceProductId.get(product.sourceProductId))
          .filter((product): product is Product => Boolean(product));

        if (products.length === 0) continue;

        const snapshotId = await saveRankingSnapshot({
          target: ranking.target,
          date,
          sourceUrl: ranking.sourceUrl,
          products,
          latestRankingsByProduct,
        });
        rankingSnapshotIds.push(snapshotId);
      }
    }

    if (!listOnly) {
      try {
        siteStatsIds = await rebuildSiteStatsForTargets(options.targets);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errorMessages.push(`siteStats failed: ${message}`);
      }
    }

    const finishedAt = nowTimestamp();
    const status: BatchRun["status"] = blocked
      ? "blocked"
      : failedProductCount > 0 || errorMessages.some((message) => message.startsWith("siteStats failed:") || message.startsWith("list failed:"))
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
