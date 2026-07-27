import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  Product,
  ProductDailyMetric,
  ProductSalesSnapshot,
} from "../types";
import { nowTimestamp } from "../util";
import {
  addDaysToDateKey,
  buildRankingState,
  resolveDailySalesCountFromMetric,
} from "./rankingMetrics";

const PRODUCTS_COLLECTION = "products";
const PRODUCT_PAGE_SIZE = 250;
const METRIC_GET_ALL_CHUNK_SIZE = 500;
const METRIC_GET_ALL_CONCURRENCY = 4;
const WRITE_BATCH_SIZE = 400;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

export type BackfillRankingMetricsOptions = {
  sourceDate: string;
  maxProducts?: number;
  startAfterProductId?: string;
};

export type BackfillRankingMetricsResult = {
  segmentId: string;
  sourceDate: string;
  processedProductCount: number;
  updatedProductCount: number;
  skippedProductCount: number;
  requestedMetricReadCount: number;
  existingMetricCount: number;
  nextCursor?: string;
  complete: boolean;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildDateKeys(sourceDate: string): string[] {
  return Array.from({ length: 31 }, (_, index) =>
    addDaysToDateKey(sourceDate, index - 30),
  );
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadMetricsForProducts(
  products: Array<{ documentId: string; product: Product }>,
  dateKeys: string[],
): Promise<{
  metricsByProductId: Map<string, Map<string, ProductDailyMetric>>;
  requestedReadCount: number;
  existingMetricCount: number;
}> {
  const refs = products.flatMap(({ documentId }) =>
    dateKeys.map((date) =>
      db.collection(PRODUCTS_COLLECTION).doc(documentId).collection("dailyMetrics").doc(date),
    ),
  );
  const chunks = chunkArray(refs, METRIC_GET_ALL_CHUNK_SIZE);
  const metricsByProductId = new Map<string, Map<string, ProductDailyMetric>>();
  let existingMetricCount = 0;

  for (let index = 0; index < chunks.length; index += METRIC_GET_ALL_CONCURRENCY) {
    const snapshotsByChunk = await Promise.all(
      chunks
        .slice(index, index + METRIC_GET_ALL_CONCURRENCY)
        .map((chunk) => db.getAll(...chunk)),
    );
    for (const snapshot of snapshotsByChunk.flat()) {
      if (!snapshot.exists) continue;
      const productId = snapshot.ref.parent.parent?.id;
      if (!productId) continue;
      const metric = snapshot.data() as ProductDailyMetric;
      const date = snapshot.id;
      const productMetrics = metricsByProductId.get(productId) ?? new Map<string, ProductDailyMetric>();
      productMetrics.set(date, metric);
      metricsByProductId.set(productId, productMetrics);
      existingMetricCount += 1;
    }
  }

  return {
    metricsByProductId,
    requestedReadCount: refs.length,
    existingMetricCount,
  };
}

function buildSnapshots(metrics: Map<string, ProductDailyMetric> | undefined): ProductSalesSnapshot[] {
  if (!metrics) return [];
  return [...metrics.entries()]
    .filter(([, metric]) => isFiniteNumber(metric.salesCount))
    .map(([date, metric]) => ({
      date,
      salesCount: metric.salesCount as number,
      priceCurrent: isFiniteNumber(metric.priceCurrent) ? metric.priceCurrent : undefined,
    }));
}

function resolveSourceSalesCount(
  product: Product,
  sourceMetric: ProductDailyMetric | undefined,
  sourceDate: string,
): number | undefined {
  if (isFiniteNumber(sourceMetric?.salesCount)) return sourceMetric.salesCount;
  const recentSnapshot = product.recentSalesSnapshots?.find((snapshot) => snapshot.date === sourceDate);
  if (isFiniteNumber(recentSnapshot?.salesCount)) return recentSnapshot.salesCount;
  if (
    product.lastDailySalesSnapshotDate === sourceDate &&
    isFiniteNumber(product.lastDailySalesSnapshotCount)
  ) {
    return product.lastDailySalesSnapshotCount;
  }
  return undefined;
}

async function writeProductPatches(
  patches: Array<{ documentId: string; data: Record<string, unknown> }>,
): Promise<void> {
  for (let index = 0; index < patches.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const patch of patches.slice(index, index + WRITE_BATCH_SIZE)) {
      batch.set(db.collection(PRODUCTS_COLLECTION).doc(patch.documentId), patch.data, { merge: true });
    }
    await batch.commit();
  }
}

export async function backfillRankingMetrics(
  segment: SiteSegmentKey,
  options: BackfillRankingMetricsOptions,
): Promise<BackfillRankingMetricsResult> {
  const maxProducts = Math.max(1, Math.floor(options.maxProducts ?? 20_000));
  const dateKeys = buildDateKeys(options.sourceDate);
  const previousDate = addDaysToDateKey(options.sourceDate, -1);
  let lastDoc: QueryDocumentSnapshot | undefined;
  let cursor = options.startAfterProductId;
  let processedProductCount = 0;
  let updatedProductCount = 0;
  let skippedProductCount = 0;
  let requestedMetricReadCount = 0;
  let existingMetricCount = 0;
  let complete = false;

  while (processedProductCount < maxProducts) {
    const remaining = maxProducts - processedProductCount;
    const pageSize = Math.min(PRODUCT_PAGE_SIZE, remaining);
    let query = db
      .collection(PRODUCTS_COLLECTION)
      .where("platform", "==", segment.platform)
      .where("audience", "==", segment.audience)
      .where("category", "==", segment.category)
      .where("isActive", "==", true)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    } else if (cursor) {
      query = query.startAfter(cursor);
    }

    const productSnapshot = await query.get();
    if (productSnapshot.empty) {
      complete = true;
      cursor = undefined;
      break;
    }

    const products = productSnapshot.docs.map((doc) => ({
      documentId: doc.id,
      product: {
        ...(doc.data() as Product),
        productId: (doc.data() as Product).productId ?? doc.id,
      },
    }));
    const metricLoad = await loadMetricsForProducts(products, dateKeys);
    requestedMetricReadCount += metricLoad.requestedReadCount;
    existingMetricCount += metricLoad.existingMetricCount;
    const calculatedAt = nowTimestamp();
    const patches: Array<{ documentId: string; data: Record<string, unknown> }> = [];

    for (const { documentId, product } of products) {
      const metrics = metricLoad.metricsByProductId.get(documentId);
      const sourceMetric = metrics?.get(options.sourceDate);
      const sourceSalesCount = resolveSourceSalesCount(product, sourceMetric, options.sourceDate);
      if (!isFiniteNumber(sourceSalesCount)) {
        skippedProductCount += 1;
        continue;
      }

      const priceCurrent = isFiniteNumber(sourceMetric?.priceCurrent)
        ? sourceMetric.priceCurrent
        : isFiniteNumber(product.priceCurrent)
          ? product.priceCurrent
          : 0;
      const rankingState = buildRankingState({
        product,
        sourceDate: options.sourceDate,
        sourceSalesCount,
        priceCurrent,
        additionalSnapshots: buildSnapshots(metrics),
        dailySalesCount: resolveDailySalesCountFromMetric(
          sourceMetric,
          metrics?.get(previousDate),
        ),
        calculatedAt,
      });
      patches.push({
        documentId,
        data: {
          recentSalesSnapshots: rankingState.recentSalesSnapshots,
          rankingMetrics: rankingState.rankingMetrics,
        },
      });
      updatedProductCount += 1;
    }

    await writeProductPatches(patches);
    processedProductCount += products.length;
    lastDoc = productSnapshot.docs[productSnapshot.docs.length - 1];
    cursor = lastDoc?.id;

    if (productSnapshot.size < pageSize) {
      complete = true;
      cursor = undefined;
      break;
    }
  }

  return {
    segmentId: buildSegmentId(segment),
    sourceDate: options.sourceDate,
    processedProductCount,
    updatedProductCount,
    skippedProductCount,
    requestedMetricReadCount,
    existingMetricCount,
    nextCursor: complete ? undefined : cursor,
    complete,
  };
}
