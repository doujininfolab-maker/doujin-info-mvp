import { randomUUID } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  HomeDashboardListViewCommonPayload,
  HomeDashboardListViewManifestDocument,
  HomeDashboardListViewProductPayload,
  HomeDashboardListViewSectionDescriptor,
  HomeDashboardListViewVersionDocument,
  HomeDashboardStatsSnapshot,
  HomeDashboardViewDocument,
  HomeRankingWorkType,
  Product,
  ProductCardItem,
  ProductCategorySummary,
  RankingIndexEntry,
  RankingIndexListDocument,
  RankingIndexRootDocument,
  RankingIndexVersionDocument,
  SiteStatsDocument,
} from "../types";
import { nowTimestamp } from "../util";
import {
  HOME_DASHBOARD_COMMON_SECTION_ID,
  HOME_DASHBOARD_LIST_VIEW_SCHEMA_VERSION,
  buildCompressedHomeDashboardSection,
  buildHomeDashboardNewSectionId,
  buildHomeDashboardRankingSectionId,
  type BuiltHomeDashboardSection,
} from "./listViews/homeDashboardListViewShared";
import {
  NEW_LIST_VIEW_WORK_TYPES,
  removeUndefinedDeep,
  toProductCardItem,
} from "./listViews/newListViewShared";

const SITE_STATS_COLLECTION = "siteStats";
const SOURCE_HOME_VIEW_COLLECTION = "views";
const SOURCE_HOME_VIEW_DOCUMENT_ID = "home";
const SOURCE_RANKING_INDEXES_COLLECTION = "rankingIndexes";
const HOME_DASHBOARD_LIST_VIEWS_COLLECTION = "homeDashboardListViews";
const SCOPES_SUBCOLLECTION = "homeDashboardListViewScopes";
const VERSIONS_SUBCOLLECTION = "homeDashboardListViewVersions";
const SECTIONS_SUBCOLLECTION = "homeDashboardListViewSections";
const SOURCE_RANKING_SCHEMA_VERSION = 1;
const DELETE_BATCH_SIZE = 400;

const CONTENT_SCOPES = ["all", "tl", "bl"] as const;
type HomeContentScope = (typeof CONTENT_SCOPES)[number];
type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

type LoadedRankingSource = {
  rootRef: DocumentReference;
  versionId: string;
  entriesByScopeAndWorkType: Map<string, RankingIndexEntry[]>;
  sourceDateByScopeAndWorkType: Map<string, string | undefined>;
};

type LoadedScopeSource = {
  contentScope: HomeContentScope;
  statId: string;
  statRef: DocumentReference;
  homeViewRef: DocumentReference;
  siteStats: SiteStatsDocument;
  homeView: HomeDashboardViewDocument;
  siteStatsUpdatedAtMillis: number;
  homeViewUpdatedAtMillis: number;
};

type PreparedScope = {
  source: LoadedScopeSource;
  scopeRef: DocumentReference;
  version: HomeDashboardListViewVersionDocument;
  sections: BuiltHomeDashboardSection[];
  productReadCount: number;
};

type ActivationResult =
  | {
      activated: true;
      previousVersion?: string;
      staleVersion?: string;
    }
  | {
      activated: false;
      reason:
        | "newer_run_already_active"
        | "source_site_stats_changed"
        | "source_home_view_changed"
        | "source_ranking_version_changed";
    };

export type RebuildHomeDashboardListViewScopeResult = {
  contentScope: HomeContentScope;
  statId: string;
  status: "activated" | "rejected";
  reason?: string;
  versionId?: string;
  previousVersion?: string;
  sectionCount: number;
  compressedBytes: number;
  productReadCount: number;
  cleanupDeletedVersion?: string;
  cleanupError?: string;
};

export type RebuildHomeDashboardListViewResult = {
  segmentId: string;
  runId: string;
  startedAtMillis: number;
  sourceRankingVersionId: string;
  scopeCount: number;
  activatedScopeCount: number;
  rejectedScopeCount: number;
  totalSectionCount: number;
  totalCompressedBytes: number;
  totalProductReadCount: number;
  elapsedMs: number;
  scopes?: RebuildHomeDashboardListViewScopeResult[];
};

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildStatId(segment: SiteSegmentKey, contentScope: HomeContentScope): string {
  const segmentId = buildSegmentId(segment);
  return contentScope === "all" ? segmentId : `${segmentId}_${contentScope}`;
}

function buildRunId(startedAtMillis: number): string {
  return `${new Date(startedAtMillis).toISOString().replace(/\D/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
}

function timestampMillis(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const timestamp = value as {
    toMillis?: () => number;
    seconds?: number;
    nanoseconds?: number;
  };
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  if (typeof timestamp.seconds === "number") {
    return timestamp.seconds * 1000 + Math.floor((timestamp.nanoseconds ?? 0) / 1_000_000);
  }
  return undefined;
}

function isNewerRun(
  existingStartedAtMillis: number | undefined,
  existingRunId: string | undefined,
  nextStartedAtMillis: number,
  nextRunId: string,
): boolean {
  if (typeof existingStartedAtMillis !== "number") return false;
  if (existingStartedAtMillis > nextStartedAtMillis) return true;
  if (existingStartedAtMillis < nextStartedAtMillis) return false;
  return typeof existingRunId === "string" && existingRunId > nextRunId;
}

function isValidHomeView(value: unknown, statId: string, contentScope: HomeContentScope): value is HomeDashboardViewDocument {
  if (!value || typeof value !== "object") return false;
  const view = value as Partial<HomeDashboardViewDocument>;
  return (
    view.schemaVersion === 1 &&
    view.strategy === "homeDashboard_v1" &&
    view.statId === statId &&
    view.contentScope === contentScope &&
    Boolean(view.newCandidateProductIdsByWorkType) &&
    Array.isArray(view.recentCandidateProductIds) &&
    Array.isArray(view.saleCandidateProductIds) &&
    Array.isArray(view.weeklyCircleCandidates) &&
    timestampMillis(view.updatedAt) !== undefined
  );
}

function uniqueIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))]
    : [];
}

function normalizeStats(siteStats: SiteStatsDocument): HomeDashboardStatsSnapshot {
  const popularGenres = Array.isArray(siteStats.popularGenres)
    ? siteStats.popularGenres.filter(
        (genre) => Boolean(genre?.name && genre?.genreId),
      )
    : [];
  const popularCategories = Array.isArray(siteStats.popularCategories)
    ? siteStats.popularCategories.filter(
        (category): category is ProductCategorySummary =>
          Boolean(
            category?.name &&
              category?.categoryId &&
              category?.kind &&
              category?.value,
          ),
      )
    : [];
  return {
    productCount: Number.isFinite(siteStats.productCount) ? siteStats.productCount : 0,
    todayUpdatedCount: Number.isFinite(siteStats.todayUpdatedCount) ? siteStats.todayUpdatedCount : 0,
    saleCount: Number.isFinite(siteStats.saleCount) ? siteStats.saleCount : 0,
    topGenre: siteStats.topGenre ?? popularGenres[0],
    popularGenres,
    popularCategories,
  };
}

async function loadRankingSource(segmentId: string): Promise<LoadedRankingSource> {
  const rootRef = db.collection(SOURCE_RANKING_INDEXES_COLLECTION).doc(segmentId);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) {
    throw new Error(`Ranking index root is missing: ${segmentId}`);
  }
  const root = rootSnapshot.data() as Partial<RankingIndexRootDocument>;
  if (
    root.schemaVersion !== SOURCE_RANKING_SCHEMA_VERSION ||
    root.segmentId !== segmentId ||
    typeof root.activeVersion !== "string" ||
    root.activeVersion.length === 0
  ) {
    throw new Error(`Ranking index root is invalid: ${segmentId}`);
  }
  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    throw new Error(`Ranking index version is missing: ${segmentId}/${root.activeVersion}`);
  }
  const version = versionSnapshot.data() as Partial<RankingIndexVersionDocument>;
  if (
    version.schemaVersion !== SOURCE_RANKING_SCHEMA_VERSION ||
    version.segmentId !== segmentId ||
    version.versionId !== root.activeVersion ||
    version.status !== "ready"
  ) {
    throw new Error(`Ranking index version is invalid: ${segmentId}/${root.activeVersion}`);
  }

  const specs = CONTENT_SCOPES.flatMap((scope) =>
    NEW_LIST_VIEW_WORK_TYPES.map((workType) => ({
      scope,
      workType,
      listId: `${scope}_dailyRevenue_${workType}`,
    })),
  );
  const refs = specs.map((spec) => versionRef.collection("lists").doc(spec.listId));
  const snapshots = await db.getAll(...refs);
  const entriesByScopeAndWorkType = new Map<string, RankingIndexEntry[]>();
  const sourceDateByScopeAndWorkType = new Map<string, string | undefined>();

  for (let index = 0; index < specs.length; index += 1) {
    const spec = specs[index];
    const snapshot = snapshots[index];
    if (!snapshot.exists) {
      throw new Error(`Ranking index list is missing: ${segmentId}/${root.activeVersion}/${spec.listId}`);
    }
    const list = snapshot.data() as Partial<RankingIndexListDocument>;
    if (
      list.versionId !== root.activeVersion ||
      list.segmentId !== segmentId ||
      list.listId !== spec.listId ||
      list.contentScope !== spec.scope ||
      list.rankingMode !== "dailyRevenue" ||
      list.workType !== spec.workType ||
      (list.status !== "ready" && list.status !== "insufficient_data") ||
      !Array.isArray(list.entries)
    ) {
      throw new Error(`Ranking index list is invalid: ${segmentId}/${root.activeVersion}/${spec.listId}`);
    }
    const key = `${spec.scope}_${spec.workType}`;
    entriesByScopeAndWorkType.set(
      key,
      list.status === "ready" ? list.entries.slice(0, 10) : [],
    );
    sourceDateByScopeAndWorkType.set(key, list.sourceDate);
  }

  return {
    rootRef,
    versionId: root.activeVersion,
    entriesByScopeAndWorkType,
    sourceDateByScopeAndWorkType,
  };
}

async function loadScopeSource(
  segment: SiteSegmentKey,
  contentScope: HomeContentScope,
): Promise<LoadedScopeSource> {
  const statId = buildStatId(segment, contentScope);
  const statRef = db.collection(SITE_STATS_COLLECTION).doc(statId);
  const homeViewRef = statRef
    .collection(SOURCE_HOME_VIEW_COLLECTION)
    .doc(SOURCE_HOME_VIEW_DOCUMENT_ID);
  const [statsSnapshot, homeViewSnapshot] = await db.getAll(statRef, homeViewRef);
  if (!statsSnapshot.exists) throw new Error(`siteStats is missing: ${statId}`);
  if (!homeViewSnapshot.exists) throw new Error(`Home view v1 is missing: ${statId}`);

  const siteStats = {
    ...(statsSnapshot.data() as SiteStatsDocument),
    statId,
  };
  const homeViewData = homeViewSnapshot.data();
  if (!isValidHomeView(homeViewData, statId, contentScope)) {
    throw new Error(`Home view v1 is invalid: ${statId}`);
  }
  const siteStatsUpdatedAtMillis = timestampMillis(siteStats.updatedAt);
  const homeViewUpdatedAtMillis = timestampMillis(homeViewData.updatedAt);
  if (
    siteStatsUpdatedAtMillis === undefined ||
    homeViewUpdatedAtMillis === undefined
  ) {
    throw new Error(`Home source timestamps are invalid: ${statId}`);
  }

  for (const workType of NEW_LIST_VIEW_WORK_TYPES) {
    if (
      !Object.prototype.hasOwnProperty.call(
        homeViewData.newCandidateProductIdsByWorkType,
        workType,
      )
    ) {
      throw new Error(`Home new candidate list is missing: ${statId}/${workType}`);
    }
  }

  return {
    contentScope,
    statId,
    statRef,
    homeViewRef,
    siteStats,
    homeView: homeViewData,
    siteStatsUpdatedAtMillis,
    homeViewUpdatedAtMillis,
  };
}

async function loadProductsByIds(productIds: string[]): Promise<Map<string, Product>> {
  const uniqueProductIds = [...new Set(productIds)];
  const products = new Map<string, Product>();
  const batchSize = 300;
  for (let offset = 0; offset < uniqueProductIds.length; offset += batchSize) {
    const ids = uniqueProductIds.slice(offset, offset + batchSize);
    const refs = ids.map((productId) => db.collection("products").doc(productId));
    const snapshots = await db.getAll(...refs);
    for (let index = 0; index < snapshots.length; index += 1) {
      const snapshot = snapshots[index];
      if (!snapshot.exists) continue;
      products.set(snapshot.id, {
        ...(snapshot.data() as Product),
        productId: snapshot.id,
      });
    }
  }
  return products;
}

function cardsForIds(
  ids: string[],
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): ProductCardItem[] {
  return ids
    .map((id) => cardsByProductId.get(id))
    .filter((card): card is ProductCardItem => Boolean(card));
}

function buildRankingCards(
  source: LoadedScopeSource,
  rankingSource: LoadedRankingSource,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): Record<HomeRankingWorkType, ProductCardItem[]> {
  const result = {} as Record<HomeRankingWorkType, ProductCardItem[]>;
  const cachedRankingIds =
    source.siteStats.homeDailyRankingStrategy === "dailyRevenue_v1"
      ? source.siteStats.homeDailyRankingProductIds
      : undefined;

  for (const workType of NEW_LIST_VIEW_WORK_TYPES) {
    const key = `${source.contentScope}_${workType}`;
    const entries = rankingSource.entriesByScopeAndWorkType.get(key) ?? [];
    const entriesByProductId = new Map(entries.map((entry) => [entry.productId, entry]));
    const ids =
      cachedRankingIds && Object.prototype.hasOwnProperty.call(cachedRankingIds, workType)
        ? uniqueIds(cachedRankingIds[workType]).slice(0, 10)
        : entries.map((entry) => entry.productId).slice(0, 10);
    result[workType] = cardsForIds(ids, cardsByProductId)
      .filter((card) => (card.priceCurrent ?? 0) > 0)
      .map((card) => {
        const entry = entriesByProductId.get(card.productId);
        return entry
          ? {
              ...card,
              rankingMetric: {
                mode: "dailyRevenue",
                sourceDate: rankingSource.sourceDateByScopeAndWorkType.get(key),
                salesCount: entry.salesCount,
                revenue: entry.revenue,
                rankingValue: entry.rankingValue,
                priceCurrent: entry.priceCurrent,
              },
            }
          : card;
      });
  }
  return result;
}

async function prepareScope(
  segmentId: string,
  source: LoadedScopeSource,
  rankingSource: LoadedRankingSource,
  runId: string,
  startedAtMillis: number,
  generatedAt: Timestamp,
): Promise<PreparedScope> {
  const rankingIds = NEW_LIST_VIEW_WORK_TYPES.flatMap((workType) => {
    const cached =
      source.siteStats.homeDailyRankingStrategy === "dailyRevenue_v1"
        ? source.siteStats.homeDailyRankingProductIds?.[workType]
        : undefined;
    if (Array.isArray(cached)) return uniqueIds(cached).slice(0, 10);
    return (rankingSource.entriesByScopeAndWorkType.get(
      `${source.contentScope}_${workType}`,
    ) ?? [])
      .slice(0, 10)
      .map((entry) => entry.productId);
  });
  const newIds = NEW_LIST_VIEW_WORK_TYPES.flatMap((workType) =>
    uniqueIds(source.homeView.newCandidateProductIdsByWorkType[workType]),
  );
  const recentIds = uniqueIds(source.homeView.recentCandidateProductIds);
  const saleIds = uniqueIds(source.homeView.saleCandidateProductIds);
  const requestedProductIds = [
    ...new Set([...rankingIds, ...newIds, ...recentIds, ...saleIds]),
  ];
  const productsById = await loadProductsByIds(requestedProductIds);
  const cardsByProductId = new Map(
    [...productsById.entries()].map(([productId, product]) => [
      productId,
      toProductCardItem(product),
    ]),
  );
  const rankingCards = buildRankingCards(source, rankingSource, cardsByProductId);
  const newCards = {} as Record<HomeRankingWorkType, ProductCardItem[]>;
  for (const workType of NEW_LIST_VIEW_WORK_TYPES) {
    newCards[workType] = cardsForIds(
      uniqueIds(source.homeView.newCandidateProductIdsByWorkType[workType]),
      cardsByProductId,
    );
  }

  const commonPayload: HomeDashboardListViewCommonPayload = {
    stats: normalizeStats(source.siteStats),
    recentCandidateProducts: cardsForIds(recentIds, cardsByProductId),
    saleCandidateProducts: cardsForIds(saleIds, cardsByProductId),
    weeklyCircleCandidates: source.homeView.weeklyCircleCandidates,
    fallbackCircleHighlights: source.siteStats.circleHighlights ?? [],
  };
  const versionId = `${runId}_${source.contentScope}`;
  const sections: BuiltHomeDashboardSection[] = [];
  sections.push(
    buildCompressedHomeDashboardSection(
      HOME_DASHBOARD_COMMON_SECTION_ID,
      versionId,
      commonPayload,
      commonPayload.recentCandidateProducts.length +
        commonPayload.saleCandidateProducts.length +
        commonPayload.weeklyCircleCandidates.length +
        commonPayload.fallbackCircleHighlights.length,
      generatedAt,
    ),
  );
  for (const workType of NEW_LIST_VIEW_WORK_TYPES) {
    const rankingPayload: HomeDashboardListViewProductPayload = {
      products: rankingCards[workType],
    };
    const newPayload: HomeDashboardListViewProductPayload = {
      products: newCards[workType],
    };
    sections.push(
      buildCompressedHomeDashboardSection(
        buildHomeDashboardRankingSectionId(workType),
        versionId,
        rankingPayload,
        rankingPayload.products.length,
        generatedAt,
      ),
      buildCompressedHomeDashboardSection(
        buildHomeDashboardNewSectionId(workType),
        versionId,
        newPayload,
        newPayload.products.length,
        generatedAt,
      ),
    );
  }
  const sectionDescriptors = Object.fromEntries(
    sections.map((section) => [section.descriptor.sectionId, section.descriptor]),
  ) as Record<string, HomeDashboardListViewSectionDescriptor>;
  const version: HomeDashboardListViewVersionDocument = {
    schemaVersion: HOME_DASHBOARD_LIST_VIEW_SCHEMA_VERSION,
    segmentId,
    contentScope: source.contentScope,
    versionId,
    runId,
    startedAtMillis,
    sourceStatId: source.statId,
    sourceHomeViewUpdatedAtMillis: source.homeViewUpdatedAtMillis,
    sourceSiteStatsUpdatedAtMillis: source.siteStatsUpdatedAtMillis,
    sourceRankingVersionId: rankingSource.versionId,
    sections: sectionDescriptors,
    generatedAt,
    updatedAt: generatedAt,
  };
  const scopeRef = db
    .collection(HOME_DASHBOARD_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(SCOPES_SUBCOLLECTION)
    .doc(source.contentScope);
  const versionRef = scopeRef
    .collection(VERSIONS_SUBCOLLECTION)
    .doc(versionId);
  const batch = db.batch();
  batch.set(versionRef, removeUndefinedDeep(version), { merge: false });
  for (const section of sections) {
    batch.set(
      versionRef
        .collection(SECTIONS_SUBCOLLECTION)
        .doc(section.descriptor.sectionId),
      removeUndefinedDeep(section.document),
      { merge: false },
    );
  }
  await batch.commit();
  return {
    source,
    scopeRef,
    version,
    sections,
    productReadCount: requestedProductIds.length,
  };
}

async function activatePreparedScope(
  prepared: PreparedScope,
  rankingSource: LoadedRankingSource,
): Promise<ActivationResult> {
  return db.runTransaction(async (transaction) => {
    const manifestSnapshot = await transaction.get(prepared.scopeRef);
    const statsSnapshot = await transaction.get(prepared.source.statRef);
    const homeViewSnapshot = await transaction.get(prepared.source.homeViewRef);
    const rankingRootSnapshot = await transaction.get(rankingSource.rootRef);
    const currentStatsUpdatedAt = statsSnapshot.exists
      ? timestampMillis(statsSnapshot.data()?.updatedAt)
      : undefined;
    if (currentStatsUpdatedAt !== prepared.version.sourceSiteStatsUpdatedAtMillis) {
      return { activated: false, reason: "source_site_stats_changed" };
    }
    const currentHomeUpdatedAt = homeViewSnapshot.exists
      ? timestampMillis(homeViewSnapshot.data()?.updatedAt)
      : undefined;
    if (currentHomeUpdatedAt !== prepared.version.sourceHomeViewUpdatedAtMillis) {
      return { activated: false, reason: "source_home_view_changed" };
    }
    const rankingRoot = rankingRootSnapshot.exists
      ? (rankingRootSnapshot.data() as Partial<RankingIndexRootDocument>)
      : undefined;
    if (rankingRoot?.activeVersion !== prepared.version.sourceRankingVersionId) {
      return { activated: false, reason: "source_ranking_version_changed" };
    }

    const existing = manifestSnapshot.exists
      ? (manifestSnapshot.data() as Partial<HomeDashboardListViewManifestDocument>)
      : undefined;
    if (
      existing &&
      isNewerRun(
        existing.activeStartedAtMillis,
        existing.activeRunId,
        prepared.version.startedAtMillis,
        prepared.version.runId,
      )
    ) {
      return { activated: false, reason: "newer_run_already_active" };
    }

    const previousVersion = existing?.activeVersion;
    const staleVersion = existing?.previousVersion;
    const manifest: HomeDashboardListViewManifestDocument = {
      schemaVersion: HOME_DASHBOARD_LIST_VIEW_SCHEMA_VERSION,
      segmentId: prepared.version.segmentId,
      contentScope: prepared.version.contentScope,
      activeVersion: prepared.version.versionId,
      previousVersion:
        previousVersion && previousVersion !== prepared.version.versionId
          ? previousVersion
          : undefined,
      sourceStatId: prepared.version.sourceStatId,
      sourceHomeViewUpdatedAtMillis:
        prepared.version.sourceHomeViewUpdatedAtMillis,
      sourceSiteStatsUpdatedAtMillis:
        prepared.version.sourceSiteStatsUpdatedAtMillis,
      sourceRankingVersionId: prepared.version.sourceRankingVersionId,
      sections: prepared.version.sections,
      activeRunId: prepared.version.runId,
      activeStartedAtMillis: prepared.version.startedAtMillis,
      generatedAt: prepared.version.generatedAt,
      updatedAt: nowTimestamp(),
    };
    transaction.set(prepared.scopeRef, removeUndefinedDeep(manifest), {
      merge: false,
    });
    return {
      activated: true,
      previousVersion,
      staleVersion:
        staleVersion && staleVersion !== previousVersion
          ? staleVersion
          : undefined,
    };
  });
}

async function deleteVersion(
  scopeRef: DocumentReference,
  versionId: string,
): Promise<void> {
  const versionRef = scopeRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const sectionsSnapshot = await versionRef.collection(SECTIONS_SUBCOLLECTION).get();
  const refs = [
    ...sectionsSnapshot.docs.map((snapshot) => snapshot.ref),
    versionRef,
  ];
  for (let offset = 0; offset < refs.length; offset += DELETE_BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(offset, offset + DELETE_BATCH_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function rebuildScope(
  segmentId: string,
  source: LoadedScopeSource,
  rankingSource: LoadedRankingSource,
  runId: string,
  startedAtMillis: number,
  generatedAt: Timestamp,
): Promise<RebuildHomeDashboardListViewScopeResult> {
  let prepared: PreparedScope | undefined;
  try {
    prepared = await prepareScope(
      segmentId,
      source,
      rankingSource,
      runId,
      startedAtMillis,
      generatedAt,
    );
    let activation: ActivationResult;
    let activationRecoveryWarning: string | undefined;
    try {
      activation = await activatePreparedScope(prepared, rankingSource);
    } catch (error) {
      const activationError = error instanceof Error ? error.message : String(error);
      const manifestSnapshot = await prepared.scopeRef.get();
      const manifest = manifestSnapshot.exists
        ? (manifestSnapshot.data() as Partial<HomeDashboardListViewManifestDocument>)
        : undefined;
      if (manifest?.activeVersion === prepared.version.versionId) {
        activation = {
          activated: true,
          previousVersion: manifest.previousVersion,
        };
        activationRecoveryWarning =
          `Activation transaction reported an error after the version became active: ${activationError}`;
        console.warn("Recovered an ambiguously committed home-dashboard activation", {
          segmentId,
          contentScope: source.contentScope,
          versionId: prepared.version.versionId,
          error: activationError,
        });
      } else {
        await deleteVersion(prepared.scopeRef, prepared.version.versionId);
        throw error;
      }
    }
    const compressedBytes = prepared.sections.reduce(
      (sum, section) => sum + section.descriptor.compressedBytes,
      0,
    );
    if (!activation.activated) {
      await deleteVersion(prepared.scopeRef, prepared.version.versionId);
      return {
        contentScope: source.contentScope,
        statId: source.statId,
        status: "rejected",
        reason: activation.reason,
        versionId: prepared.version.versionId,
        sectionCount: prepared.sections.length,
        compressedBytes,
        productReadCount: prepared.productReadCount,
      };
    }

    let cleanupDeletedVersion: string | undefined;
    let cleanupError: string | undefined = activationRecoveryWarning;
    if (activation.staleVersion) {
      try {
        await deleteVersion(prepared.scopeRef, activation.staleVersion);
        cleanupDeletedVersion = activation.staleVersion;
      } catch (error) {
        cleanupError = error instanceof Error ? error.message : String(error);
        console.warn("Failed to clean up stale home-dashboard list view", {
          segmentId,
          contentScope: source.contentScope,
          staleVersion: activation.staleVersion,
          error: cleanupError,
        });
      }
    }
    return {
      contentScope: source.contentScope,
      statId: source.statId,
      status: "activated",
      versionId: prepared.version.versionId,
      previousVersion: activation.previousVersion,
      sectionCount: prepared.sections.length,
      compressedBytes,
      productReadCount: prepared.productReadCount,
      cleanupDeletedVersion,
      cleanupError,
    };
  } catch (error) {
    if (prepared) {
      try {
        await deleteVersion(prepared.scopeRef, prepared.version.versionId);
      } catch {
        // Preserve the original error; orphan cleanup can be retried later.
      }
    }
    return {
      contentScope: source.contentScope,
      statId: source.statId,
      status: "rejected",
      reason: error instanceof Error ? error.message : String(error),
      sectionCount: prepared?.sections.length ?? 0,
      compressedBytes:
        prepared?.sections.reduce(
          (sum, section) => sum + section.descriptor.compressedBytes,
          0,
        ) ?? 0,
      productReadCount: prepared?.productReadCount ?? 0,
    };
  }
}

export async function rebuildHomeDashboardListView(
  segment: SiteSegmentKey,
  options: { includeScopes?: boolean } = {},
): Promise<RebuildHomeDashboardListViewResult> {
  const startedAtMillis = Date.now();
  const runId = buildRunId(startedAtMillis);
  const generatedAt = nowTimestamp();
  const segmentId = buildSegmentId(segment);
  const rankingSource = await loadRankingSource(segmentId);
  const sources = await Promise.all(
    CONTENT_SCOPES.map((contentScope) => loadScopeSource(segment, contentScope)),
  );
  const scopes: RebuildHomeDashboardListViewScopeResult[] = [];
  for (const source of sources) {
    scopes.push(
      await rebuildScope(
        segmentId,
        source,
        rankingSource,
        runId,
        startedAtMillis,
        generatedAt,
      ),
    );
  }

  const result: RebuildHomeDashboardListViewResult = {
    segmentId,
    runId,
    startedAtMillis,
    sourceRankingVersionId: rankingSource.versionId,
    scopeCount: scopes.length,
    activatedScopeCount: scopes.filter((scope) => scope.status === "activated").length,
    rejectedScopeCount: scopes.filter((scope) => scope.status === "rejected").length,
    totalSectionCount: scopes.reduce((sum, scope) => sum + scope.sectionCount, 0),
    totalCompressedBytes: scopes.reduce(
      (sum, scope) => sum + scope.compressedBytes,
      0,
    ),
    totalProductReadCount: scopes.reduce(
      (sum, scope) => sum + scope.productReadCount,
      0,
    ),
    elapsedMs: Date.now() - startedAtMillis,
    scopes: options.includeScopes ? scopes : undefined,
  };
  console.log("Home-dashboard list view rebuilt", result);
  return result;
}

export async function rebuildHomeDashboardListViewsForTargets(
  targets: SiteSegmentKey[],
  options: { includeScopes?: boolean } = {},
): Promise<RebuildHomeDashboardListViewResult[]> {
  const uniqueSegments = new Map<string, SiteSegmentKey>();
  for (const target of targets) {
    uniqueSegments.set(buildSegmentId(target), {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    });
  }
  const results: RebuildHomeDashboardListViewResult[] = [];
  for (const segment of uniqueSegments.values()) {
    results.push(await rebuildHomeDashboardListView(segment, options));
  }
  return results;
}
