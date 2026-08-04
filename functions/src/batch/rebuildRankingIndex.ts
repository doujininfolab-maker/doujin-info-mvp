import { randomBytes } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  CurrentDailyRevenueRanking,
  CurrentDailyRevenueRankingState,
  CurrentDailyRevenueRankingStateDocument,
  FetchTarget,
  HomeDailyRankingProductIds,
  Product,
  ProductContentType,
  ProductRankingMode,
  ProductWorkType,
  RankingIndexContentScope,
  RankingIndexEntry,
  RankingIndexListDocument,
  RankingIndexRootDocument,
  RankingIndexVersionDocument,
} from "../types";

const RANKING_INDEXES_COLLECTION = "rankingIndexes";
const RANKING_INDEX_SYNC_STATES_COLLECTION = "syncStates";
const CURRENT_DAILY_REVENUE_RANKING_STATE_DOCUMENT =
  "currentDailyRevenueRankings";
const PRODUCTS_COLLECTION = "products";
const SITE_STATS_COLLECTION = "siteStats";
const RANKING_INDEX_SCHEMA_VERSION = 1;
const RANKING_INDEX_LIMIT = 300;
const RANKING_INDEX_WRITE_BATCH_SIZE = 400;
const CONTENT_SCOPES: RankingIndexContentScope[] = ["all", "tl", "bl"];
const RANKING_MODES: ProductRankingMode[] = [
  "dailyRevenue",
  "daily",
  "weekly",
  "monthly",
  "cumulative",
];
const WORK_TYPES: Array<"all" | ProductWorkType> = [
  "all",
  "comic",
  "novel",
  "cg",
  "movie",
  "game",
  "voice",
  "other",
];
const CURRENT_DAILY_REVENUE_RANKING_TARGETS: Array<{
  contentScope: RankingIndexContentScope;
  listId: string;
}> = [
  { contentScope: "all", listId: "all_dailyRevenue_all" },
  { contentScope: "tl", listId: "tl_dailyRevenue_all" },
  { contentScope: "bl", listId: "bl_dailyRevenue_all" },
];

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

type RankingCandidate = {
  product: Product;
  salesCount: number;
  revenue: number;
  rankingValue: number;
  priceCurrent: number;
};

type ProductRankingPatch = Record<
  string,
  CurrentDailyRevenueRanking | FieldValue
>;

type CurrentDailyRevenueRankingSyncPlan = {
  nextStates: Partial<
    Record<RankingIndexContentScope, CurrentDailyRevenueRankingState>
  >;
  patchesByProductId: Map<string, ProductRankingPatch>;
  readyScopeCount: number;
  updatedRankingCount: number;
  deletedRankingCount: number;
};

export type RebuildRankingIndexResult = {
  segmentId: string;
  versionId: string;
  sourceDate?: string;
  sourceDates: Partial<Record<RankingIndexContentScope, string>>;
  listCount: number;
  readyListCount: number;
};

function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;

  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.toDate === "function" && typeof timestampLike.seconds === "number") {
    return value;
  }

  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cleanedItem = removeUndefinedDeep(item);
    if (cleanedItem !== undefined) cleaned[key] = cleanedItem;
  }
  return cleaned as T;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildSiteStatsId(segmentId: string, contentScope: RankingIndexContentScope): string {
  return contentScope === "all" ? segmentId : `${segmentId}_${contentScope}`;
}

function buildVersionId(date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}_${randomBytes(4).toString("hex")}`;
}

function isValidSourceDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{8}$/.test(value);
}

function normalizeRankingState(
  value: CurrentDailyRevenueRankingState | undefined,
): CurrentDailyRevenueRankingState | undefined {
  if (!value || !isValidSourceDate(value.sourceDate) || !Array.isArray(value.productIds)) {
    return undefined;
  }

  const productIds = [...new Set(
    value.productIds
      .filter((productId): productId is string => typeof productId === "string")
      .map((productId) => productId.trim())
      .filter(Boolean),
  )].slice(0, RANKING_INDEX_LIMIT);

  return {
    sourceDate: value.sourceDate,
    productIds,
  };
}

function getOrCreateProductRankingPatch(
  patchesByProductId: Map<string, ProductRankingPatch>,
  productId: string,
): ProductRankingPatch {
  const existing = patchesByProductId.get(productId);
  if (existing) return existing;

  const created: ProductRankingPatch = {};
  patchesByProductId.set(productId, created);
  return created;
}

function buildCurrentDailyRevenueRankingSyncPlan(params: {
  lists: RankingIndexListDocument[];
  previousStates?: Partial<
    Record<RankingIndexContentScope, CurrentDailyRevenueRankingState>
  >;
}): CurrentDailyRevenueRankingSyncPlan {
  const nextStates: Partial<
    Record<RankingIndexContentScope, CurrentDailyRevenueRankingState>
  > = {};
  const patchesByProductId = new Map<string, ProductRankingPatch>();
  let readyScopeCount = 0;
  let updatedRankingCount = 0;
  let deletedRankingCount = 0;

  for (const { contentScope, listId } of CURRENT_DAILY_REVENUE_RANKING_TARGETS) {
    const previousState = normalizeRankingState(params.previousStates?.[contentScope]);
    if (previousState) nextStates[contentScope] = previousState;

    const currentList = params.lists.find((list) => list.listId === listId);
    if (
      !currentList ||
      currentList.status !== "ready" ||
      currentList.contentScope !== contentScope ||
      currentList.rankingMode !== "dailyRevenue" ||
      currentList.workType !== "all" ||
      !isValidSourceDate(currentList.sourceDate) ||
      currentList.itemCount !== currentList.entries.length
    ) {
      continue;
    }

    const currentEntries = new Map<string, CurrentDailyRevenueRanking>();
    let entriesAreValid = true;
    for (const entry of currentList.entries) {
      const productId = entry.productId?.trim();
      if (
        !productId ||
        !Number.isInteger(entry.rank) ||
        entry.rank < 1 ||
        entry.rank > RANKING_INDEX_LIMIT ||
        currentEntries.has(productId)
      ) {
        entriesAreValid = false;
        break;
      }

      currentEntries.set(productId, {
        rank: entry.rank,
        sourceDate: currentList.sourceDate,
      });
    }
    if (!entriesAreValid) continue;

    readyScopeCount += 1;
    const fieldPath = `currentDailyRevenueRankings.${contentScope}`;
    for (const [productId, ranking] of currentEntries) {
      getOrCreateProductRankingPatch(patchesByProductId, productId)[fieldPath] = ranking;
      updatedRankingCount += 1;
    }

    for (const productId of previousState?.productIds ?? []) {
      if (currentEntries.has(productId)) continue;
      getOrCreateProductRankingPatch(patchesByProductId, productId)[fieldPath] =
        FieldValue.delete();
      deletedRankingCount += 1;
    }

    nextStates[contentScope] = {
      sourceDate: currentList.sourceDate,
      productIds: [...currentEntries.keys()],
    };
  }

  return {
    nextStates,
    patchesByProductId,
    readyScopeCount,
    updatedRankingCount,
    deletedRankingCount,
  };
}

export function buildRankingIndexListId(
  contentScope: RankingIndexContentScope,
  rankingMode: ProductRankingMode,
  workType: "all" | ProductWorkType,
): string {
  return `${contentScope}_${rankingMode}_${workType}`;
}

function normalizeStoredContentType(value: string | undefined): ProductContentType | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

function productHasContentScope(product: Product, contentScope: RankingIndexContentScope): boolean {
  if (contentScope === "all") return true;
  const ids = (product.contentTypeIds ?? []).map((id) => normalizeStoredContentType(id));
  if (ids.includes(contentScope)) return true;
  const labels = (product.contentTypes ?? []).map((label) => normalizeStoredContentType(label));
  return labels.includes(contentScope);
}

function resolveSourceDate(products: Product[]): string | undefined {
  const counts = new Map<string, number>();
  for (const product of products) {
    const sourceDate = product.rankingMetrics?.sourceDate;
    if (!sourceDate || !/^\d{8}$/.test(sourceDate)) continue;
    counts.set(sourceDate, (counts.get(sourceDate) ?? 0) + 1);
  }

  const entries = [...counts.entries()];
  const maxCount = Math.max(0, ...entries.map(([, count]) => count));
  const minimumCoverageCount = Math.min(
    100,
    Math.max(2, Math.ceil(products.length * 0.01)),
  );
  const minimumRepresentativeCount = Math.max(
    minimumCoverageCount,
    Math.ceil(maxCount * 0.25),
  );
  return entries
    .filter(([, count]) => count >= minimumRepresentativeCount)
    .sort((left, right) => right[0].localeCompare(left[0]))[0]?.[0];
}

function resolveSourceDates(
  products: Product[],
): Partial<Record<RankingIndexContentScope, string>> {
  const activeProducts = products.filter((product) => product.isActive !== false);
  const tlProducts = activeProducts.filter((product) => productHasContentScope(product, "tl"));
  const blProducts = activeProducts.filter((product) => productHasContentScope(product, "bl"));
  const tl = tlProducts.length > 0 ? resolveSourceDate(tlProducts) : undefined;
  const bl = blProducts.length > 0 ? resolveSourceDate(blProducts) : undefined;

  let all: string | undefined;
  if (tl && bl) {
    if (tl === bl) all = tl;
  } else {
    all = tl ?? bl ?? resolveSourceDate(activeProducts);
  }

  return removeUndefinedDeep({ all, tl, bl });
}

function latestSourceDate(
  sourceDates: Partial<Record<RankingIndexContentScope, string>>,
): string | undefined {
  return Object.values(sourceDates)
    .filter((value): value is string => typeof value === "string")
    .sort((left, right) => right.localeCompare(left))[0];
}

function toRankingCandidate(
  product: Product,
  rankingMode: ProductRankingMode,
  sourceDate: string | undefined,
): RankingCandidate | undefined {
  const priceCurrent = product.priceCurrent;
  if (!isFiniteNumber(priceCurrent) || priceCurrent <= 0) return undefined;

  const metrics = product.rankingMetrics;
  const cumulativeSalesCount = isFiniteNumber(product.salesCount)
    ? Math.max(0, product.salesCount)
    : metrics?.cumulativeSalesCount;

  if (rankingMode === "cumulative") {
    if (!isFiniteNumber(cumulativeSalesCount)) return undefined;
    return {
      product,
      salesCount: cumulativeSalesCount,
      revenue: cumulativeSalesCount * priceCurrent,
      rankingValue: cumulativeSalesCount,
      priceCurrent,
    };
  }

  if (!metrics || !sourceDate || metrics.sourceDate !== sourceDate) return undefined;

  if (rankingMode === "dailyRevenue" || rankingMode === "daily") {
    if (!metrics.dailyAvailable || !isFiniteNumber(metrics.dailySalesCount)) return undefined;
    const dailySalesCount = Math.max(0, metrics.dailySalesCount);
    const dailyRevenue = dailySalesCount * priceCurrent;
    return {
      product,
      salesCount: dailySalesCount,
      revenue: dailyRevenue,
      rankingValue: rankingMode === "dailyRevenue" ? dailyRevenue : dailySalesCount,
      priceCurrent,
    };
  }

  if (rankingMode === "weekly") {
    if (!metrics.weeklyAvailable || !isFiniteNumber(metrics.weeklySalesCount)) return undefined;
    const weeklySalesCount = Math.max(0, metrics.weeklySalesCount);
    return {
      product,
      salesCount: weeklySalesCount,
      revenue: weeklySalesCount * priceCurrent,
      rankingValue: weeklySalesCount,
      priceCurrent,
    };
  }

  if (!metrics.monthlyAvailable || !isFiniteNumber(metrics.monthlySalesCount)) return undefined;
  const monthlySalesCount = Math.max(0, metrics.monthlySalesCount);
  return {
    product,
    salesCount: monthlySalesCount,
    revenue: monthlySalesCount * priceCurrent,
    rankingValue: monthlySalesCount,
    priceCurrent,
  };
}

function sortCandidates(
  candidates: RankingCandidate[],
  rankingMode: ProductRankingMode,
): RankingCandidate[] {
  return [...candidates].sort((left, right) => {
    const rankingValueDiff = right.rankingValue - left.rankingValue;
    if (rankingValueDiff !== 0) return rankingValueDiff;

    if (rankingMode === "dailyRevenue") {
      const salesDiff = right.salesCount - left.salesCount;
      if (salesDiff !== 0) return salesDiff;
    } else {
      const revenueDiff = right.revenue - left.revenue;
      if (revenueDiff !== 0) return revenueDiff;
    }

    const cumulativeSalesDiff =
      (right.product.salesCount ?? 0) - (left.product.salesCount ?? 0);
    if (cumulativeSalesDiff !== 0) return cumulativeSalesDiff;

    const ratingDiff =
      (right.product.rating ?? right.product.ratingAverage ?? 0) -
      (left.product.rating ?? left.product.ratingAverage ?? 0);
    if (ratingDiff !== 0) return ratingDiff;

    return left.product.productId.localeCompare(right.product.productId);
  });
}

function buildEntries(candidates: RankingCandidate[]): RankingIndexEntry[] {
  return candidates.slice(0, RANKING_INDEX_LIMIT).map((candidate, index) =>
    removeUndefinedDeep({
      rank: index + 1,
      productId: candidate.product.productId,
      rankingValue: candidate.rankingValue,
      salesCount: candidate.salesCount,
      revenue: candidate.revenue,
      priceCurrent: candidate.priceCurrent,
    }),
  );
}

async function commitSetOperations(
  operations: Array<{ ref: DocumentReference; data: Record<string, unknown> }>,
): Promise<void> {
  for (let index = 0; index < operations.length; index += RANKING_INDEX_WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + RANKING_INDEX_WRITE_BATCH_SIZE)) {
      batch.set(operation.ref, operation.data, { merge: false });
    }
    await batch.commit();
  }
}

async function commitProductRankingPatches(
  patchesByProductId: Map<string, ProductRankingPatch>,
): Promise<void> {
  const operations = [...patchesByProductId.entries()];
  for (let index = 0; index < operations.length; index += RANKING_INDEX_WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const [productId, patch] of operations.slice(
      index,
      index + RANKING_INDEX_WRITE_BATCH_SIZE,
    )) {
      batch.update(db.collection(PRODUCTS_COLLECTION).doc(productId), patch);
    }
    await batch.commit();
  }
}

async function deleteVersion(versionRef: DocumentReference): Promise<void> {
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) return;
  const version = versionSnapshot.data() as Partial<RankingIndexVersionDocument>;
  const listIds = Array.isArray(version.listIds)
    ? version.listIds.filter((value): value is string => typeof value === "string")
    : [];
  const deleteRefs = [
    ...listIds.map((listId) => versionRef.collection("lists").doc(listId)),
    versionRef,
  ];

  for (let index = 0; index < deleteRefs.length; index += RANKING_INDEX_WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of deleteRefs.slice(index, index + RANKING_INDEX_WRITE_BATCH_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function saveHomeRankingCaches(params: {
  segmentId: string;
  lists: RankingIndexListDocument[];
  generatedAt: Timestamp;
}): Promise<void> {
  for (const contentScope of CONTENT_SCOPES) {
    const dailyRevenueLists = params.lists.filter(
      (list) =>
        list.contentScope === contentScope &&
        list.rankingMode === "dailyRevenue" &&
        list.status === "ready",
    );
    const allWorkTypesList = dailyRevenueLists.find(
      (list) => list.workType === "all" && list.entries.length > 0,
    );
    if (!allWorkTypesList?.sourceDate) continue;

    const homeDailyRankingProductIds: HomeDailyRankingProductIds = {};
    for (const workType of WORK_TYPES) {
      const list = dailyRevenueLists.find((item) => item.workType === workType);
      homeDailyRankingProductIds[workType] = list?.entries
        .slice(0, 10)
        .map((entry) => entry.productId) ?? [];
    }

    await db.collection(SITE_STATS_COLLECTION).doc(
      buildSiteStatsId(params.segmentId, contentScope),
    ).set(
      {
        homeDailyRankingProductIds,
        homeDailyRankingDate: allWorkTypesList.sourceDate,
        homeDailyRankingStrategy: "dailyRevenue_v1",
        homeDailyRankingUpdatedAt: params.generatedAt,
      },
      { merge: true },
    );
  }
}

export async function rebuildRankingIndex(
  segment: SiteSegmentKey,
  products: Product[],
  generatedAt: Timestamp,
): Promise<RebuildRankingIndexResult> {
  const segmentId = buildSegmentId(segment);
  const versionId = buildVersionId(generatedAt.toDate());
  const sourceDates = resolveSourceDates(products);
  const sourceDate = sourceDates.all ?? latestSourceDate(sourceDates);
  const rootRef = db.collection(RANKING_INDEXES_COLLECTION).doc(segmentId);
  const versionsRef = rootRef.collection("versions");
  const versionRef = versionsRef.doc(versionId);
  const currentDailyRevenueRankingStateRef = rootRef
    .collection(RANKING_INDEX_SYNC_STATES_COLLECTION)
    .doc(CURRENT_DAILY_REVENUE_RANKING_STATE_DOCUMENT);
  const [previousRootSnapshot, currentDailyRevenueRankingStateSnapshot] =
    await Promise.all([
      rootRef.get(),
      currentDailyRevenueRankingStateRef.get(),
    ]);
  const previousRoot = previousRootSnapshot.exists
    ? previousRootSnapshot.data() as Partial<RankingIndexRootDocument>
    : undefined;
  const previousCurrentDailyRevenueRankingState =
    currentDailyRevenueRankingStateSnapshot.exists
      ? currentDailyRevenueRankingStateSnapshot.data() as Partial<
          CurrentDailyRevenueRankingStateDocument
        >
      : undefined;
  const previousActiveVersion = typeof previousRoot?.activeVersion === "string"
    ? previousRoot.activeVersion
    : undefined;
  const versionToDelete = typeof previousRoot?.previousVersion === "string"
    ? previousRoot.previousVersion
    : undefined;

  const lists: RankingIndexListDocument[] = [];
  const fallbackCumulativeSourceDate = sourceDate;
  for (const contentScope of CONTENT_SCOPES) {
    const scopeProducts = products.filter(
      (product) => product.isActive !== false && productHasContentScope(product, contentScope),
    );
    const scopeSourceDate = sourceDates[contentScope];

    for (const rankingMode of RANKING_MODES) {
      const listSourceDate = rankingMode === "cumulative"
        ? scopeSourceDate ?? fallbackCumulativeSourceDate
        : scopeSourceDate;
      const modeCandidates = sortCandidates(
        scopeProducts
          .map((product) => toRankingCandidate(product, rankingMode, listSourceDate))
          .filter((candidate): candidate is RankingCandidate => Boolean(candidate)),
        rankingMode,
      );

      for (const workType of WORK_TYPES) {
        const candidates = workType === "all"
          ? modeCandidates
          : modeCandidates.filter((candidate) => candidate.product.workType === workType);
        const entries = buildEntries(candidates);
        const listId = buildRankingIndexListId(contentScope, rankingMode, workType);
        lists.push({
          listId,
          versionId,
          segmentId,
          contentScope,
          rankingMode,
          workType,
          sourceDate: listSourceDate,
          status:
            rankingMode === "cumulative" || Boolean(listSourceDate)
              ? "ready"
              : "insufficient_data",
          itemCount: entries.length,
          entries,
          generatedAt,
        });
      }
    }
  }

  const totalEntryCount = lists.reduce((sum, list) => sum + list.itemCount, 0);
  if (totalEntryCount === 0 && previousActiveVersion) {
    throw new Error(
      `ranking index rebuild produced no entries for ${segmentId}; keeping ${previousActiveVersion}`,
    );
  }

  const listIds = lists.map((list) => list.listId);
  const currentDailyRevenueRankingSyncPlan =
    buildCurrentDailyRevenueRankingSyncPlan({
      lists,
      previousStates: previousCurrentDailyRevenueRankingState?.states,
    });
  const buildingVersion: RankingIndexVersionDocument = {
    versionId,
    segmentId,
    schemaVersion: RANKING_INDEX_SCHEMA_VERSION,
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    status: "building",
    sourceDate,
    sourceDates,
    listCount: lists.length,
    listIds,
    generatedAt,
    updatedAt: generatedAt,
  };
  let activated = false;

  try {
    await versionRef.set(removeUndefinedDeep(buildingVersion), { merge: false });
    await commitSetOperations(
      lists.map((list) => ({
        ref: versionRef.collection("lists").doc(list.listId),
        data: removeUndefinedDeep(list) as Record<string, unknown>,
      })),
    );

    const readyVersion: RankingIndexVersionDocument = {
      ...buildingVersion,
      status: "ready",
      updatedAt: generatedAt,
    };
    await versionRef.set(removeUndefinedDeep(readyVersion), { merge: false });

    await commitProductRankingPatches(
      currentDailyRevenueRankingSyncPlan.patchesByProductId,
    );

    if (currentDailyRevenueRankingSyncPlan.readyScopeCount > 0) {
      const stateDocument: CurrentDailyRevenueRankingStateDocument = {
        segmentId,
        states: currentDailyRevenueRankingSyncPlan.nextStates,
        updatedAt: generatedAt,
      };
      await currentDailyRevenueRankingStateRef.set(
        removeUndefinedDeep(stateDocument),
        { merge: false },
      );
    }

    const rootDocument: RankingIndexRootDocument = {
      segmentId,
      schemaVersion: RANKING_INDEX_SCHEMA_VERSION,
      platform: segment.platform,
      audience: segment.audience,
      category: segment.category,
      activeVersion: versionId,
      previousVersion: previousActiveVersion,
      sourceDate,
      sourceDates,
      listCount: lists.length,
      listIds,
      generatedAt,
      updatedAt: generatedAt,
    };
    await rootRef.set(removeUndefinedDeep(rootDocument), { merge: false });
    activated = true;

    console.log("Current daily revenue rankings synchronized to products", {
      segmentId,
      readyScopeCount: currentDailyRevenueRankingSyncPlan.readyScopeCount,
      productWriteCount:
        currentDailyRevenueRankingSyncPlan.patchesByProductId.size,
      updatedRankingCount:
        currentDailyRevenueRankingSyncPlan.updatedRankingCount,
      deletedRankingCount:
        currentDailyRevenueRankingSyncPlan.deletedRankingCount,
    });

    await saveHomeRankingCaches({ segmentId, lists, generatedAt });

    if (
      versionToDelete &&
      versionToDelete !== versionId &&
      versionToDelete !== previousActiveVersion
    ) {
      try {
        await deleteVersion(versionsRef.doc(versionToDelete));
      } catch (error) {
        console.warn("Failed to delete old ranking index version", {
          segmentId,
          versionId: versionToDelete,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      segmentId,
      versionId,
      sourceDate,
      sourceDates,
      listCount: lists.length,
      readyListCount: lists.filter((list) => list.status === "ready").length,
    };
  } catch (error) {
    if (!activated) {
      try {
        await deleteVersion(versionRef);
      } catch (cleanupError) {
        console.warn("Failed to clean up incomplete ranking index version", {
          segmentId,
          versionId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    throw error;
  }
}
