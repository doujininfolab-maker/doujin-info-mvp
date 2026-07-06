import { logger } from "firebase-functions";
import { db } from "../firebaseAdmin";
import {
  dlsiteFemaleDoujinAdapter,
  fetchDlsiteGirlsReleaseOldListMeta,
  fetchDlsiteGirlsReleaseOldProductSourcesForPageRange,
} from "../adapters/dlsite/dlsiteFemaleDoujinAdapter";
import { BlockedAccessError } from "../adapters/types";
import type {
  BatchRun,
  FetchTarget,
  Product,
  ProductContentType,
  ProductDailyMetric,
} from "../types";
import type {
  DiscoveredProductSource,
  ProductDetailParseTiming,
  ProductDetailTiming,
  ProductParseMode,
} from "../adapters/types";
import { createRunId, nowTimestamp, sleep, toYyyyMMdd } from "../util";

const DISCOVERY_COLLECTION = "productDiscoveries";
const FIRESTORE_BATCH_LIMIT = 400;
const DEFAULT_PROGRESS_LOG_EVERY = 100;
const DEFAULT_PAGE_CHUNK_SIZE = 5;
const MAX_PAGE_CHUNK_SIZE = 50;

function resolveFetchContentType(
  contentType: ProductContentType | undefined,
): ProductContentType {
  return contentType === "bl" ? "bl" : "tl";
}

function buildReleaseTarget(contentType: ProductContentType): FetchTarget {
  return {
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    rankingType: "new",
    contentType,
  };
}

function buildJobName(contentType: ProductContentType): string {
  return contentType === "bl"
    ? "fetchBlReleaseNewProducts"
    : "fetchGirlsReleaseNewProducts";
}

function buildRunIdPrefix(contentType: ProductContentType): string {
  return contentType === "bl"
    ? "bl_release_new_products"
    : "girls_release_new_products";
}

function buildLogLabel(contentType: ProductContentType): string {
  return contentType === "bl" ? "bl release-new" : "girls release-new";
}

function buildDiscoveredBy(contentType: ProductContentType): string {
  return contentType === "bl"
    ? "bl_release_new_scan"
    : "girls_release_new_scan";
}

export type FetchGirlsReleaseOldProductsOptions = {
  maxPages?: number;
  startPage?: number;
  delayMs?: number;
  dryRun?: boolean;
  detailLimit?: number;
  skipFreshHours?: number;
  saveDiscovery?: boolean;
  saveDailyMetrics?: boolean;
  saveDailySalesDelta?: boolean;
  progressLogEvery?: number;
  parseMode?: ProductParseMode;
  htmlOnlyProbe?: boolean;
  contentType?: ProductContentType;
  pageChunkSize?: number;
};

type PerformanceStats = {
  startedAtMs: number;
  listScanTotalMs: number;
  listChunkCount: number;
  listChunkTotalMs: number;
  listPageFetchTotalMs: number;
  productIdExtractTotalMs: number;
  discoverySaveTotalMs: number;
  detailHtmlFetchTotalMs: number;
  detailHtmlParseTotalMs: number;
  detailHtmlParseIncludingAjaxTotalMs: number;
  detailHtmlFetchSamplesMs: number[];
  ajaxInfoFetchSamplesMs: number[];
  detailHtmlRequestCount: number;
  detailHtmlRetryCount: number;
  detailHtmlRetryBackoffMs: number;
  detailHtmlCandidateUrlCount: number;
  detailHtmlCandidateFetchFailedCount: number;
  detailHtmlStatusCounts: Record<string, number>;
  ajaxRequestCount: number;
  ajaxSuccessCount: number;
  ajaxNonOkCount: number;
  ajaxErrorCount: number;
  ajaxSecondUrlTriedCount: number;
  ajaxFirstUrlSucceededCount: number;
  ajaxStatusCounts: Record<string, number>;
  cheerioLoadTotalMs: number;
  parseBasicInfoTotalMs: number;
  parsePriceTotalMs: number;
  parseSalesTotalMs: number;
  parseRatingTotalMs: number;
  parseReleaseDateTotalMs: number;
  parseGenresTotalMs: number;
  parseImagesTotalMs: number;
  parseDescriptionTotalMs: number;
  normalizeProductTotalMs: number;
  ajaxInfoFetchTotalMs: number;
  htmlOnlyProbeTotalMs: number;
  htmlOnlyProbeExecutedCount: number;
  htmlPriceFoundCount: number;
  htmlOfficialPriceFoundCount: number;
  htmlDiscountRateFoundCount: number;
  htmlSalesCountFoundCount: number;
  htmlSalesCountMissingCount: number;
  htmlRatingFoundCount: number;
  htmlRatingCountFoundCount: number;
  htmlReleaseDateFoundCount: number;
  htmlSalesCountAjaxComparedCount: number;
  htmlSalesCountAjaxMatchCount: number;
  htmlSalesCountAjaxMismatchCount: number;
  htmlSalesCountAjaxHtmlMissingCount: number;
  htmlSalesCountAjaxAjaxMissingCount: number;
  htmlSalesCountAjaxBothMissingCount: number;
  htmlSalesCountAjaxMismatchExamples: Array<{
    sourceProductId: string;
    sourceUrl?: string;
    htmlSalesCount?: number;
    ajaxSalesCount?: number;
  }>;
  ajaxRequiredCount: number;
  ajaxSkippedCandidateCount: number;
  otherParseTotalMs: number;
  productExistingReadTotalMs: number;
  dailySalesExistingProductReadTotalMs: number;
  dailySalesDeltaCalcTotalMs: number;
  productAndMetricSaveTotalMs: number;
  firestoreBatchCommitTotalMs: number;
  firestoreBatchCommitCount: number;
  firestoreAutoFlushTotalMs: number;
  firestoreAutoFlushCount: number;
  firestoreChunkFlushTotalMs: number;
  firestoreChunkFlushCount: number;
  firestoreWriteOperationCount: number;
  firestorePendingWriteCount: number;
  batchRunsUpdateTotalMs: number;
  delayTotalMs: number;
  productExistingReadCount: number;
  dailySalesExistingProductReadCount: number;
  dailySalesPreviousMetricWriteCount: number;
  dailySalesDeltaCalculatedCount: number;
  dailySalesDeltaNoPreviousCount: number;
  dailySalesDeltaNegativeCount: number;
  dailySalesDeltaMultiDayGapCount: number;
  dailySalesDeltaSkippedCount: number;
  dailySalesDeltaSameDaySnapshotCount: number;
  dailySalesDeltaSalesCountMissingCount: number;
  discoveryReadCount: number;
  discoveryWriteCount: number;
  productWriteCount: number;
  dailyMetricWriteCount: number;
  batchRunWriteCount: number;
};

type LatencySummary = {
  count: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
};

type MemoryUsageSummary = {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
};

type PerformanceWindowSnapshot = {
  elapsedMs: number;
  detailHtmlFetchSamplesLength: number;
  ajaxInfoFetchSamplesLength: number;
  detailHtmlRequestCount: number;
  detailHtmlRetryCount: number;
  ajaxRequestCount: number;
  ajaxSuccessCount: number;
  ajaxNonOkCount: number;
  ajaxErrorCount: number;
  processedDetailCount: number;
};

type PerformanceWindowSummary = {
  elapsedMs: number;
  processedDetailCount: number;
  avgMsPerProcessedDetail: number;
  detailHtmlFetch: LatencySummary;
  ajaxInfoFetch: LatencySummary;
  detailHtmlRequestCount: number;
  detailHtmlRetryCount: number;
  ajaxRequestCount: number;
  ajaxSuccessCount: number;
  ajaxNonOkCount: number;
  ajaxErrorCount: number;
};

type PerformanceSummary = {
  totalElapsedMs: number;
  listScanTotalMs: number;
  listChunkCount: number;
  listChunkTotalMs: number;
  listPageFetchTotalMs: number;
  productIdExtractTotalMs: number;
  discoverySaveTotalMs: number;
  detailHtmlFetchTotalMs: number;
  detailHtmlParseTotalMs: number;
  detailHtmlParseIncludingAjaxTotalMs: number;
  cheerioLoadTotalMs: number;
  parseBasicInfoTotalMs: number;
  parsePriceTotalMs: number;
  parseSalesTotalMs: number;
  parseRatingTotalMs: number;
  parseReleaseDateTotalMs: number;
  parseGenresTotalMs: number;
  parseImagesTotalMs: number;
  parseDescriptionTotalMs: number;
  normalizeProductTotalMs: number;
  ajaxInfoFetchTotalMs: number;
  http: {
    detailHtmlFetch: LatencySummary;
    ajaxInfoFetch: LatencySummary;
    detailHtmlRequestCount: number;
    detailHtmlRetryCount: number;
    detailHtmlRetryBackoffMs: number;
    detailHtmlCandidateUrlCount: number;
    detailHtmlCandidateFetchFailedCount: number;
    detailHtmlStatusCounts: Record<string, number>;
    ajaxRequestCount: number;
    ajaxSuccessCount: number;
    ajaxNonOkCount: number;
    ajaxErrorCount: number;
    ajaxSecondUrlTriedCount: number;
    ajaxFirstUrlSucceededCount: number;
    ajaxStatusCounts: Record<string, number>;
  };
  htmlOnlyProbeTotalMs: number;
  htmlOnlyProbeExecutedCount: number;
  htmlPriceFoundCount: number;
  htmlOfficialPriceFoundCount: number;
  htmlDiscountRateFoundCount: number;
  htmlSalesCountFoundCount: number;
  htmlSalesCountMissingCount: number;
  htmlRatingFoundCount: number;
  htmlRatingCountFoundCount: number;
  htmlReleaseDateFoundCount: number;
  htmlSalesCountAjaxComparedCount: number;
  htmlSalesCountAjaxMatchCount: number;
  htmlSalesCountAjaxMismatchCount: number;
  htmlSalesCountAjaxHtmlMissingCount: number;
  htmlSalesCountAjaxAjaxMissingCount: number;
  htmlSalesCountAjaxBothMissingCount: number;
  htmlSalesCountAjaxMismatchExamples: Array<{
    sourceProductId: string;
    sourceUrl?: string;
    htmlSalesCount?: number;
    ajaxSalesCount?: number;
  }>;
  ajaxRequiredCount: number;
  ajaxSkippedCandidateCount: number;
  otherParseTotalMs: number;
  productExistingReadTotalMs: number;
  dailySalesExistingProductReadTotalMs: number;
  dailySalesDeltaCalcTotalMs: number;
  productAndMetricSaveTotalMs: number;
  firestoreBatchCommitTotalMs: number;
  firestoreBatchCommitCount: number;
  firestoreAutoFlushTotalMs: number;
  firestoreAutoFlushCount: number;
  firestoreChunkFlushTotalMs: number;
  firestoreChunkFlushCount: number;
  firestoreWriteOperationCount: number;
  firestorePendingWriteCount: number;
  batchRunsUpdateTotalMs: number;
  delayTotalMs: number;
  processedDetailCount: number;
  avgMsPerProcessedDetail: number;
  memory: MemoryUsageSummary;
  performanceJsonBytes: number;
  firestore: {
    productExistingReadCount: number;
    dailySalesExistingProductReadCount: number;
    dailySalesPreviousMetricWriteCount: number;
    dailySalesDeltaCalculatedCount: number;
    dailySalesDeltaNoPreviousCount: number;
    dailySalesDeltaNegativeCount: number;
    dailySalesDeltaMultiDayGapCount: number;
    dailySalesDeltaSkippedCount: number;
    dailySalesDeltaSameDaySnapshotCount: number;
    dailySalesDeltaSalesCountMissingCount: number;
    discoveryReadCount: number;
    discoveryWriteCount: number;
    productWriteCount: number;
    dailyMetricWriteCount: number;
    batchRunWriteCount: number;
  };
};

export type FetchGirlsReleaseOldProductsResult = {
  run: BatchRun;
  options: FetchGirlsReleaseOldProductsOptions;
  scan: {
    totalCount: number;
    totalPages: number;
    perPage: number;
    startPage: number;
    pagesToFetch: number;
    fetchedPageCount: number;
    listedProductCount: number;
    failedPages: Array<{ page: number; url: string; message: string }>;
    pageResults: Array<{
      page: number;
      idsInPage: number;
      newIdsInPage: number;
      url: string;
    }>;
  };
  details: {
    requestedCount: number;
    fetchedCount: number;
    skippedCount: number;
    failedCount: number;
    failedProductIds: string[];
  };
  performance: PerformanceSummary;
};

function buildProductIdForTarget(
  target: FetchTarget,
  sourceProductId: string,
): string {
  return `${target.platform}_${target.category}_${sourceProductId}`;
}

type DailySalesDeltaStatus = NonNullable<
  ProductDailyMetric["dailySalesStatus"]
>;

type DailySalesDeltaStats = {
  calculatedCount: number;
  noPreviousCount: number;
  negativeCount: number;
  multiDayGapCount: number;
  skippedCount: number;
  sameDaySnapshotCount: number;
  salesCountMissingCount: number;
};

type DailySalesDeltaUpdate = {
  currentMetricPatch: Partial<ProductDailyMetric>;
  productPatch: Partial<Product>;
  previousMetricDate?: string;
  previousMetricPatch?: Partial<ProductDailyMetric>;
  stats: DailySalesDeltaStats;
};

type SaveProductAndMetricOptions = {
  saveDailyMetrics: boolean;
  dailySalesDelta?: {
    enabled: boolean;
    currentDate: string;
    salesDate: string;
    existingProduct?: Product;
  };
};

type SaveProductAndMetricResult = {
  writeCount: number;
  dailyMetricWriteCount: number;
  dailySalesPreviousMetricWriteCount: number;
  dailySalesDeltaStats: DailySalesDeltaStats;
  dailySalesDeltaCalcElapsedMs: number;
  firestoreAutoFlushElapsedMs: number;
  firestoreAutoFlushCount: number;
  writeBufferPendingWriteCount: number;
  elapsedMs: number;
};

function createEmptyDailySalesDeltaStats(): DailySalesDeltaStats {
  return {
    calculatedCount: 0,
    noPreviousCount: 0,
    negativeCount: 0,
    multiDayGapCount: 0,
    skippedCount: 0,
    sameDaySnapshotCount: 0,
    salesCountMissingCount: 0,
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function buildCurrentMetricPatch(
  status: DailySalesDeltaStatus,
): Partial<ProductDailyMetric> {
  return {
    dailySalesCount: null,
    dailySalesStatus: status,
  };
}

function buildPreviousMetricPatch(params: {
  status: DailySalesDeltaStatus;
  dailySalesCount: number | null;
  baseDate: string;
  nextDate: string;
  baseCount: number;
  nextCount: number;
  rawDelta: number;
  periodDays: number;
  calculatedAt: FirebaseFirestore.Timestamp;
}): Partial<ProductDailyMetric> {
  return {
    dailySalesCount: params.dailySalesCount,
    dailySalesStatus: params.status,
    dailySalesBaseDate: params.baseDate,
    dailySalesNextDate: params.nextDate,
    dailySalesBaseCount: params.baseCount,
    dailySalesNextCount: params.nextCount,
    dailySalesRawDelta: params.rawDelta,
    dailySalesPeriodDays: params.periodDays,
    periodSalesCount:
      params.status === "multi_day_gap" && params.rawDelta >= 0
        ? params.rawDelta
        : undefined,
    dailySalesCalculatedAt: params.calculatedAt,
  };
}

function buildDailySalesDeltaUpdate(params: {
  product: Product;
  currentDate: string;
  salesDate: string;
  existingProduct?: Product;
  calculatedAt: FirebaseFirestore.Timestamp;
}): DailySalesDeltaUpdate {
  const stats = createEmptyDailySalesDeltaStats();
  const currentSalesCount = params.product.salesCount;

  if (!isFiniteNumber(currentSalesCount)) {
    stats.salesCountMissingCount += 1;
    return {
      currentMetricPatch: buildCurrentMetricPatch("sales_count_missing"),
      productPatch: {},
      stats,
    };
  }

  const previousSnapshotDate =
    params.existingProduct?.lastDailySalesSnapshotDate;
  const previousSnapshotCount =
    params.existingProduct?.lastDailySalesSnapshotCount;
  const productPatch: Partial<Product> = {
    lastDailySalesSnapshotDate: params.currentDate,
    lastDailySalesSnapshotCount: currentSalesCount,
    lastDailySalesSnapshotFetchedAt: params.calculatedAt,
  };

  if (!previousSnapshotDate || !isFiniteNumber(previousSnapshotCount)) {
    stats.noPreviousCount += 1;
    return {
      currentMetricPatch: buildCurrentMetricPatch("pending"),
      productPatch,
      stats,
    };
  }

  productPatch.previousDailySalesSnapshotDate = previousSnapshotDate;
  productPatch.previousDailySalesSnapshotCount = previousSnapshotCount;

  if (previousSnapshotDate === params.currentDate) {
    stats.sameDaySnapshotCount += 1;
    return {
      currentMetricPatch: buildCurrentMetricPatch("pending"),
      productPatch,
      stats,
    };
  }

  const periodDays = daysBetweenYyyyMMdd(
    previousSnapshotDate,
    params.currentDate,
  );
  if (periodDays === undefined || periodDays <= 0) {
    stats.skippedCount += 1;
    return {
      currentMetricPatch: buildCurrentMetricPatch("pending"),
      productPatch,
      previousMetricDate: previousSnapshotDate,
      previousMetricPatch: {
        dailySalesCount: null,
        dailySalesStatus: "invalid_snapshot_date",
        dailySalesBaseDate: previousSnapshotDate,
        dailySalesNextDate: params.currentDate,
        dailySalesBaseCount: previousSnapshotCount,
        dailySalesNextCount: currentSalesCount,
        dailySalesRawDelta: currentSalesCount - previousSnapshotCount,
        dailySalesCalculatedAt: params.calculatedAt,
      },
      stats,
    };
  }

  const rawDelta = currentSalesCount - previousSnapshotCount;
  const basePatchParams = {
    baseDate: previousSnapshotDate,
    nextDate: params.currentDate,
    baseCount: previousSnapshotCount,
    nextCount: currentSalesCount,
    rawDelta,
    periodDays,
    calculatedAt: params.calculatedAt,
  };

  if (rawDelta < 0) {
    stats.negativeCount += 1;
    productPatch.lastDailySalesDeltaCalculatedDate = previousSnapshotDate;
    return {
      currentMetricPatch: buildCurrentMetricPatch("pending"),
      productPatch,
      previousMetricDate: previousSnapshotDate,
      previousMetricPatch: buildPreviousMetricPatch({
        ...basePatchParams,
        status: "negative_delta",
        dailySalesCount: null,
      }),
      stats,
    };
  }

  if (previousSnapshotDate !== params.salesDate || periodDays !== 1) {
    stats.multiDayGapCount += 1;
    productPatch.lastDailySalesDeltaCalculatedDate = previousSnapshotDate;
    return {
      currentMetricPatch: buildCurrentMetricPatch("pending"),
      productPatch,
      previousMetricDate: previousSnapshotDate,
      previousMetricPatch: buildPreviousMetricPatch({
        ...basePatchParams,
        status: "multi_day_gap",
        dailySalesCount: null,
      }),
      stats,
    };
  }

  stats.calculatedCount += 1;
  productPatch.lastDailySalesDeltaCalculatedDate = params.salesDate;
  return {
    currentMetricPatch: buildCurrentMetricPatch("pending"),
    productPatch,
    previousMetricDate: params.salesDate,
    previousMetricPatch: buildPreviousMetricPatch({
      ...basePatchParams,
      status: "calculated",
      dailySalesCount: rawDelta,
    }),
    stats,
  };
}

function addDailySalesDeltaStatsToPerformance(
  stats: PerformanceStats,
  deltaStats: DailySalesDeltaStats,
): void {
  stats.dailySalesDeltaCalculatedCount += deltaStats.calculatedCount;
  stats.dailySalesDeltaNoPreviousCount += deltaStats.noPreviousCount;
  stats.dailySalesDeltaNegativeCount += deltaStats.negativeCount;
  stats.dailySalesDeltaMultiDayGapCount += deltaStats.multiDayGapCount;
  stats.dailySalesDeltaSkippedCount += deltaStats.skippedCount;
  stats.dailySalesDeltaSameDaySnapshotCount += deltaStats.sameDaySnapshotCount;
  stats.dailySalesDeltaSalesCountMissingCount +=
    deltaStats.salesCountMissingCount;
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

  // salesCountは日次差分・ランキング表示の重要項目。
  // Ajax取得失敗などで今回値が取れなかった場合は、merge保存で既存値を壊さないよう
  // 明示的に保存対象から外す。0は「販売数0」の有効値なので残す。
  if (!isFiniteNumber(productForSave.salesCount)) {
    delete productForSave.salesCount;
  }

  return productForSave;
}


class FirestoreWriteBuffer {
  private batch = db.batch();
  private pendingWriteCount = 0;

  commitCount = 0;
  commitElapsedMs = 0;
  writeOperationCount = 0;

  constructor(private readonly maxWritesPerCommit = FIRESTORE_BATCH_LIMIT) {}

  getPendingWriteCount(): number {
    return this.pendingWriteCount;
  }

  async set(
    ref: FirebaseFirestore.DocumentReference,
    data: FirebaseFirestore.WithFieldValue<FirebaseFirestore.DocumentData>,
    options: FirebaseFirestore.SetOptions,
  ): Promise<{ flushed: boolean; elapsedMs: number }> {
    let flushResult = { flushed: false, elapsedMs: 0 };
    if (this.pendingWriteCount + 1 > this.maxWritesPerCommit) {
      flushResult = await this.flush();
    }

    this.batch.set(ref, data, options);
    this.pendingWriteCount += 1;
    this.writeOperationCount += 1;
    return flushResult;
  }

  async flush(): Promise<{ flushed: boolean; elapsedMs: number }> {
    if (this.pendingWriteCount <= 0) {
      return { flushed: false, elapsedMs: 0 };
    }

    const startedAt = Date.now();
    await this.batch.commit();
    const elapsedMs = Date.now() - startedAt;
    this.commitElapsedMs += elapsedMs;
    this.commitCount += 1;
    this.batch = db.batch();
    this.pendingWriteCount = 0;
    return { flushed: true, elapsedMs };
  }
}

async function enqueueProductAndMetricWrites(
  writeBuffer: FirestoreWriteBuffer,
  product: Product,
  date: string,
  options: SaveProductAndMetricOptions,
): Promise<SaveProductAndMetricResult> {
  const startedAt = Date.now();
  const productRef = db.collection("products").doc(product.productId);
  const emptyStats = createEmptyDailySalesDeltaStats();
  let firestoreAutoFlushElapsedMs = 0;
  let firestoreAutoFlushCount = 0;

  const addAutoFlushResult = (result: {
    flushed: boolean;
    elapsedMs: number;
  }) => {
    if (!result.flushed) return;
    firestoreAutoFlushElapsedMs += result.elapsedMs;
    firestoreAutoFlushCount += 1;
  };

  if (!options.saveDailyMetrics) {
    addAutoFlushResult(
      await writeBuffer.set(productRef, buildProductForSave(product), {
        merge: true,
      }),
    );
    return {
      writeCount: 1,
      dailyMetricWriteCount: 0,
      dailySalesPreviousMetricWriteCount: 0,
      dailySalesDeltaStats: emptyStats,
      dailySalesDeltaCalcElapsedMs: 0,
      firestoreAutoFlushElapsedMs,
      firestoreAutoFlushCount,
      writeBufferPendingWriteCount: writeBuffer.getPendingWriteCount(),
      elapsedMs: Date.now() - startedAt,
    };
  }

  const deltaCalcStartedAt = Date.now();
  const dailySalesDelta =
    options.dailySalesDelta?.enabled === true
      ? buildDailySalesDeltaUpdate({
          product,
          currentDate: options.dailySalesDelta.currentDate,
          salesDate: options.dailySalesDelta.salesDate,
          existingProduct: options.dailySalesDelta.existingProduct,
          calculatedAt: nowTimestamp(),
        })
      : undefined;
  const dailySalesDeltaCalcElapsedMs = Date.now() - deltaCalcStartedAt;
  const productToSave = buildProductForSave(
    dailySalesDelta ? { ...product, ...dailySalesDelta.productPatch } : product,
  );

  addAutoFlushResult(
    await writeBuffer.set(productRef, productToSave, {
      merge: true,
    }),
  );
  addAutoFlushResult(
    await writeBuffer.set(
      productRef.collection("dailyMetrics").doc(date),
      buildMetric(product, date, dailySalesDelta?.currentMetricPatch),
      { merge: true },
    ),
  );

  let previousMetricWriteCount = 0;
  if (
    dailySalesDelta?.previousMetricDate &&
    dailySalesDelta.previousMetricPatch
  ) {
    addAutoFlushResult(
      await writeBuffer.set(
        productRef
          .collection("dailyMetrics")
          .doc(dailySalesDelta.previousMetricDate),
        dailySalesDelta.previousMetricPatch,
        { merge: true },
      ),
    );
    previousMetricWriteCount = 1;
  }

  return {
    writeCount: 1,
    dailyMetricWriteCount: 1 + previousMetricWriteCount,
    dailySalesPreviousMetricWriteCount: previousMetricWriteCount,
    dailySalesDeltaStats: dailySalesDelta?.stats ?? emptyStats,
    dailySalesDeltaCalcElapsedMs,
    firestoreAutoFlushElapsedMs,
    firestoreAutoFlushCount,
    writeBufferPendingWriteCount: writeBuffer.getPendingWriteCount(),
    elapsedMs: Date.now() - startedAt,
  };
}

async function loadExistingProduct(
  sourceProductId: string,
  target: FetchTarget,
): Promise<Product | undefined> {
  const productId = buildProductIdForTarget(target, sourceProductId);
  const snapshot = await db.collection("products").doc(productId).get();
  if (!snapshot.exists) return undefined;
  return snapshot.data() as Product;
}

async function loadExistingProductsById(
  products: DiscoveredProductSource[],
  target: FetchTarget,
): Promise<{
  productsById: Map<string, Product>;
  readCount: number;
  elapsedMs: number;
}> {
  const startedAt = Date.now();
  const productsById = new Map<string, Product>();
  const productIds = products.map((product) =>
    buildProductIdForTarget(target, product.sourceProductId),
  );
  let readCount = 0;

  for (const chunk of chunkArray(productIds, FIRESTORE_BATCH_LIMIT)) {
    const refs = chunk.map((productId) =>
      db.collection("products").doc(productId),
    );
    const snapshots = await db.getAll(...refs);
    readCount += refs.length;

    snapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) return;
      const productId = chunk[index];
      if (productId) productsById.set(productId, snapshot.data() as Product);
    });
  }

  return { productsById, readCount, elapsedMs: Date.now() - startedAt };
}

function isFreshProduct(
  product: Product | undefined,
  skipFreshHours: number | undefined,
): boolean {
  if (!product || skipFreshHours === undefined || skipFreshHours <= 0)
    return false;

  const timestamp =
    product.lastFetchedAt ?? product.fetchedAt ?? product.updatedAt;
  const fetchedAtMs = timestamp?.toMillis?.();
  if (!fetchedAtMs) return false;

  return fetchedAtMs + skipFreshHours * 60 * 60 * 1000 > Date.now();
}

function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildDiscoveryDocId(
  sourceProductId: string,
  contentType: ProductContentType,
): string {
  return contentType === "bl"
    ? `dlsite_bl_${sourceProductId}`
    : `dlsite_girls_${sourceProductId}`;
}

async function saveDiscoveryDocuments(
  products: DiscoveredProductSource[],
  target: FetchTarget,
  contentType: ProductContentType,
): Promise<{ savedCount: number; readCount: number; writeCount: number }> {
  const observedAt = nowTimestamp();
  let savedCount = 0;
  let readCount = 0;
  let writeCount = 0;

  for (const chunk of chunkArray(products, FIRESTORE_BATCH_LIMIT)) {
    const refs = chunk.map((product) =>
      db
        .collection(DISCOVERY_COLLECTION)
        .doc(buildDiscoveryDocId(product.sourceProductId, contentType)),
    );
    const snapshots = await db.getAll(...refs);
    readCount += refs.length;
    const batch = db.batch();

    chunk.forEach((product, index) => {
      const snapshot = snapshots[index];
      const existingFirstDiscoveredAt = snapshot?.exists
        ? snapshot.data()?.firstDiscoveredAt
        : undefined;
      const ref = refs[index];
      batch.set(
        ref,
        {
          discoveryId: buildDiscoveryDocId(
            product.sourceProductId,
            contentType,
          ),
          workId: product.sourceProductId,
          sourceProductId: product.sourceProductId,
          productId: buildProductIdForTarget(target, product.sourceProductId),
          source: "dlsite",
          platform: "dlsite",
          site: contentType === "bl" ? "bl" : "girls",
          audience: "female",
          category: "doujin",
          contentType,
          contentTypeId: `dlsite:${contentType}`,
          sourceUrl: product.sourceUrl,
          listUrl: product.listUrl,
          firstDiscoveredAt: existingFirstDiscoveredAt ?? observedAt,
          lastSeenAt: observedAt,
          discoveredBy: buildDiscoveredBy(contentType),
          updatedAt: observedAt,
        },
        { merge: true },
      );
    });

    await batch.commit();
    savedCount += chunk.length;
    writeCount += chunk.length;
  }

  return { savedCount, readCount, writeCount };
}

function buildRunBase(
  runId: string,
  startedAt: FirebaseFirestore.Timestamp,
  contentType: ProductContentType,
): BatchRun {
  return {
    runId,
    jobName: buildJobName(contentType),
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
}

function createPerformanceStats(): PerformanceStats {
  return {
    startedAtMs: Date.now(),
    listScanTotalMs: 0,
    listChunkCount: 0,
    listChunkTotalMs: 0,
    listPageFetchTotalMs: 0,
    productIdExtractTotalMs: 0,
    discoverySaveTotalMs: 0,
    detailHtmlFetchTotalMs: 0,
    detailHtmlParseTotalMs: 0,
    detailHtmlParseIncludingAjaxTotalMs: 0,
    detailHtmlFetchSamplesMs: [],
    ajaxInfoFetchSamplesMs: [],
    detailHtmlRequestCount: 0,
    detailHtmlRetryCount: 0,
    detailHtmlRetryBackoffMs: 0,
    detailHtmlCandidateUrlCount: 0,
    detailHtmlCandidateFetchFailedCount: 0,
    detailHtmlStatusCounts: {},
    ajaxRequestCount: 0,
    ajaxSuccessCount: 0,
    ajaxNonOkCount: 0,
    ajaxErrorCount: 0,
    ajaxSecondUrlTriedCount: 0,
    ajaxFirstUrlSucceededCount: 0,
    ajaxStatusCounts: {},
    cheerioLoadTotalMs: 0,
    parseBasicInfoTotalMs: 0,
    parsePriceTotalMs: 0,
    parseSalesTotalMs: 0,
    parseRatingTotalMs: 0,
    parseReleaseDateTotalMs: 0,
    parseGenresTotalMs: 0,
    parseImagesTotalMs: 0,
    parseDescriptionTotalMs: 0,
    normalizeProductTotalMs: 0,
    ajaxInfoFetchTotalMs: 0,
    htmlOnlyProbeTotalMs: 0,
    htmlOnlyProbeExecutedCount: 0,
    htmlPriceFoundCount: 0,
    htmlOfficialPriceFoundCount: 0,
    htmlDiscountRateFoundCount: 0,
    htmlSalesCountFoundCount: 0,
    htmlSalesCountMissingCount: 0,
    htmlRatingFoundCount: 0,
    htmlRatingCountFoundCount: 0,
    htmlReleaseDateFoundCount: 0,
    htmlSalesCountAjaxComparedCount: 0,
    htmlSalesCountAjaxMatchCount: 0,
    htmlSalesCountAjaxMismatchCount: 0,
    htmlSalesCountAjaxHtmlMissingCount: 0,
    htmlSalesCountAjaxAjaxMissingCount: 0,
    htmlSalesCountAjaxBothMissingCount: 0,
    htmlSalesCountAjaxMismatchExamples: [],
    ajaxRequiredCount: 0,
    ajaxSkippedCandidateCount: 0,
    otherParseTotalMs: 0,
    productExistingReadTotalMs: 0,
    dailySalesExistingProductReadTotalMs: 0,
    dailySalesDeltaCalcTotalMs: 0,
    productAndMetricSaveTotalMs: 0,
    firestoreBatchCommitTotalMs: 0,
    firestoreBatchCommitCount: 0,
    firestoreAutoFlushTotalMs: 0,
    firestoreAutoFlushCount: 0,
    firestoreChunkFlushTotalMs: 0,
    firestoreChunkFlushCount: 0,
    firestoreWriteOperationCount: 0,
    firestorePendingWriteCount: 0,
    batchRunsUpdateTotalMs: 0,
    delayTotalMs: 0,
    productExistingReadCount: 0,
    dailySalesExistingProductReadCount: 0,
    dailySalesPreviousMetricWriteCount: 0,
    dailySalesDeltaCalculatedCount: 0,
    dailySalesDeltaNoPreviousCount: 0,
    dailySalesDeltaNegativeCount: 0,
    dailySalesDeltaMultiDayGapCount: 0,
    dailySalesDeltaSkippedCount: 0,
    dailySalesDeltaSameDaySnapshotCount: 0,
    dailySalesDeltaSalesCountMissingCount: 0,
    discoveryReadCount: 0,
    discoveryWriteCount: 0,
    productWriteCount: 0,
    dailyMetricWriteCount: 0,
    batchRunWriteCount: 0,
  };
}

function roundMs(value: number): number {
  return Math.round(value);
}

function roundMb(value: number): number {
  return Math.round((value / 1024 / 1024) * 10) / 10;
}

function summarizeLatencySamples(samples: number[]): LatencySummary {
  if (samples.length <= 0) {
    return {
      count: 0,
      totalMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      maxMs: 0,
    };
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const totalMs = samples.reduce((sum, value) => sum + value, 0);
  const percentile = (rate: number) => {
    const index = Math.min(
      sorted.length - 1,
      Math.max(0, Math.ceil(sorted.length * rate) - 1),
    );
    return roundMs(sorted[index]);
  };

  return {
    count: samples.length,
    totalMs: roundMs(totalMs),
    avgMs: roundMs(totalMs / samples.length),
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: roundMs(sorted[sorted.length - 1]),
  };
}

function getMemoryUsageSummary(): MemoryUsageSummary {
  const memory = process.memoryUsage();
  return {
    rssMb: roundMb(memory.rss),
    heapUsedMb: roundMb(memory.heapUsed),
    heapTotalMb: roundMb(memory.heapTotal),
    externalMb: roundMb(memory.external),
  };
}

function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return 0;
  }
}

function mergeCountRecord(
  target: Record<string, number>,
  source: Record<string, number> | undefined,
): void {
  if (!source) return;
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function createPerformanceWindowSnapshot(
  stats: PerformanceStats,
  processedDetailCount: number,
): PerformanceWindowSnapshot {
  return {
    elapsedMs: Date.now() - stats.startedAtMs,
    detailHtmlFetchSamplesLength: stats.detailHtmlFetchSamplesMs.length,
    ajaxInfoFetchSamplesLength: stats.ajaxInfoFetchSamplesMs.length,
    detailHtmlRequestCount: stats.detailHtmlRequestCount,
    detailHtmlRetryCount: stats.detailHtmlRetryCount,
    ajaxRequestCount: stats.ajaxRequestCount,
    ajaxSuccessCount: stats.ajaxSuccessCount,
    ajaxNonOkCount: stats.ajaxNonOkCount,
    ajaxErrorCount: stats.ajaxErrorCount,
    processedDetailCount,
  };
}

function buildPerformanceWindowSummary(
  stats: PerformanceStats,
  snapshot: PerformanceWindowSnapshot,
  processedDetailCount: number,
): PerformanceWindowSummary {
  const elapsedMs = Date.now() - stats.startedAtMs - snapshot.elapsedMs;
  const processedDelta = Math.max(
    0,
    processedDetailCount - snapshot.processedDetailCount,
  );

  return {
    elapsedMs: roundMs(elapsedMs),
    processedDetailCount: processedDelta,
    avgMsPerProcessedDetail:
      processedDelta > 0 ? roundMs(elapsedMs / processedDelta) : 0,
    detailHtmlFetch: summarizeLatencySamples(
      stats.detailHtmlFetchSamplesMs.slice(
        snapshot.detailHtmlFetchSamplesLength,
      ),
    ),
    ajaxInfoFetch: summarizeLatencySamples(
      stats.ajaxInfoFetchSamplesMs.slice(snapshot.ajaxInfoFetchSamplesLength),
    ),
    detailHtmlRequestCount:
      stats.detailHtmlRequestCount - snapshot.detailHtmlRequestCount,
    detailHtmlRetryCount:
      stats.detailHtmlRetryCount - snapshot.detailHtmlRetryCount,
    ajaxRequestCount: stats.ajaxRequestCount - snapshot.ajaxRequestCount,
    ajaxSuccessCount: stats.ajaxSuccessCount - snapshot.ajaxSuccessCount,
    ajaxNonOkCount: stats.ajaxNonOkCount - snapshot.ajaxNonOkCount,
    ajaxErrorCount: stats.ajaxErrorCount - snapshot.ajaxErrorCount,
  };
}

function buildPerformanceSummary(
  stats: PerformanceStats,
  processedDetailCount: number,
): PerformanceSummary {
  const totalElapsedMs = Date.now() - stats.startedAtMs;
  const summary: PerformanceSummary = {
    totalElapsedMs: roundMs(totalElapsedMs),
    listScanTotalMs: roundMs(stats.listScanTotalMs),
    listChunkCount: stats.listChunkCount,
    listChunkTotalMs: roundMs(stats.listChunkTotalMs),
    listPageFetchTotalMs: roundMs(stats.listPageFetchTotalMs),
    productIdExtractTotalMs: roundMs(stats.productIdExtractTotalMs),
    discoverySaveTotalMs: roundMs(stats.discoverySaveTotalMs),
    detailHtmlFetchTotalMs: roundMs(stats.detailHtmlFetchTotalMs),
    detailHtmlParseTotalMs: roundMs(stats.detailHtmlParseTotalMs),
    detailHtmlParseIncludingAjaxTotalMs: roundMs(
      stats.detailHtmlParseIncludingAjaxTotalMs,
    ),
    cheerioLoadTotalMs: roundMs(stats.cheerioLoadTotalMs),
    parseBasicInfoTotalMs: roundMs(stats.parseBasicInfoTotalMs),
    parsePriceTotalMs: roundMs(stats.parsePriceTotalMs),
    parseSalesTotalMs: roundMs(stats.parseSalesTotalMs),
    parseRatingTotalMs: roundMs(stats.parseRatingTotalMs),
    parseReleaseDateTotalMs: roundMs(stats.parseReleaseDateTotalMs),
    parseGenresTotalMs: roundMs(stats.parseGenresTotalMs),
    parseImagesTotalMs: roundMs(stats.parseImagesTotalMs),
    parseDescriptionTotalMs: roundMs(stats.parseDescriptionTotalMs),
    normalizeProductTotalMs: roundMs(stats.normalizeProductTotalMs),
    ajaxInfoFetchTotalMs: roundMs(stats.ajaxInfoFetchTotalMs),
    http: {
      detailHtmlFetch: summarizeLatencySamples(stats.detailHtmlFetchSamplesMs),
      ajaxInfoFetch: summarizeLatencySamples(stats.ajaxInfoFetchSamplesMs),
      detailHtmlRequestCount: stats.detailHtmlRequestCount,
      detailHtmlRetryCount: stats.detailHtmlRetryCount,
      detailHtmlRetryBackoffMs: roundMs(stats.detailHtmlRetryBackoffMs),
      detailHtmlCandidateUrlCount: stats.detailHtmlCandidateUrlCount,
      detailHtmlCandidateFetchFailedCount:
        stats.detailHtmlCandidateFetchFailedCount,
      detailHtmlStatusCounts: stats.detailHtmlStatusCounts,
      ajaxRequestCount: stats.ajaxRequestCount,
      ajaxSuccessCount: stats.ajaxSuccessCount,
      ajaxNonOkCount: stats.ajaxNonOkCount,
      ajaxErrorCount: stats.ajaxErrorCount,
      ajaxSecondUrlTriedCount: stats.ajaxSecondUrlTriedCount,
      ajaxFirstUrlSucceededCount: stats.ajaxFirstUrlSucceededCount,
      ajaxStatusCounts: stats.ajaxStatusCounts,
    },
    htmlOnlyProbeTotalMs: roundMs(stats.htmlOnlyProbeTotalMs),
    htmlOnlyProbeExecutedCount: stats.htmlOnlyProbeExecutedCount,
    htmlPriceFoundCount: stats.htmlPriceFoundCount,
    htmlOfficialPriceFoundCount: stats.htmlOfficialPriceFoundCount,
    htmlDiscountRateFoundCount: stats.htmlDiscountRateFoundCount,
    htmlSalesCountFoundCount: stats.htmlSalesCountFoundCount,
    htmlSalesCountMissingCount: stats.htmlSalesCountMissingCount,
    htmlRatingFoundCount: stats.htmlRatingFoundCount,
    htmlRatingCountFoundCount: stats.htmlRatingCountFoundCount,
    htmlReleaseDateFoundCount: stats.htmlReleaseDateFoundCount,
    htmlSalesCountAjaxComparedCount: stats.htmlSalesCountAjaxComparedCount,
    htmlSalesCountAjaxMatchCount: stats.htmlSalesCountAjaxMatchCount,
    htmlSalesCountAjaxMismatchCount: stats.htmlSalesCountAjaxMismatchCount,
    htmlSalesCountAjaxHtmlMissingCount: stats.htmlSalesCountAjaxHtmlMissingCount,
    htmlSalesCountAjaxAjaxMissingCount: stats.htmlSalesCountAjaxAjaxMissingCount,
    htmlSalesCountAjaxBothMissingCount: stats.htmlSalesCountAjaxBothMissingCount,
    htmlSalesCountAjaxMismatchExamples:
      stats.htmlSalesCountAjaxMismatchExamples.slice(0, 10),
    ajaxRequiredCount: stats.ajaxRequiredCount,
    ajaxSkippedCandidateCount: stats.ajaxSkippedCandidateCount,
    otherParseTotalMs: roundMs(stats.otherParseTotalMs),
    productExistingReadTotalMs: roundMs(stats.productExistingReadTotalMs),
    dailySalesExistingProductReadTotalMs: roundMs(
      stats.dailySalesExistingProductReadTotalMs,
    ),
    dailySalesDeltaCalcTotalMs: roundMs(stats.dailySalesDeltaCalcTotalMs),
    productAndMetricSaveTotalMs: roundMs(stats.productAndMetricSaveTotalMs),
    firestoreBatchCommitTotalMs: roundMs(stats.firestoreBatchCommitTotalMs),
    firestoreBatchCommitCount: stats.firestoreBatchCommitCount,
    firestoreAutoFlushTotalMs: roundMs(stats.firestoreAutoFlushTotalMs),
    firestoreAutoFlushCount: stats.firestoreAutoFlushCount,
    firestoreChunkFlushTotalMs: roundMs(stats.firestoreChunkFlushTotalMs),
    firestoreChunkFlushCount: stats.firestoreChunkFlushCount,
    firestoreWriteOperationCount: stats.firestoreWriteOperationCount,
    firestorePendingWriteCount: stats.firestorePendingWriteCount,
    batchRunsUpdateTotalMs: roundMs(stats.batchRunsUpdateTotalMs),
    delayTotalMs: roundMs(stats.delayTotalMs),
    processedDetailCount,
    avgMsPerProcessedDetail:
      processedDetailCount > 0
        ? roundMs(totalElapsedMs / processedDetailCount)
        : 0,
    memory: getMemoryUsageSummary(),
    performanceJsonBytes: 0,
    firestore: {
      productExistingReadCount: stats.productExistingReadCount,
      dailySalesExistingProductReadCount:
        stats.dailySalesExistingProductReadCount,
      dailySalesPreviousMetricWriteCount:
        stats.dailySalesPreviousMetricWriteCount,
      dailySalesDeltaCalculatedCount: stats.dailySalesDeltaCalculatedCount,
      dailySalesDeltaNoPreviousCount: stats.dailySalesDeltaNoPreviousCount,
      dailySalesDeltaNegativeCount: stats.dailySalesDeltaNegativeCount,
      dailySalesDeltaMultiDayGapCount: stats.dailySalesDeltaMultiDayGapCount,
      dailySalesDeltaSkippedCount: stats.dailySalesDeltaSkippedCount,
      dailySalesDeltaSameDaySnapshotCount:
        stats.dailySalesDeltaSameDaySnapshotCount,
      dailySalesDeltaSalesCountMissingCount:
        stats.dailySalesDeltaSalesCountMissingCount,
      discoveryReadCount: stats.discoveryReadCount,
      discoveryWriteCount: stats.discoveryWriteCount,
      productWriteCount: stats.productWriteCount,
      dailyMetricWriteCount: stats.dailyMetricWriteCount,
      batchRunWriteCount: stats.batchRunWriteCount,
    },
  };
  summary.performanceJsonBytes = estimateJsonBytes(summary);
  return summary;
}

function addParseTimingToPerformance(
  stats: PerformanceStats,
  timing: ProductDetailParseTiming | undefined,
): void {
  if (!timing) return;

  stats.cheerioLoadTotalMs += timing.cheerioLoadMs ?? 0;
  stats.parseBasicInfoTotalMs += timing.parseBasicInfoMs ?? 0;
  stats.parsePriceTotalMs += timing.parsePriceMs ?? 0;
  stats.parseSalesTotalMs += timing.parseSalesMs ?? 0;
  stats.parseRatingTotalMs += timing.parseRatingMs ?? 0;
  stats.parseReleaseDateTotalMs += timing.parseReleaseDateMs ?? 0;
  stats.parseGenresTotalMs += timing.parseGenresMs ?? 0;
  stats.parseImagesTotalMs += timing.parseImagesMs ?? 0;
  stats.parseDescriptionTotalMs += timing.parseDescriptionMs ?? 0;
  stats.normalizeProductTotalMs += timing.normalizeProductMs ?? 0;
  stats.ajaxInfoFetchTotalMs += timing.ajaxInfoFetchMs ?? 0;
  const htmlProbeExecuted = timing.htmlProbeExecuted ?? 0;
  const htmlSalesCountFound = timing.htmlProbeSalesCountFound ?? 0;
  stats.htmlOnlyProbeTotalMs += timing.htmlOnlyProbeMs ?? 0;
  stats.htmlOnlyProbeExecutedCount += htmlProbeExecuted;
  stats.htmlPriceFoundCount += timing.htmlProbePriceCurrentFound ?? 0;
  stats.htmlOfficialPriceFoundCount += timing.htmlProbePriceOriginalFound ?? 0;
  stats.htmlDiscountRateFoundCount += timing.htmlProbeDiscountRateFound ?? 0;
  stats.htmlSalesCountFoundCount += htmlSalesCountFound;
  stats.htmlSalesCountMissingCount += Math.max(
    0,
    htmlProbeExecuted - htmlSalesCountFound,
  );
  stats.htmlRatingFoundCount += timing.htmlProbeRatingFound ?? 0;
  stats.htmlRatingCountFoundCount += timing.htmlProbeReviewCountFound ?? 0;
  stats.htmlReleaseDateFoundCount += timing.htmlProbeReleaseDateFound ?? 0;
  stats.htmlSalesCountAjaxComparedCount +=
    timing.htmlProbeSalesCountAjaxCompared ?? 0;
  stats.htmlSalesCountAjaxMatchCount +=
    timing.htmlProbeSalesCountAjaxMatch ?? 0;
  stats.htmlSalesCountAjaxMismatchCount +=
    timing.htmlProbeSalesCountAjaxMismatch ?? 0;
  stats.htmlSalesCountAjaxHtmlMissingCount +=
    timing.htmlProbeSalesCountAjaxHtmlMissing ?? 0;
  stats.htmlSalesCountAjaxAjaxMissingCount +=
    timing.htmlProbeSalesCountAjaxAjaxMissing ?? 0;
  stats.htmlSalesCountAjaxBothMissingCount +=
    timing.htmlProbeSalesCountAjaxBothMissing ?? 0;
  stats.ajaxRequiredCount += Math.max(0, htmlProbeExecuted - htmlSalesCountFound);
  stats.ajaxSkippedCandidateCount += htmlSalesCountFound;

  stats.otherParseTotalMs += timing.otherParseMs ?? 0;
}

function addProductDetailTimingToPerformance(
  stats: PerformanceStats,
  timing: ProductDetailTiming | undefined,
): void {
  if (!timing) return;

  if (timing.fetchHtmlMs !== undefined) {
    stats.detailHtmlFetchTotalMs += timing.fetchHtmlMs;
    stats.detailHtmlFetchSamplesMs.push(timing.fetchHtmlMs);
  }
  if (timing.parseHtmlMs !== undefined) {
    stats.detailHtmlParseTotalMs += timing.parseHtmlMs;
  }
  if (timing.parseHtmlTotalMs !== undefined) {
    stats.detailHtmlParseIncludingAjaxTotalMs += timing.parseHtmlTotalMs;
  }

  const ajaxInfoFetchMs = timing.parse?.ajaxInfoFetchMs;
  if (ajaxInfoFetchMs !== undefined) {
    stats.ajaxInfoFetchSamplesMs.push(ajaxInfoFetchMs);
  }

  stats.detailHtmlRequestCount += timing.detailHtmlRequestCount ?? 0;
  stats.detailHtmlRetryCount += timing.detailHtmlRetryCount ?? 0;
  stats.detailHtmlRetryBackoffMs += timing.detailHtmlRetryBackoffMs ?? 0;
  stats.detailHtmlCandidateUrlCount +=
    timing.detailHtmlCandidateUrlCount ?? 0;
  stats.detailHtmlCandidateFetchFailedCount +=
    timing.detailHtmlCandidateFetchFailedCount ?? 0;
  mergeCountRecord(stats.detailHtmlStatusCounts, timing.detailHtmlStatusCounts);

  stats.ajaxRequestCount += timing.ajaxRequestCount ?? 0;
  stats.ajaxSuccessCount += timing.ajaxSuccessCount ?? 0;
  stats.ajaxNonOkCount += timing.ajaxNonOkCount ?? 0;
  stats.ajaxErrorCount += timing.ajaxErrorCount ?? 0;
  stats.ajaxSecondUrlTriedCount += timing.ajaxSecondUrlTriedCount ?? 0;
  stats.ajaxFirstUrlSucceededCount +=
    timing.ajaxFirstUrlSucceededCount ?? 0;
  mergeCountRecord(stats.ajaxStatusCounts, timing.ajaxStatusCounts);
}

function addHtmlSalesCountAjaxMismatchExample(
  stats: PerformanceStats,
  timing: ProductDetailTiming | undefined,
  sourceProductId: string,
  sourceUrl: string | undefined,
): void {
  const comparison = timing?.htmlSalesCountAjaxComparison;
  if (!comparison || comparison.status !== "mismatch") return;
  if (stats.htmlSalesCountAjaxMismatchExamples.length >= 10) return;

  stats.htmlSalesCountAjaxMismatchExamples.push({
    sourceProductId,
    sourceUrl,
    htmlSalesCount: comparison.htmlSalesCount,
    ajaxSalesCount: comparison.ajaxSalesCount,
  });
}

function buildRunOptions(
  options: FetchGirlsReleaseOldProductsOptions,
  resolved: {
    delayMs: number;
    dryRun: boolean;
    listOnly: boolean;
    saveDiscovery: boolean;
    saveDailyMetrics: boolean;
    saveDailySalesDelta: boolean;
    progressLogEvery: number;
    parseMode: ProductParseMode;
    htmlOnlyProbe: boolean;
    contentType: ProductContentType;
    pageChunkSize: number;
  },
) {
  return {
    ...options,
    delayMs: resolved.delayMs,
    dryRun: resolved.dryRun,
    listOnly: resolved.listOnly,
    saveDiscovery: resolved.saveDiscovery,
    saveDailyMetrics: resolved.saveDailyMetrics,
    saveDailySalesDelta: resolved.saveDailySalesDelta,
    progressLogEvery: resolved.progressLogEvery,
    parseMode: resolved.parseMode,
    htmlOnlyProbe: resolved.htmlOnlyProbe,
    contentType: resolved.contentType,
    pageChunkSize: resolved.pageChunkSize,
  };
}

export async function fetchGirlsReleaseOldProducts(
  options: FetchGirlsReleaseOldProductsOptions,
): Promise<FetchGirlsReleaseOldProductsResult> {
  const contentType = resolveFetchContentType(options.contentType);
  const target = buildReleaseTarget(contentType);
  const logLabel = buildLogLabel(contentType);
  const runId = createRunId(buildRunIdPrefix(contentType));
  const startedAt = nowTimestamp();
  const date = toYyyyMMdd();
  const salesDate = addDaysToYyyyMMdd(date, -1);
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 500));
  const dryRun = options.dryRun === true;
  const listOnly = dryRun || options.detailLimit === 0;
  const saveDiscovery = options.saveDiscovery !== false;
  const saveDailyMetrics = options.saveDailyMetrics !== false;
  const saveDailySalesDelta =
    saveDailyMetrics && options.saveDailySalesDelta === true;
  const progressLogEvery = Math.max(
    0,
    Math.floor(options.progressLogEvery ?? DEFAULT_PROGRESS_LOG_EVERY),
  );
  const parseMode: ProductParseMode =
    options.parseMode === "fast" ? "fast" : "full";
  const htmlOnlyProbe = options.htmlOnlyProbe === true;
  const pageChunkSize = Math.min(
    MAX_PAGE_CHUNK_SIZE,
    Math.max(1, Math.floor(options.pageChunkSize ?? DEFAULT_PAGE_CHUNK_SIZE)),
  );
  const shouldCheckFreshness =
    options.skipFreshHours !== undefined && options.skipFreshHours > 0;
  const runRef = db.collection("batchRuns").doc(runId);
  const run = buildRunBase(runId, startedAt, contentType);
  const perf = createPerformanceStats();

  const buildResolvedRunOptions = () =>
    buildRunOptions(options, {
      delayMs,
      dryRun,
      listOnly,
      saveDiscovery,
      saveDailyMetrics,
      saveDailySalesDelta,
      progressLogEvery,
      parseMode,
      htmlOnlyProbe,
      contentType,
      pageChunkSize,
    });

  const initialRunWriteStartedAt = Date.now();
  await runRef.set({
    ...run,
    contentType,
    contentTypeId: `dlsite:${contentType}`,
    options: buildResolvedRunOptions(),
  });
  perf.batchRunsUpdateTotalMs += Date.now() - initialRunWriteStartedAt;
  perf.batchRunWriteCount += 1;

  const errorMessages: string[] = [];
  const failedProductIds: string[] = [];
  const failedPages: FetchGirlsReleaseOldProductsResult["scan"]["failedPages"] =
    [];
  const pageResults: FetchGirlsReleaseOldProductsResult["scan"]["pageResults"] =
    [];
  let fetchedProductCount = 0;
  let updatedProductCount = 0;
  let failedProductCount = 0;
  let skippedProductCount = 0;
  let listedProductCount = 0;
  let blocked = false;
  let requestedDetailCount = 0;
  let processedDetailCount = 0;
  let fetchedPageCount = 0;
  let totalCount = 0;
  let totalPages = 0;
  let perPage = 100;
  let startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  let pagesToFetch = 0;

  try {
    const metaStartedAt = Date.now();
    const meta = await fetchDlsiteGirlsReleaseOldListMeta({ contentType });
    perf.listScanTotalMs += Date.now() - metaStartedAt;
    perf.listPageFetchTotalMs += meta.performance.listPageFetchTotalMs;
    perf.productIdExtractTotalMs += meta.performance.productIdExtractTotalMs;
    totalCount = meta.totalCount;
    totalPages = meta.totalPages;
    perPage = meta.perPage;

    const requestedMaxPages =
      typeof options.maxPages === "number"
        ? Math.max(0, Math.floor(options.maxPages))
        : undefined;
    const remainingPageCount = Math.max(0, totalPages - startPage + 1);
    pagesToFetch =
      requestedMaxPages !== undefined
        ? Math.min(remainingPageCount, requestedMaxPages)
        : remainingPageCount;
    const endPage = startPage + pagesToFetch - 1;
    const chunkCount =
      pagesToFetch > 0 ? Math.ceil(pagesToFetch / pageChunkSize) : 0;

    logger.info(`${logLabel} list scan started`, {
      runId,
      totalCount,
      totalPages,
      perPage,
      maxPages: options.maxPages,
      startPage,
      pagesToFetch,
      pageChunkSize,
      chunkCount,
      delayMs,
      contentType,
      sourceUrl: meta.sourceUrl,
    });

    const writeBuffer = new FirestoreWriteBuffer(FIRESTORE_BATCH_LIMIT);
    let progressSnapshot = createPerformanceWindowSnapshot(
      perf,
      processedDetailCount,
    );
    let remainingDetailLimit =
      typeof options.detailLimit === "number"
        ? Math.max(0, options.detailLimit)
        : undefined;

    for (
      let chunkStartPage = startPage, chunkIndex = 1;
      chunkStartPage <= endPage;
      chunkStartPage += pageChunkSize, chunkIndex += 1
    ) {
      if (blocked) break;

      const chunkPagesToFetch = Math.min(
        pageChunkSize,
        endPage - chunkStartPage + 1,
      );
      const chunkStartedAt = Date.now();
      const chunkScan =
        await fetchDlsiteGirlsReleaseOldProductSourcesForPageRange({
          startPage: chunkStartPage,
          pagesToFetch: chunkPagesToFetch,
          delayMs,
          contentType,
          totalCount,
          totalPages,
          firstPageHtml: chunkStartPage === 1 ? meta.firstPageHtml : undefined,
          logPages: chunkPagesToFetch <= 5 && pagesToFetch <= 5,
        });
      const chunkElapsedMs = Date.now() - chunkStartedAt;
      perf.listScanTotalMs += chunkElapsedMs;
      perf.listChunkCount += 1;
      perf.listChunkTotalMs += chunkElapsedMs;
      perf.listPageFetchTotalMs += chunkScan.performance.listPageFetchTotalMs;
      perf.productIdExtractTotalMs +=
        chunkScan.performance.productIdExtractTotalMs;
      fetchedPageCount += chunkScan.fetchedPageCount;
      listedProductCount += chunkScan.products.length;
      pageResults.push(...chunkScan.pageResults);
      failedPages.push(...chunkScan.failedPages);

      logger.info(`${logLabel} list chunk fetched`, {
        runId,
        contentType,
        chunkIndex,
        chunkCount,
        startPage: chunkStartPage,
        pagesToFetch: chunkPagesToFetch,
        fetchedPageCount,
        listedProductCount,
        idsInChunk: chunkScan.products.length,
        failedPages: chunkScan.failedPages.map((failedPage) => failedPage.page),
        performance: buildPerformanceSummary(perf, processedDetailCount),
      });

      if (!dryRun && saveDiscovery && chunkScan.products.length > 0) {
        const discoveryStartedAt = Date.now();
        const discoveryResult = await saveDiscoveryDocuments(
          chunkScan.products,
          target,
          contentType,
        );
        perf.discoverySaveTotalMs += Date.now() - discoveryStartedAt;
        perf.discoveryReadCount += discoveryResult.readCount;
        perf.discoveryWriteCount += discoveryResult.writeCount;
        logger.info(`${logLabel} discovery documents saved`, {
          runId,
          contentType,
          chunkIndex,
          discoverySavedCount: discoveryResult.savedCount,
          discoveryReadCount: discoveryResult.readCount,
          discoveryWriteCount: discoveryResult.writeCount,
          performance: buildPerformanceSummary(perf, processedDetailCount),
        });
      } else if (!dryRun && !saveDiscovery && chunkIndex === 1) {
        logger.info(
          `${logLabel} discovery documents skipped by saveDiscovery=false`,
          {
            runId,
            contentType,
          },
        );
      }

      const chunkDetailTargets = listOnly
        ? []
        : remainingDetailLimit === undefined
          ? chunkScan.products
          : chunkScan.products.slice(0, remainingDetailLimit);
      requestedDetailCount += chunkDetailTargets.length;
      if (remainingDetailLimit !== undefined) {
        remainingDetailLimit = Math.max(
          0,
          remainingDetailLimit - chunkDetailTargets.length,
        );
      }

      if (listOnly) {
        skippedProductCount += chunkScan.products.length;
        continue;
      }

      let existingProductsById = new Map<string, Product>();
      if (saveDailySalesDelta && chunkDetailTargets.length > 0) {
        const existingProductsResult = await loadExistingProductsById(
          chunkDetailTargets,
          target,
        );
        existingProductsById = existingProductsResult.productsById;
        perf.dailySalesExistingProductReadTotalMs +=
          existingProductsResult.elapsedMs;
        perf.dailySalesExistingProductReadCount +=
          existingProductsResult.readCount;
        logger.info(
          `${logLabel} existing products loaded for daily sales delta`,
          {
            runId,
            contentType,
            chunkIndex,
            requestedDetailCount: chunkDetailTargets.length,
            readCount: existingProductsResult.readCount,
            existingProductCount: existingProductsById.size,
            currentDate: date,
            salesDate,
            performance: buildPerformanceSummary(perf, processedDetailCount),
          },
        );
      }

      for (const discovered of chunkDetailTargets) {
        const progress = `${processedDetailCount + 1}/${requestedDetailCount + (remainingDetailLimit ?? 0)}`;

        try {
          const productId = buildProductIdForTarget(
            target,
            discovered.sourceProductId,
          );
          let existingProduct: Product | undefined =
            existingProductsById.get(productId);
          if (shouldCheckFreshness && !saveDailySalesDelta) {
            const readStartedAt = Date.now();
            existingProduct = await loadExistingProduct(
              discovered.sourceProductId,
              target,
            );
            perf.productExistingReadTotalMs += Date.now() - readStartedAt;
            perf.productExistingReadCount += 1;
          }

          if (isFreshProduct(existingProduct, options.skipFreshHours)) {
            skippedProductCount += 1;
            processedDetailCount += 1;
            if (
              progressLogEvery > 0 &&
              processedDetailCount % progressLogEvery === 0
            ) {
              const recentPerformance = buildPerformanceWindowSummary(
                perf,
                progressSnapshot,
                processedDetailCount,
              );
              logger.info(`${logLabel} detail fetch progress`, {
                runId,
                contentType,
                progress,
                chunkIndex,
                chunkCount,
                fetchedProductCount,
                skippedProductCount,
                failedProductCount,
                performance: buildPerformanceSummary(
                  perf,
                  processedDetailCount,
                ),
                recentPerformance,
              });
              progressSnapshot = createPerformanceWindowSnapshot(
                perf,
                processedDetailCount,
              );
            }
            continue;
          }

          if (delayMs > 0) {
            const delayStartedAt = Date.now();
            await sleep(delayMs);
            perf.delayTotalMs += Date.now() - delayStartedAt;
          }

          let detailTiming: ProductDetailTiming | undefined;
          const raw = await dlsiteFemaleDoujinAdapter.fetchProductDetail(
            discovered.sourceProductId,
            {
              sourceUrl: discovered.sourceUrl,
              parseMode,
              htmlOnlyProbe,
              onTiming: (timing) => {
                detailTiming = timing;
              },
            },
          );
          addProductDetailTimingToPerformance(perf, detailTiming);
          addParseTimingToPerformance(perf, detailTiming?.parse);
          addHtmlSalesCountAjaxMismatchExample(
            perf,
            detailTiming,
            discovered.sourceProductId,
            discovered.sourceUrl,
          );

          const normalizeStartedAt = Date.now();
          const product = dlsiteFemaleDoujinAdapter.normalizeProduct(
            raw,
            target,
          );
          const normalizeElapsedMs = Date.now() - normalizeStartedAt;
          perf.normalizeProductTotalMs += normalizeElapsedMs;

          const saveResult = await enqueueProductAndMetricWrites(
            writeBuffer,
            product,
            date,
            {
              saveDailyMetrics,
              dailySalesDelta: saveDailySalesDelta
                ? {
                    enabled: true,
                    currentDate: date,
                    salesDate,
                    existingProduct,
                  }
                : undefined,
            },
          );
          perf.productAndMetricSaveTotalMs += saveResult.elapsedMs;
          perf.firestoreBatchCommitTotalMs +=
            saveResult.firestoreAutoFlushElapsedMs;
          perf.firestoreAutoFlushTotalMs +=
            saveResult.firestoreAutoFlushElapsedMs;
          perf.firestoreAutoFlushCount += saveResult.firestoreAutoFlushCount;
          perf.dailySalesDeltaCalcTotalMs +=
            saveResult.dailySalesDeltaCalcElapsedMs;
          perf.productWriteCount += saveResult.writeCount;
          perf.dailyMetricWriteCount += saveResult.dailyMetricWriteCount;
          perf.dailySalesPreviousMetricWriteCount +=
            saveResult.dailySalesPreviousMetricWriteCount;
          addDailySalesDeltaStatsToPerformance(
            perf,
            saveResult.dailySalesDeltaStats,
          );
          perf.firestoreBatchCommitCount = writeBuffer.commitCount;
          perf.firestoreWriteOperationCount = writeBuffer.writeOperationCount;
          perf.firestorePendingWriteCount =
            saveResult.writeBufferPendingWriteCount;
          fetchedProductCount += 1;
          updatedProductCount += 1;
          processedDetailCount += 1;

          if (
            progressLogEvery > 0 &&
            processedDetailCount % progressLogEvery === 0
          ) {
            const recentPerformance = buildPerformanceWindowSummary(
              perf,
              progressSnapshot,
              processedDetailCount,
            );
            logger.info(`${logLabel} detail fetch progress`, {
              runId,
              contentType,
              progress,
              chunkIndex,
              chunkCount,
              fetchedProductCount,
              skippedProductCount,
              failedProductCount,
              performance: buildPerformanceSummary(perf, processedDetailCount),
              recentPerformance,
            });
            progressSnapshot = createPerformanceWindowSnapshot(
              perf,
              processedDetailCount,
            );
          }
        } catch (error) {
          if (error instanceof BlockedAccessError) {
            blocked = true;
            const message = `blocked: ${discovered.sourceProductId}: ${error.message}`;
            errorMessages.push(message);
            logger.error(
              `${logLabel} detail fetch blocked; stop current batch`,
              {
                runId,
                contentType,
                sourceProductId: discovered.sourceProductId,
                progress,
                chunkIndex,
                message: error.message,
                performance: buildPerformanceSummary(
                  perf,
                  processedDetailCount,
                ),
              },
            );
            break;
          }

          failedProductCount += 1;
          processedDetailCount += 1;
          failedProductIds.push(discovered.sourceProductId);
          const message =
            error instanceof Error ? error.message : String(error);
          errorMessages.push(
            `failed: ${discovered.sourceProductId}: ${message}`,
          );
          logger.warn(
            `${logLabel} detail fetch failed; continue next product`,
            {
              runId,
              contentType,
              sourceProductId: discovered.sourceProductId,
              sourceUrl: discovered.sourceUrl,
              progress,
              chunkIndex,
              message,
              performance: buildPerformanceSummary(perf, processedDetailCount),
            },
          );
        }
      }

      const flushStartedAt = Date.now();
      const flushResult = await writeBuffer.flush();
      const flushTotalMs = Date.now() - flushStartedAt;
      perf.productAndMetricSaveTotalMs += flushTotalMs;
      perf.firestoreBatchCommitTotalMs += flushResult.elapsedMs;
      if (flushResult.flushed) {
        perf.firestoreChunkFlushTotalMs += flushResult.elapsedMs;
        perf.firestoreChunkFlushCount += 1;
      }
      perf.firestoreBatchCommitCount = writeBuffer.commitCount;
      perf.firestoreWriteOperationCount = writeBuffer.writeOperationCount;
      perf.firestorePendingWriteCount = writeBuffer.getPendingWriteCount();

      if (progressLogEvery > 0 && chunkDetailTargets.length > 0) {
        logger.info(`${logLabel} chunk finished`, {
          runId,
          contentType,
          chunkIndex,
          chunkCount,
          startPage: chunkStartPage,
          pagesToFetch: chunkPagesToFetch,
          fetchedProductCount,
          skippedProductCount,
          failedProductCount,
          performance: buildPerformanceSummary(perf, processedDetailCount),
        });
      }
    }

    for (const failedPage of failedPages) {
      errorMessages.push(
        `list page failed: page=${failedPage.page}: ${failedPage.message}`,
      );
    }

    if (listOnly) {
      logger.info(`${logLabel} detail fetch skipped`, {
        runId,
        contentType,
        dryRun,
        detailLimit: options.detailLimit,
        listedProductCount,
      });
    }

    const finishedAt = nowTimestamp();
    const status: BatchRun["status"] = blocked
      ? "blocked"
      : failedProductCount > 0 || failedPages.length > 0
        ? "partial"
        : "success";
    const resultRun: BatchRun = {
      ...run,
      status,
      finishedAt,
      fetchedProductCount,
      updatedProductCount,
      failedProductCount,
      skippedProductCount,
      errorMessages,
    };

    const finalRunWriteStartedAt = Date.now();
    await runRef.set(
      {
        ...resultRun,
        contentType,
        contentTypeId: `dlsite:${contentType}`,
        sourceTotalCount: totalCount,
        sourceTotalPages: totalPages,
        scannedPageCount: fetchedPageCount,
        listedProductCount,
        failedPages,
        performance: buildPerformanceSummary(perf, processedDetailCount),
      },
      { merge: true },
    );
    perf.batchRunsUpdateTotalMs += Date.now() - finalRunWriteStartedAt;
    perf.batchRunWriteCount += 1;

    const performance = buildPerformanceSummary(perf, processedDetailCount);
    logger.info(`${logLabel} batch finished`, {
      runId,
      contentType,
      status,
      requestedDetailCount,
      fetchedProductCount,
      skippedProductCount,
      failedProductCount,
      performance,
    });

    return {
      run: resultRun,
      options: buildResolvedRunOptions(),
      scan: {
        totalCount,
        totalPages,
        perPage,
        startPage,
        pagesToFetch,
        fetchedPageCount,
        listedProductCount,
        failedPages,
        pageResults,
      },
      details: {
        requestedCount: requestedDetailCount,
        fetchedCount: fetchedProductCount,
        skippedCount: skippedProductCount,
        failedCount: failedProductCount,
        failedProductIds,
      },
      performance,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status: BatchRun["status"] =
      error instanceof BlockedAccessError ? "blocked" : "failed";
    errorMessages.push(message);

    const resultRun: BatchRun = {
      ...run,
      status,
      finishedAt: nowTimestamp(),
      fetchedProductCount,
      updatedProductCount,
      failedProductCount,
      skippedProductCount,
      errorMessages,
    };

    const failedRunWriteStartedAt = Date.now();
    await runRef.set(
      {
        ...resultRun,
        contentType,
        contentTypeId: `dlsite:${contentType}`,
        performance: buildPerformanceSummary(perf, processedDetailCount),
      },
      { merge: true },
    );
    perf.batchRunsUpdateTotalMs += Date.now() - failedRunWriteStartedAt;
    perf.batchRunWriteCount += 1;

    return {
      run: resultRun,
      options: buildResolvedRunOptions(),
      scan: {
        totalCount,
        totalPages,
        perPage,
        startPage,
        pagesToFetch,
        fetchedPageCount,
        listedProductCount,
        failedPages,
        pageResults,
      },
      details: {
        requestedCount: requestedDetailCount,
        fetchedCount: fetchedProductCount,
        skippedCount: skippedProductCount,
        failedCount: failedProductCount,
        failedProductIds,
      },
      performance: buildPerformanceSummary(perf, processedDetailCount),
    };
  }
}
