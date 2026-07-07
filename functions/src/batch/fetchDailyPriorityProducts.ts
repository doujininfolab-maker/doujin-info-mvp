import { logger } from "firebase-functions";
import { db } from "../firebaseAdmin";
import {
  dlsiteFemaleDoujinAdapter,
  fetchDlsiteDailyPriorityProductSources,
  type DlsiteDailyPriorityProductSource,
} from "../adapters/dlsite/dlsiteFemaleDoujinAdapter";
import { BlockedAccessError, type ProductDetailTiming } from "../adapters/types";
import type {
  BatchRun,
  FetchTarget,
  Product,
  ProductContentType,
  ProductDailyMetric,
} from "../types";
import { createRunId, nowTimestamp, sleep, toYyyyMMdd } from "../util";
import { rebuildSiteStatsForTargets } from "./rebuildSiteStats";

const FIRESTORE_BATCH_WRITE_LIMIT = 400;
const DEFAULT_ORDER_LIMIT = 5000;
const DEFAULT_NEW_RELEASE_LIMIT = 5000;
const DEFAULT_DELAY_MS = 10;
const DEFAULT_COMMIT_PRODUCT_COUNT = 100;
const DEFAULT_EXISTING_PRODUCT_READ_COUNT = 500;
const DEFAULT_CONTENT_TYPE_SLEEP_MS = 120_000;
const DEFAULT_RETRY_SLEEP_MS = 90_000;
const DEFAULT_RETRY_COUNT = 1;

type TargetReason = "newRelease" | "popular" | "salesCount";

type DailyPriorityProductSourceWithPrefetch = DlsiteDailyPriorityProductSource & {
  prefetchedProduct?: Product;
};

type DailyPriorityTarget = DailyPriorityProductSourceWithPrefetch & {
  contentType: ProductContentType;
  reasons: TargetReason[];
};

type DailyPriorityPerformanceSummary = {
  existingProductReadTotalMs: number;
  existingProductReadCount: number;
  detailFetchTotalMs: number;
  detailHtmlFetchTotalMs: number;
  ajaxInfoFetchTotalMs: number;
  detailHtmlParseTotalMs: number;
  normalizeProductTotalMs: number;
  saveEnqueueTotalMs: number;
  commitTotalMs: number;
  delayTotalMs: number;
  avgMsPerFetchedProduct: number;
};

type DailyPriorityPerformanceAccumulator = Omit<
  DailyPriorityPerformanceSummary,
  "avgMsPerFetchedProduct"
>;

type DailyPriorityTargetProcessPerformance = {
  delayMs: number;
  detailFetchMs: number;
  detailHtmlFetchMs: number;
  ajaxInfoFetchMs: number;
  detailHtmlParseMs: number;
  normalizeProductMs: number;
  saveEnqueueMs: number;
};

function createPerformanceAccumulator(): DailyPriorityPerformanceAccumulator {
  return {
    existingProductReadTotalMs: 0,
    existingProductReadCount: 0,
    detailFetchTotalMs: 0,
    detailHtmlFetchTotalMs: 0,
    ajaxInfoFetchTotalMs: 0,
    detailHtmlParseTotalMs: 0,
    normalizeProductTotalMs: 0,
    saveEnqueueTotalMs: 0,
    commitTotalMs: 0,
    delayTotalMs: 0,
  };
}

function addTargetPerformance(
  accumulator: DailyPriorityPerformanceAccumulator,
  performance: DailyPriorityTargetProcessPerformance,
): void {
  accumulator.detailFetchTotalMs += performance.detailFetchMs;
  accumulator.detailHtmlFetchTotalMs += performance.detailHtmlFetchMs;
  accumulator.ajaxInfoFetchTotalMs += performance.ajaxInfoFetchMs;
  accumulator.detailHtmlParseTotalMs += performance.detailHtmlParseMs;
  accumulator.normalizeProductTotalMs += performance.normalizeProductMs;
  accumulator.saveEnqueueTotalMs += performance.saveEnqueueMs;
  accumulator.delayTotalMs += performance.delayMs;
}

function summarizePerformance(
  accumulator: DailyPriorityPerformanceAccumulator,
  fetchedProductCount: number,
): DailyPriorityPerformanceSummary {
  return {
    ...accumulator,
    avgMsPerFetchedProduct:
      fetchedProductCount > 0
        ? Math.round(accumulator.detailFetchTotalMs / fetchedProductCount)
        : 0,
  };
}

type DailyPriorityContentResult = {
  contentType: ProductContentType;
  newReleaseCount: number;
  popularCount: number;
  salesCountOrderCount: number;
  targetCount: number;
  duplicateRemovedCount: number;
  fetchedProductCount: number;
  failedProductCount: number;
  failedProductIds: string[];
  retrySuccessCount: number;
  retryFailedCount: number;
  writeCount: number;
  dailyMetricWriteCount: number;
  commitCount: number;
  performance: DailyPriorityPerformanceSummary;
  elapsedMs: number;
};

export type FetchDailyPriorityProductsOptions = {
  delayMs?: number;
  newReleaseLimit?: number;
  popularLimit?: number;
  salesCountLimit?: number;
  commitProductCount?: number;
  existingProductReadCount?: number;
  contentTypeSleepMs?: number;
  retrySleepMs?: number;
  retryCount?: number;
  dryRun?: boolean;
  parseMode?: "full" | "fast";
  rebuildStats?: boolean;
  statsTargets?: FetchTarget[];
  contentTypes?: ProductContentType[];
  batchDate?: string;
};

export type FetchDailyPriorityProductsResult = {
  run: BatchRun;
  options: Required<
    Omit<FetchDailyPriorityProductsOptions, "statsTargets" | "contentTypes">
  > & {
    statsTargets?: FetchTarget[];
    contentTypes: ProductContentType[];
  };
  batchDate: string;
  previousDate: string;
  contentResults: DailyPriorityContentResult[];
  siteStatsIds: string[];
};

function buildTarget(contentType: ProductContentType): FetchTarget {
  return {
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    rankingType: "popular",
    contentType,
  };
}

function buildProductIdForTarget(
  target: FetchTarget,
  sourceProductId: string,
): string {
  return `${target.platform}_${target.category}_${sourceProductId}`;
}

function parseYyyyMMddToUtcMs(value: string): number | undefined {
  if (!/^\d{8}$/.test(value)) return undefined;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const utcMs = Date.UTC(year, month - 1, day);
  const date = new Date(utcMs);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }
  return utcMs;
}

function formatYyyyMMddFromUtcMs(utcMs: number): string {
  const date = new Date(utcMs);
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0");
  const day = `${date.getUTCDate()}`.padStart(2, "0");
  return `${year}${month}${day}`;
}

function addDaysToYyyyMMdd(value: string, offsetDays: number): string {
  const utcMs = parseYyyyMMddToUtcMs(value);
  if (utcMs === undefined) return value;
  return formatYyyyMMddFromUtcMs(utcMs + offsetDays * 24 * 60 * 60 * 1000);
}

function daysBetweenYyyyMMdd(
  fromDate: string,
  toDate: string,
): number | undefined {
  const fromMs = parseYyyyMMddToUtcMs(fromDate);
  const toMs = parseYyyyMMddToUtcMs(toDate);
  if (fromMs === undefined || toMs === undefined) return undefined;
  return Math.round((toMs - fromMs) / (24 * 60 * 60 * 1000));
}

function dateLikeToYyyyMMdd(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  return `${match[1]}${match[2]}${match[3]}`;
}

function resolveMetricDate(params: {
  previousDate: string;
  releaseDate?: string;
}): string {
  const releaseDateKey = dateLikeToYyyyMMdd(params.releaseDate);
  if (!releaseDateKey) return params.previousDate;
  return releaseDateKey > params.previousDate
    ? releaseDateKey
    : params.previousDate;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildMetric(
  product: Product,
  date: string,
  patch?: Partial<ProductDailyMetric>,
): ProductDailyMetric {
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
    ...patch,
  };
}

function buildProductForSave(product: Product): Product {
  const productForSave = { ...product };
  if (!isFiniteNumber(productForSave.salesCount)) {
    delete productForSave.salesCount;
  }
  return productForSave;
}

function buildDailySalesPatch(params: {
  product: Product;
  metricDate: string;
  existingProduct?: Product;
  calculatedAt: FirebaseFirestore.Timestamp;
}): {
  metricPatch: Partial<ProductDailyMetric>;
  productPatch: Partial<Product>;
} {
  const currentSalesCount = params.product.salesCount;
  const productPatch: Partial<Product> = {};

  if (!isFiniteNumber(currentSalesCount)) {
    return {
      metricPatch: {
        dailySalesCount: null,
        dailySalesStatus: "sales_count_missing",
      },
      productPatch,
    };
  }

  const previousSnapshotDate =
    params.existingProduct?.lastDailySalesSnapshotDate;
  const previousSnapshotCount =
    params.existingProduct?.lastDailySalesSnapshotCount;

  productPatch.lastDailySalesSnapshotDate = params.metricDate;
  productPatch.lastDailySalesSnapshotCount = currentSalesCount;
  productPatch.lastDailySalesSnapshotFetchedAt = params.calculatedAt;

  if (!previousSnapshotDate || !isFiniteNumber(previousSnapshotCount)) {
    return {
      metricPatch: {
        dailySalesCount: null,
        dailySalesStatus: "no_previous_snapshot",
      },
      productPatch,
    };
  }

  productPatch.previousDailySalesSnapshotDate = previousSnapshotDate;
  productPatch.previousDailySalesSnapshotCount = previousSnapshotCount;

  if (previousSnapshotDate === params.metricDate) {
    return {
      metricPatch: {
        dailySalesCount: null,
        dailySalesStatus: "same_day_snapshot",
        dailySalesBaseDate: previousSnapshotDate,
        dailySalesNextDate: params.metricDate,
        dailySalesBaseCount: previousSnapshotCount,
        dailySalesNextCount: currentSalesCount,
        dailySalesRawDelta: currentSalesCount - previousSnapshotCount,
        dailySalesCalculatedAt: params.calculatedAt,
      },
      productPatch,
    };
  }

  const periodDays = daysBetweenYyyyMMdd(
    previousSnapshotDate,
    params.metricDate,
  );
  const rawDelta = currentSalesCount - previousSnapshotCount;
  const basePatch = {
    dailySalesBaseDate: previousSnapshotDate,
    dailySalesNextDate: params.metricDate,
    dailySalesBaseCount: previousSnapshotCount,
    dailySalesNextCount: currentSalesCount,
    dailySalesRawDelta: rawDelta,
    dailySalesPeriodDays: periodDays,
    dailySalesCalculatedAt: params.calculatedAt,
  };

  if (periodDays === undefined || periodDays <= 0) {
    return {
      metricPatch: {
        ...basePatch,
        dailySalesCount: null,
        dailySalesStatus: "invalid_snapshot_date",
      },
      productPatch,
    };
  }

  if (rawDelta < 0) {
    productPatch.lastDailySalesDeltaCalculatedDate = params.metricDate;
    return {
      metricPatch: {
        ...basePatch,
        dailySalesCount: null,
        dailySalesStatus: "negative_delta",
      },
      productPatch,
    };
  }

  if (periodDays !== 1) {
    productPatch.lastDailySalesDeltaCalculatedDate = params.metricDate;
    return {
      metricPatch: {
        ...basePatch,
        dailySalesCount: null,
        dailySalesStatus: "multi_day_gap",
        periodSalesCount: rawDelta,
      },
      productPatch,
    };
  }

  productPatch.lastDailySalesDeltaCalculatedDate = params.metricDate;
  return {
    metricPatch: {
      ...basePatch,
      dailySalesCount: rawDelta,
      dailySalesStatus: "calculated",
    },
    productPatch,
  };
}

class FirestoreWriteBuffer {
  private batch = db.batch();
  private pendingWriteCount = 0;

  commitCount = 0;
  writeOperationCount = 0;

  constructor(private readonly maxWritesPerCommit = FIRESTORE_BATCH_WRITE_LIMIT) {}

  async set(
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData>,
    options: FirebaseFirestore.SetOptions,
  ): Promise<void> {
    if (this.pendingWriteCount + 1 > this.maxWritesPerCommit) {
      await this.flush();
    }
    this.batch.set(ref, data, options);
    this.pendingWriteCount += 1;
    this.writeOperationCount += 1;
  }

  async flush(): Promise<void> {
    if (this.pendingWriteCount <= 0) return;
    await this.batch.commit();
    this.batch = db.batch();
    this.pendingWriteCount = 0;
    this.commitCount += 1;
  }
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function loadExistingProductsById(
  targets: DailyPriorityTarget[],
  target: FetchTarget,
): Promise<Map<string, Product>> {
  const productsById = new Map<string, Product>();
  const productIds = targets.map((product) =>
    buildProductIdForTarget(target, product.sourceProductId),
  );

  for (const chunk of chunkArray(productIds, FIRESTORE_BATCH_WRITE_LIMIT)) {
    const refs = chunk.map((productId) =>
      db.collection("products").doc(productId),
    );
    const snapshots = await db.getAll(...refs);
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const productId = chunk[index];
      if (productId) productsById.set(productId, snapshot.data() as Product);
    });
  }

  return productsById;
}

function mergeTargetsByProductId(
  contentType: ProductContentType,
  targetGroups: Array<{
    reason: TargetReason;
    products: DailyPriorityProductSourceWithPrefetch[];
  }>,
): DailyPriorityTarget[] {
  const map = new Map<string, DailyPriorityTarget>();
  for (const group of targetGroups) {
    for (const product of group.products) {
      const existing = map.get(product.sourceProductId);
      if (existing) {
        if (!existing.reasons.includes(group.reason)) {
          existing.reasons.push(group.reason);
        }
        existing.sourceUrl ??= product.sourceUrl;
        existing.releaseDate ??= product.releaseDate;
        existing.releaseDateKey ??= product.releaseDateKey;
        existing.prefetchedProduct ??= product.prefetchedProduct;
        continue;
      }
      map.set(product.sourceProductId, {
        ...product,
        contentType,
        reasons: [group.reason],
      });
    }
  }
  return [...map.values()];
}

async function saveProductAndMetric(params: {
  writeBuffer: FirestoreWriteBuffer;
  product: Product;
  metricDate: string;
  existingProduct?: Product;
}): Promise<{ writeCount: number; dailyMetricWriteCount: number }> {
  const productRef = db.collection("products").doc(params.product.productId);
  const delta = buildDailySalesPatch({
    product: params.product,
    metricDate: params.metricDate,
    existingProduct: params.existingProduct,
    calculatedAt: nowTimestamp(),
  });
  const productToSave = buildProductForSave({
    ...params.product,
    ...delta.productPatch,
  });

  await params.writeBuffer.set(productRef, productToSave, { merge: true });
  await params.writeBuffer.set(
    productRef.collection("dailyMetrics").doc(params.metricDate),
    buildMetric(params.product, params.metricDate, delta.metricPatch),
    { merge: true },
  );

  return { writeCount: 1, dailyMetricWriteCount: 1 };
}

async function fetchAndSaveTarget(params: {
  target: FetchTarget;
  dailyTarget: DailyPriorityTarget;
  writeBuffer: FirestoreWriteBuffer;
  existingProduct?: Product;
  previousDate: string;
  delayMs: number;
  dryRun: boolean;
  parseMode: "full" | "fast";
}): Promise<{
  product?: Product;
  writeCount: number;
  dailyMetricWriteCount: number;
  performance: DailyPriorityTargetProcessPerformance;
}> {
  const performance: DailyPriorityTargetProcessPerformance = {
    delayMs: 0,
    detailFetchMs: 0,
    detailHtmlFetchMs: 0,
    ajaxInfoFetchMs: 0,
    detailHtmlParseMs: 0,
    normalizeProductMs: 0,
    saveEnqueueMs: 0,
  };

  if (params.delayMs > 0) {
    const delayStartedAt = Date.now();
    await sleep(params.delayMs);
    performance.delayMs += Date.now() - delayStartedAt;
  }

  let product: Product;
  if (params.dailyTarget.prefetchedProduct) {
    product = params.dailyTarget.prefetchedProduct;
  } else {
    let detailTiming: ProductDetailTiming | undefined;
    const detailFetchStartedAt = Date.now();
    const raw = await dlsiteFemaleDoujinAdapter.fetchProductDetail(
      params.dailyTarget.sourceProductId,
      {
        sourceUrl: params.dailyTarget.sourceUrl,
        parseMode: params.parseMode,
        onTiming: (timing) => {
          detailTiming = timing;
        },
      },
    );
    performance.detailFetchMs += Date.now() - detailFetchStartedAt;
    performance.detailHtmlFetchMs += detailTiming?.fetchHtmlMs ?? 0;
    performance.ajaxInfoFetchMs += detailTiming?.parse?.ajaxInfoFetchMs ?? 0;
    performance.detailHtmlParseMs += Math.max(
      0,
      (detailTiming?.parseHtmlMs ?? 0) - performance.ajaxInfoFetchMs,
    );

    const normalizeStartedAt = Date.now();
    product = dlsiteFemaleDoujinAdapter.normalizeProduct(raw, params.target);
    performance.normalizeProductMs += Date.now() - normalizeStartedAt;
  }

  if (params.dryRun) {
    return { product, writeCount: 0, dailyMetricWriteCount: 0, performance };
  }

  const metricDate = resolveMetricDate({
    previousDate: params.previousDate,
    releaseDate: product.releaseDate,
  });
  const saveStartedAt = Date.now();
  const saveResult = await saveProductAndMetric({
    writeBuffer: params.writeBuffer,
    product,
    metricDate,
    existingProduct: params.existingProduct,
  });
  performance.saveEnqueueMs += Date.now() - saveStartedAt;

  return { product, ...saveResult, performance };
}


const DAILY_PRIORITY_LIST_PAGE_SIZE = 100;

type NewReleaseDiscoveryResult = {
  products: DailyPriorityProductSourceWithPrefetch[];
  fetchedPageCount: number;
  candidateCount: number;
  detailFetchedCount: number;
  missingReleaseDateCount: number;
  olderReleaseDateFound: boolean;
  detailFetchTotalMs: number;
};

async function discoverNewReleaseTargetsByDetailReleaseDate(params: {
  contentType: ProductContentType;
  batchDate: string;
  delayMs: number;
  limit: number;
  parseMode: "full" | "fast";
}): Promise<NewReleaseDiscoveryResult> {
  const target = buildTarget(params.contentType);
  const maxPages = Math.max(
    1,
    Math.ceil(Math.max(params.limit, DAILY_PRIORITY_LIST_PAGE_SIZE) / DAILY_PRIORITY_LIST_PAGE_SIZE),
  );
  const products: DailyPriorityProductSourceWithPrefetch[] = [];
  const seenProductIds = new Set<string>();
  let fetchedPageCount = 0;
  let candidateCount = 0;
  let detailFetchedCount = 0;
  let missingReleaseDateCount = 0;
  let olderReleaseDateFound = false;
  let detailFetchTotalMs = 0;

  for (
    let page = 1;
    page <= maxPages && products.length < params.limit && !olderReleaseDateFound;
    page += 1
  ) {
    const pageResult = await fetchDlsiteDailyPriorityProductSources({
      contentType: params.contentType,
      orderType: "release_d",
      limit: DAILY_PRIORITY_LIST_PAGE_SIZE,
      startPage: page,
      delayMs: params.delayMs,
    });
    fetchedPageCount += pageResult.fetchedPageCount;

    if (pageResult.products.length === 0) break;

    let pageNewCount = 0;
    let pageMissingReleaseDateCount = 0;
    let pageOlderReleaseDateFound = false;

    for (const source of pageResult.products) {
      if (seenProductIds.has(source.sourceProductId)) continue;
      seenProductIds.add(source.sourceProductId);
      candidateCount += 1;

      if (params.delayMs > 0) await sleep(params.delayMs);

      try {
        const detailStartedAt = Date.now();
        const raw = await dlsiteFemaleDoujinAdapter.fetchProductDetail(
          source.sourceProductId,
          {
            sourceUrl: source.sourceUrl,
            parseMode: params.parseMode,
          },
        );
        detailFetchTotalMs += Date.now() - detailStartedAt;
        detailFetchedCount += 1;

        const product = dlsiteFemaleDoujinAdapter.normalizeProduct(raw, target);
        const releaseDateKey = dateLikeToYyyyMMdd(product.releaseDate);

        if (!releaseDateKey) {
          missingReleaseDateCount += 1;
          pageMissingReleaseDateCount += 1;
          continue;
        }

        if (releaseDateKey < params.batchDate) {
          olderReleaseDateFound = true;
          pageOlderReleaseDateFound = true;
          continue;
        }

        if (releaseDateKey !== params.batchDate) continue;

        products.push({
          ...source,
          releaseDate: product.releaseDate,
          releaseDateKey,
          prefetchedProduct: product,
        });
        pageNewCount += 1;
      } catch (error) {
        logger.warn("DLsite daily priority new release detail probe failed; continue", {
          contentType: params.contentType,
          sourceProductId: source.sourceProductId,
          sourceUrl: source.sourceUrl,
          page,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (products.length >= params.limit) break;
    }

    logger.info("DLsite daily priority new release page probed by detail", {
      contentType: params.contentType,
      page,
      candidateCount: pageResult.products.length,
      pageNewCount,
      totalNewCount: products.length,
      pageMissingReleaseDateCount,
      missingReleaseDateCount,
      pageOlderReleaseDateFound,
      olderReleaseDateFound,
      targetReleaseDateKey: params.batchDate,
      detailFetchedCount,
      detailFetchTotalMs,
    });

    if (
      pageMissingReleaseDateCount >= pageResult.products.length &&
      pageResult.products.length > 0
    ) {
      logger.warn("DLsite daily priority new release discovery stopped because all detail release dates were missing", {
        contentType: params.contentType,
        page,
        pageMissingReleaseDateCount,
        candidateCount: pageResult.products.length,
      });
      break;
    }

    if (pageOlderReleaseDateFound) break;
    if (pageResult.products.length < DAILY_PRIORITY_LIST_PAGE_SIZE) break;
  }

  return {
    products,
    fetchedPageCount,
    candidateCount,
    detailFetchedCount,
    missingReleaseDateCount,
    olderReleaseDateFound,
    detailFetchTotalMs,
  };
}

async function discoverTargetsForContentType(params: {
  contentType: ProductContentType;
  batchDate: string;
  delayMs: number;
  newReleaseLimit: number;
  popularLimit: number;
  salesCountLimit: number;
  parseMode: "full" | "fast";
}): Promise<{
  newRelease: DailyPriorityProductSourceWithPrefetch[];
  popular: DlsiteDailyPriorityProductSource[];
  salesCountOrder: DlsiteDailyPriorityProductSource[];
  merged: DailyPriorityTarget[];
}> {
  const newReleaseResult = await discoverNewReleaseTargetsByDetailReleaseDate({
    contentType: params.contentType,
    batchDate: params.batchDate,
    delayMs: params.delayMs,
    limit: params.newReleaseLimit,
    parseMode: params.parseMode,
  });
  const popularResult = await fetchDlsiteDailyPriorityProductSources({
    contentType: params.contentType,
    orderType: "trend",
    limit: params.popularLimit,
    delayMs: params.delayMs,
  });
  const salesCountResult = await fetchDlsiteDailyPriorityProductSources({
    contentType: params.contentType,
    orderType: "dl_d",
    limit: params.salesCountLimit,
    delayMs: params.delayMs,
  });

  const merged = mergeTargetsByProductId(params.contentType, [
    { reason: "newRelease", products: newReleaseResult.products },
    { reason: "popular", products: popularResult.products },
    { reason: "salesCount", products: salesCountResult.products },
  ]);

  logger.info("DLsite daily priority targets discovered", {
    contentType: params.contentType,
    batchDate: params.batchDate,
    newReleaseCount: newReleaseResult.products.length,
    newReleaseCandidateCount: newReleaseResult.candidateCount,
    newReleaseDetailFetchedCount: newReleaseResult.detailFetchedCount,
    newReleaseMissingReleaseDateCount: newReleaseResult.missingReleaseDateCount,
    newReleaseOlderReleaseDateFound: newReleaseResult.olderReleaseDateFound,
    newReleaseDetailFetchTotalMs: newReleaseResult.detailFetchTotalMs,
    popularCount: popularResult.products.length,
    salesCountOrderCount: salesCountResult.products.length,
    mergedTargetCount: merged.length,
    duplicateRemovedCount:
      newReleaseResult.products.length +
      popularResult.products.length +
      salesCountResult.products.length -
      merged.length,
  });

  return {
    newRelease: newReleaseResult.products,
    popular: popularResult.products,
    salesCountOrder: salesCountResult.products,
    merged,
  };
}

async function processTargetsForContentType(params: {
  contentType: ProductContentType;
  targets: DailyPriorityTarget[];
  previousDate: string;
  delayMs: number;
  commitProductCount: number;
  existingProductReadCount: number;
  dryRun: boolean;
  parseMode: "full" | "fast";
}): Promise<{
  result: Omit<
    DailyPriorityContentResult,
    | "newReleaseCount"
    | "popularCount"
    | "salesCountOrderCount"
    | "targetCount"
    | "duplicateRemovedCount"
    | "retrySuccessCount"
    | "retryFailedCount"
    | "elapsedMs"
  >;
  failedTargets: DailyPriorityTarget[];
}> {
  const target = buildTarget(params.contentType);
  const failedTargets: DailyPriorityTarget[] = [];
  let fetchedProductCount = 0;
  let failedProductCount = 0;
  let writeCount = 0;
  let dailyMetricWriteCount = 0;
  const writeBuffer = new FirestoreWriteBuffer(FIRESTORE_BATCH_WRITE_LIMIT);
  const failedProductIds: string[] = [];
  const performance = createPerformanceAccumulator();
  const existingProductReadCount = Math.max(
    params.commitProductCount,
    params.existingProductReadCount,
  );

  let readChunkIndex = 0;
  for (const readChunk of chunkArray(params.targets, existingProductReadCount)) {
    readChunkIndex += 1;
    const existingReadStartedAt = Date.now();
    const existingProductsById = await loadExistingProductsById(readChunk, target);
    const existingProductReadMs = Date.now() - existingReadStartedAt;
    performance.existingProductReadTotalMs += existingProductReadMs;
    performance.existingProductReadCount += 1;

    logger.info("DLsite daily priority existing products loaded", {
      contentType: params.contentType,
      readChunkIndex,
      readChunkSize: readChunk.length,
      existingProductCount: existingProductsById.size,
      existingProductReadMs,
      existingProductReadCount,
    });

    let commitChunkIndex = 0;
    for (const commitChunk of chunkArray(readChunk, params.commitProductCount)) {
      commitChunkIndex += 1;
      const chunkStartedAt = Date.now();
      const chunkPerformance = createPerformanceAccumulator();
      let chunkFetchedProductCount = 0;
      let chunkFailedProductCount = 0;
      let chunkWriteCount = 0;
      let chunkDailyMetricWriteCount = 0;

      for (const dailyTarget of commitChunk) {
        try {
          const productId = buildProductIdForTarget(
            target,
            dailyTarget.sourceProductId,
          );
          const saveResult = await fetchAndSaveTarget({
            target,
            dailyTarget,
            writeBuffer,
            existingProduct: existingProductsById.get(productId),
            previousDate: params.previousDate,
            delayMs: params.delayMs,
            dryRun: params.dryRun,
            parseMode: params.parseMode,
          });
          fetchedProductCount += 1;
          chunkFetchedProductCount += 1;
          writeCount += saveResult.writeCount;
          dailyMetricWriteCount += saveResult.dailyMetricWriteCount;
          chunkWriteCount += saveResult.writeCount;
          chunkDailyMetricWriteCount += saveResult.dailyMetricWriteCount;
          addTargetPerformance(performance, saveResult.performance);
          addTargetPerformance(chunkPerformance, saveResult.performance);
        } catch (error) {
          if (error instanceof BlockedAccessError) throw error;
          failedProductCount += 1;
          chunkFailedProductCount += 1;
          failedProductIds.push(dailyTarget.sourceProductId);
          failedTargets.push(dailyTarget);
          logger.warn("DLsite daily priority product fetch failed; continue", {
            contentType: params.contentType,
            sourceProductId: dailyTarget.sourceProductId,
            sourceUrl: dailyTarget.sourceUrl,
            reasons: dailyTarget.reasons,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const commitCountBefore = writeBuffer.commitCount;
      const commitStartedAt = Date.now();
      await writeBuffer.flush();
      const commitMs =
        writeBuffer.commitCount > commitCountBefore
          ? Date.now() - commitStartedAt
          : 0;
      performance.commitTotalMs += commitMs;
      chunkPerformance.commitTotalMs += commitMs;

      const chunkElapsedMs = Date.now() - chunkStartedAt;
      logger.info("DLsite daily priority product chunk committed", {
        contentType: params.contentType,
        readChunkIndex,
        commitChunkIndex,
        chunkSize: commitChunk.length,
        chunkElapsedMs,
        chunkFetchedProductCount,
        chunkFailedProductCount,
        chunkWriteCount,
        chunkDailyMetricWriteCount,
        fetchedProductCount,
        failedProductCount,
        writeCount,
        dailyMetricWriteCount,
        commitCount: writeBuffer.commitCount,
        performance: summarizePerformance(
          chunkPerformance,
          chunkFetchedProductCount,
        ),
      });
    }
  }

  return {
    result: {
      contentType: params.contentType,
      fetchedProductCount,
      failedProductCount,
      failedProductIds,
      writeCount,
      dailyMetricWriteCount,
      commitCount: writeBuffer.commitCount,
      performance: summarizePerformance(performance, fetchedProductCount),
    },
    failedTargets,
  };
}

async function retryFailedTargets(params: {
  failedTargets: DailyPriorityTarget[];
  previousDate: string;
  delayMs: number;
  retrySleepMs: number;
  retryCount: number;
  existingProductReadCount: number;
  dryRun: boolean;
  parseMode: "full" | "fast";
}): Promise<{ retrySuccessCount: number; retryFailedCount: number; failedProductIds: string[] }> {
  let retrySuccessCount = 0;
  let retryFailedCount = 0;
  let remainingTargets = params.failedTargets;
  const failedProductIds: string[] = [];

  for (let attempt = 1; attempt <= params.retryCount && remainingTargets.length > 0; attempt += 1) {
    await sleep(params.retrySleepMs);
    const nextRemaining: DailyPriorityTarget[] = [];
    const byContentType = new Map<ProductContentType, DailyPriorityTarget[]>();
    for (const target of remainingTargets) {
      const values = byContentType.get(target.contentType) ?? [];
      values.push(target);
      byContentType.set(target.contentType, values);
    }

    for (const [contentType, targets] of byContentType) {
      const processResult = await processTargetsForContentType({
        contentType,
        targets,
        previousDate: params.previousDate,
        delayMs: params.delayMs,
        commitProductCount: DEFAULT_COMMIT_PRODUCT_COUNT,
        existingProductReadCount: params.existingProductReadCount,
        dryRun: params.dryRun,
        parseMode: params.parseMode,
      });
      retrySuccessCount += processResult.result.fetchedProductCount;
      nextRemaining.push(...processResult.failedTargets);
    }

    remainingTargets = nextRemaining;
  }

  retryFailedCount = remainingTargets.length;
  failedProductIds.push(...remainingTargets.map((target) => target.sourceProductId));
  return { retrySuccessCount, retryFailedCount, failedProductIds };
}

function resolveOptions(
  options: FetchDailyPriorityProductsOptions,
): Required<Omit<FetchDailyPriorityProductsOptions, "statsTargets" | "contentTypes">> & {
  statsTargets?: FetchTarget[];
  contentTypes: ProductContentType[];
} {
  return {
    delayMs: Math.max(0, Math.floor(options.delayMs ?? DEFAULT_DELAY_MS)),
    newReleaseLimit: Math.max(1, Math.floor(options.newReleaseLimit ?? DEFAULT_NEW_RELEASE_LIMIT)),
    popularLimit: Math.max(1, Math.floor(options.popularLimit ?? DEFAULT_ORDER_LIMIT)),
    salesCountLimit: Math.max(1, Math.floor(options.salesCountLimit ?? DEFAULT_ORDER_LIMIT)),
    commitProductCount: Math.max(1, Math.floor(options.commitProductCount ?? DEFAULT_COMMIT_PRODUCT_COUNT)),
    existingProductReadCount: Math.max(1, Math.floor(options.existingProductReadCount ?? DEFAULT_EXISTING_PRODUCT_READ_COUNT)),
    contentTypeSleepMs: Math.max(0, Math.floor(options.contentTypeSleepMs ?? DEFAULT_CONTENT_TYPE_SLEEP_MS)),
    retrySleepMs: Math.max(0, Math.floor(options.retrySleepMs ?? DEFAULT_RETRY_SLEEP_MS)),
    retryCount: Math.max(0, Math.floor(options.retryCount ?? DEFAULT_RETRY_COUNT)),
    dryRun: options.dryRun === true,
    parseMode: options.parseMode ?? "fast",
    rebuildStats: options.rebuildStats !== false,
    statsTargets: options.statsTargets,
    contentTypes: options.contentTypes?.length ? options.contentTypes : ["tl", "bl"],
    batchDate: options.batchDate ?? toYyyyMMdd(),
  };
}

export async function fetchDailyPriorityProducts(
  options: FetchDailyPriorityProductsOptions,
): Promise<FetchDailyPriorityProductsResult> {
  const resolved = resolveOptions(options);
  const batchDate = resolved.batchDate;
  const previousDate = addDaysToYyyyMMdd(batchDate, -1);
  const runId = createRunId("dlsite_daily_priority_products");
  const startedAt = nowTimestamp();
  const runRef = db.collection("batchRuns").doc(runId);
  const baseRun: BatchRun = {
    runId,
    jobName: "fetchDailyPriorityProducts",
    platform: "dlsite",
    audience: "female",
    category: "doujin",
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
  await runRef.set({ ...baseRun, options: resolved, batchDate, previousDate });

  const contentResults: DailyPriorityContentResult[] = [];
  const allFailedTargets: DailyPriorityTarget[] = [];
  let totalFetchedProductCount = 0;
  let totalFailedProductCount = 0;
  const errorMessages: string[] = [];

  try {
    for (const [index, contentType] of resolved.contentTypes.entries()) {
      if (index > 0 && resolved.contentTypeSleepMs > 0) {
        logger.info("DLsite daily priority sleep before next contentType", {
          previousContentType: resolved.contentTypes[index - 1],
          contentType,
          sleepMs: resolved.contentTypeSleepMs,
        });
        await sleep(resolved.contentTypeSleepMs);
      }

      const contentStartedAt = Date.now();
      const discovered = await discoverTargetsForContentType({
        contentType,
        batchDate,
        delayMs: resolved.delayMs,
        newReleaseLimit: resolved.newReleaseLimit,
        popularLimit: resolved.popularLimit,
        salesCountLimit: resolved.salesCountLimit,
        parseMode: resolved.parseMode,
      });
      const duplicateRemovedCount =
        discovered.newRelease.length +
        discovered.popular.length +
        discovered.salesCountOrder.length -
        discovered.merged.length;

      const processResult = await processTargetsForContentType({
        contentType,
        targets: discovered.merged,
        previousDate,
        delayMs: resolved.delayMs,
        commitProductCount: resolved.commitProductCount,
        existingProductReadCount: resolved.existingProductReadCount,
        dryRun: resolved.dryRun,
        parseMode: resolved.parseMode,
      });

      allFailedTargets.push(...processResult.failedTargets);
      const contentResult: DailyPriorityContentResult = {
        contentType,
        newReleaseCount: discovered.newRelease.length,
        popularCount: discovered.popular.length,
        salesCountOrderCount: discovered.salesCountOrder.length,
        targetCount: discovered.merged.length,
        duplicateRemovedCount,
        fetchedProductCount: processResult.result.fetchedProductCount,
        failedProductCount: processResult.result.failedProductCount,
        failedProductIds: processResult.result.failedProductIds,
        retrySuccessCount: 0,
        retryFailedCount: 0,
        writeCount: processResult.result.writeCount,
        dailyMetricWriteCount: processResult.result.dailyMetricWriteCount,
        commitCount: processResult.result.commitCount,
        performance: processResult.result.performance,
        elapsedMs: Date.now() - contentStartedAt,
      };
      contentResults.push(contentResult);
      totalFetchedProductCount += contentResult.fetchedProductCount;
      totalFailedProductCount += contentResult.failedProductCount;

      logger.info("DLsite daily priority contentType finished", contentResult);
    }

    if (allFailedTargets.length > 0 && resolved.retryCount > 0) {
      const retryResult = await retryFailedTargets({
        failedTargets: allFailedTargets,
        previousDate,
        delayMs: resolved.delayMs,
        retrySleepMs: resolved.retrySleepMs,
        retryCount: resolved.retryCount,
        existingProductReadCount: resolved.existingProductReadCount,
        dryRun: resolved.dryRun,
        parseMode: resolved.parseMode,
      });
      totalFetchedProductCount += retryResult.retrySuccessCount;
      totalFailedProductCount = retryResult.retryFailedCount;
      errorMessages.push(
        ...retryResult.failedProductIds.map((id) => `retry failed: ${id}`),
      );

      for (const contentResult of contentResults) {
        const failedSet = new Set(contentResult.failedProductIds);
        contentResult.retrySuccessCount = allFailedTargets.filter(
          (target) =>
            target.contentType === contentResult.contentType &&
            failedSet.has(target.sourceProductId) &&
            !retryResult.failedProductIds.includes(target.sourceProductId),
        ).length;
        contentResult.retryFailedCount = retryResult.failedProductIds.filter(
          (sourceProductId) => failedSet.has(sourceProductId),
        ).length;
      }
    }

    const siteStatsIds =
      resolved.rebuildStats && resolved.statsTargets
        ? await rebuildSiteStatsForTargets(resolved.statsTargets)
        : [];

    const status: BatchRun["status"] =
      totalFailedProductCount > 0 ? "partial" : "success";
    const finishedRun: BatchRun = {
      ...baseRun,
      status,
      finishedAt: nowTimestamp(),
      fetchedProductCount: totalFetchedProductCount,
      updatedProductCount: totalFetchedProductCount,
      failedProductCount: totalFailedProductCount,
      siteStatsIds,
      errorMessages,
    };
    await runRef.set(
      {
        ...finishedRun,
        contentResults,
        options: resolved,
        batchDate,
        previousDate,
      },
      { merge: true },
    );

    logger.info("DLsite daily priority batch finished", {
      runId,
      status,
      batchDate,
      previousDate,
      fetchedProductCount: totalFetchedProductCount,
      failedProductCount: totalFailedProductCount,
      siteStatsIds,
      contentResults,
    });

    return {
      run: finishedRun,
      options: resolved,
      batchDate,
      previousDate,
      contentResults,
      siteStatsIds,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: BatchRun["status"] =
      error instanceof BlockedAccessError ? "blocked" : "failed";
    errorMessages.push(message);
    const failedRun: BatchRun = {
      ...baseRun,
      status,
      finishedAt: nowTimestamp(),
      fetchedProductCount: totalFetchedProductCount,
      updatedProductCount: totalFetchedProductCount,
      failedProductCount: totalFailedProductCount,
      errorMessages,
    };
    await runRef.set(
      {
        ...failedRun,
        contentResults,
        options: resolved,
        batchDate,
        previousDate,
      },
      { merge: true },
    );
    logger.error("DLsite daily priority batch failed", {
      runId,
      status,
      batchDate,
      previousDate,
      message,
    });
    throw error;
  }
}
