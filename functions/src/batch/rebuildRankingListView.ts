import { randomUUID } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  Product,
  ProductCardItem,
  RankingIndexListDocument,
  RankingIndexRootDocument,
  RankingIndexVersionDocument,
  RankingListViewManifestDocument,
  RankingListViewVersionDocument,
} from "../types";
import { nowTimestamp } from "../util";
import { loadProjectedProductsForNewListView } from "./listViews/loadNewListViewProducts";
import {
  RANKING_LIST_VIEW_CONTENT_SCOPES,
  RANKING_LIST_VIEW_MODES,
  RANKING_LIST_VIEW_SCHEMA_VERSION,
  RANKING_LIST_VIEW_WORK_TYPES,
  buildCompressedRankingListBlocks,
  buildRankingListChecksum,
  buildRankingListViewListId,
} from "./listViews/rankingListViewShared";
import { removeUndefinedDeep, toProductCardItem } from "./listViews/newListViewShared";

const SOURCE_RANKING_INDEXES_COLLECTION = "rankingIndexes";
const RANKING_LIST_VIEWS_COLLECTION = "rankingListViews";
const LISTS_SUBCOLLECTION = "rankingListViewLists";
const VERSIONS_SUBCOLLECTION = "rankingListViewVersions";
const BLOCKS_SUBCOLLECTION = "rankingListViewBlocks";
const SOURCE_SCHEMA_VERSION = 1;

export type RebuildRankingListViewListResult = {
  listId: string;
  status: "activated" | "preserved" | "rejected";
  sourceStatus?: "ready" | "insufficient_data";
  versionId?: string;
  previousVersion?: string;
  itemCount: number;
  blockCount: number;
  compressedBytes: number;
  missingProductIds?: string[];
  reason?: string;
  cleanupDeletedVersion?: string;
  cleanupError?: string;
};

export type RebuildRankingListViewResult = {
  segmentId: string;
  runId: string;
  startedAtMillis: number;
  sourceRankingVersionId: string;
  sourceListCount: number;
  productCount: number;
  listCount: number;
  activatedListCount: number;
  preservedListCount: number;
  rejectedListCount: number;
  totalItemOccurrences: number;
  totalBlockCount: number;
  totalCompressedBytes: number;
  elapsedMs: number;
  lists?: RebuildRankingListViewListResult[];
};

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

type ActivationResult = {
  activated: boolean;
  previousVersion?: string;
  staleVersion?: string;
  rejectionReason?: "newer_run_already_active" | "source_ranking_version_changed";
};

type SourceRankingData = {
  root: RankingIndexRootDocument;
  version: RankingIndexVersionDocument;
  lists: Map<string, RankingIndexListDocument>;
};

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildRunId(startedAtMillis: number): string {
  return `${new Date(startedAtMillis).toISOString().replace(/\D/g, "").slice(0, 17)}_${randomUUID().slice(0, 8)}`;
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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidSourceList(
  value: Partial<RankingIndexListDocument>,
  expected: {
    segmentId: string;
    versionId: string;
    listId: string;
    contentScope: RankingIndexListDocument["contentScope"];
    rankingMode: RankingIndexListDocument["rankingMode"];
    workType: RankingIndexListDocument["workType"];
  },
): value is RankingIndexListDocument {
  if (
    value.segmentId !== expected.segmentId ||
    value.versionId !== expected.versionId ||
    value.listId !== expected.listId ||
    value.contentScope !== expected.contentScope ||
    value.rankingMode !== expected.rankingMode ||
    value.workType !== expected.workType ||
    (value.status !== "ready" && value.status !== "insufficient_data") ||
    !Number.isInteger(value.itemCount) ||
    (value.itemCount ?? -1) < 0 ||
    !Array.isArray(value.entries) ||
    value.entries.length !== value.itemCount
  ) {
    return false;
  }

  return value.entries.every(
    (entry, index) =>
      entry.rank === index + 1 &&
      typeof entry.productId === "string" &&
      entry.productId.length > 0 &&
      isFiniteNumber(entry.rankingValue) &&
      isFiniteNumber(entry.salesCount) &&
      isFiniteNumber(entry.priceCurrent) &&
      (entry.revenue === undefined || isFiniteNumber(entry.revenue)),
  );
}


function buildExpectedListSpecs() {
  return RANKING_LIST_VIEW_CONTENT_SCOPES.flatMap((contentScope) =>
    RANKING_LIST_VIEW_MODES.flatMap((rankingMode) =>
      RANKING_LIST_VIEW_WORK_TYPES.map((workType) => ({
        listId: buildRankingListViewListId(contentScope, rankingMode, workType),
        contentScope,
        rankingMode,
        workType,
      })),
    ),
  );
}

async function loadSourceRankingData(segmentId: string): Promise<SourceRankingData> {
  const rootRef = db.collection(SOURCE_RANKING_INDEXES_COLLECTION).doc(segmentId);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) {
    throw new Error(`Ranking index root is missing: ${segmentId}`);
  }

  const root = rootSnapshot.data() as Partial<RankingIndexRootDocument>;
  if (
    root.schemaVersion !== SOURCE_SCHEMA_VERSION ||
    root.segmentId !== segmentId ||
    typeof root.activeVersion !== "string" ||
    root.activeVersion.length === 0
  ) {
    throw new Error(`Ranking index root is invalid: ${segmentId}`);
  }

  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    throw new Error(`Ranking index active version is missing: ${segmentId}/${root.activeVersion}`);
  }

  const version = versionSnapshot.data() as Partial<RankingIndexVersionDocument>;
  if (
    version.schemaVersion !== SOURCE_SCHEMA_VERSION ||
    version.segmentId !== segmentId ||
    version.versionId !== root.activeVersion ||
    version.status !== "ready" ||
    !Array.isArray(version.listIds)
  ) {
    throw new Error(`Ranking index active version is invalid: ${segmentId}/${root.activeVersion}`);
  }

  const expectedLists = buildExpectedListSpecs();
  const lists = new Map<string, RankingIndexListDocument>();
  const batchSize = 100;
  for (let offset = 0; offset < expectedLists.length; offset += batchSize) {
    const chunk = expectedLists.slice(offset, offset + batchSize);
    const refs = chunk.map((item) => versionRef.collection("lists").doc(item.listId));
    const snapshots = await db.getAll(...refs);
    for (let index = 0; index < chunk.length; index += 1) {
      const expected = chunk[index];
      const snapshot = snapshots[index];
      if (!snapshot.exists) continue;
      const list = snapshot.data() as Partial<RankingIndexListDocument>;
      if (
        isValidSourceList(list, {
          segmentId,
          versionId: root.activeVersion,
          ...expected,
        })
      ) {
        lists.set(expected.listId, list);
      }
    }
  }

  return {
    root: root as RankingIndexRootDocument,
    version: version as RankingIndexVersionDocument,
    lists,
  };
}

async function writeReadyVersion(
  listRef: DocumentReference,
  version: RankingListViewVersionDocument,
  blocks: ReturnType<typeof buildCompressedRankingListBlocks>,
): Promise<void> {
  const versionRef = listRef.collection(VERSIONS_SUBCOLLECTION).doc(version.versionId);
  const batch = db.batch();
  batch.set(versionRef, removeUndefinedDeep(version), { merge: false });
  for (const block of blocks) {
    batch.set(
      versionRef.collection(BLOCKS_SUBCOLLECTION).doc(block.descriptor.blockId),
      removeUndefinedDeep(block.document),
      { merge: false },
    );
  }
  await batch.commit();
}

async function activateVersion(
  listRef: DocumentReference,
  sourceRootRef: DocumentReference,
  version: RankingListViewVersionDocument,
): Promise<ActivationResult> {
  return db.runTransaction(async (transaction) => {
    const sourceRootSnapshot = await transaction.get(sourceRootRef);
    const snapshot = await transaction.get(listRef);
    const sourceRoot = sourceRootSnapshot.exists
      ? (sourceRootSnapshot.data() as Partial<RankingIndexRootDocument>)
      : undefined;
    if (sourceRoot?.activeVersion !== version.sourceRankingVersionId) {
      return {
        activated: false,
        rejectionReason: "source_ranking_version_changed",
      };
    }

    const existing = snapshot.exists
      ? (snapshot.data() as Partial<RankingListViewManifestDocument>)
      : undefined;

    if (
      existing &&
      isNewerRun(
        existing.activeStartedAtMillis,
        existing.activeRunId,
        version.startedAtMillis,
        version.runId,
      )
    ) {
      return {
        activated: false,
        rejectionReason: "newer_run_already_active",
      };
    }

    const previousVersion = existing?.activeVersion;
    const staleVersion = existing?.previousVersion;
    const manifest: RankingListViewManifestDocument = {
      schemaVersion: RANKING_LIST_VIEW_SCHEMA_VERSION,
      segmentId: version.segmentId,
      listId: version.listId,
      contentScope: version.contentScope,
      rankingMode: version.rankingMode,
      workType: version.workType,
      activeVersion: version.versionId,
      previousVersion:
        previousVersion && previousVersion !== version.versionId
          ? previousVersion
          : undefined,
      sourceRankingVersionId: version.sourceRankingVersionId,
      sourceDate: version.sourceDate,
      status: version.status,
      itemCount: version.itemCount,
      blockCount: version.blockCount,
      blocks: version.blocks,
      listChecksum: version.listChecksum,
      activeRunId: version.runId,
      activeStartedAtMillis: version.startedAtMillis,
      generatedAt: version.generatedAt,
      updatedAt: nowTimestamp(),
    };
    transaction.set(listRef, removeUndefinedDeep(manifest), { merge: false });
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
  listRef: DocumentReference,
  versionId: string,
): Promise<void> {
  const versionRef = listRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const blocksSnapshot = await versionRef.collection(BLOCKS_SUBCOLLECTION).get();
  const batch = db.batch();
  for (const blockSnapshot of blocksSnapshot.docs) {
    batch.delete(blockSnapshot.ref);
  }
  batch.delete(versionRef);
  await batch.commit();
}

async function rebuildOneList(params: {
  segmentId: string;
  sourceRankingVersionId: string;
  runId: string;
  startedAtMillis: number;
  sourceList: RankingIndexListDocument | undefined;
  cardsByProductId: ReadonlyMap<string, ProductCardItem>;
  productsByProductId: ReadonlyMap<string, Product>;
  generatedAt: Timestamp;
  listId: string;
}): Promise<RebuildRankingListViewListResult> {
  const { sourceList, listId } = params;
  if (!sourceList) {
    return {
      listId,
      status: "rejected",
      itemCount: 0,
      blockCount: 0,
      compressedBytes: 0,
      reason: "source_ranking_list_missing_or_invalid",
    };
  }

  if (sourceList.status === "insufficient_data") {
    return {
      listId,
      status: "preserved",
      sourceStatus: sourceList.status,
      itemCount: sourceList.itemCount,
      blockCount: 0,
      compressedBytes: 0,
      reason: "source_ranking_list_insufficient_data",
    };
  }

  const missingProductIds = sourceList.entries
    .map((entry) => entry.productId)
    .filter((productId) => !params.productsByProductId.has(productId));
  if (missingProductIds.length > 0) {
    return {
      listId,
      status: "rejected",
      sourceStatus: sourceList.status,
      itemCount: sourceList.itemCount,
      blockCount: 0,
      compressedBytes: 0,
      missingProductIds: missingProductIds.slice(0, 20),
      reason: "source_ranking_products_missing",
    };
  }

  const items = sourceList.entries.map((entry) => {
    const product = params.productsByProductId.get(entry.productId);
    const baseCard = params.cardsByProductId.get(entry.productId);
    if (!product || !baseCard) {
      throw new Error(`Ranking-list product mapping disappeared: ${entry.productId}`);
    }
    return {
      ...baseCard,
      rankingMetric: {
        mode: sourceList.rankingMode,
        sourceDate: sourceList.sourceDate,
        salesCount: entry.salesCount,
        revenue: entry.revenue,
        rankingValue: entry.rankingValue,
        priceCurrent: entry.priceCurrent,
      },
    } satisfies ProductCardItem;
  });

  const versionId = `${params.runId}_${listId}`;
  const listRef = db
    .collection(RANKING_LIST_VIEWS_COLLECTION)
    .doc(params.segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const blocks = buildCompressedRankingListBlocks(
    listId,
    versionId,
    items,
    params.generatedAt,
  );
  const listChecksum = buildRankingListChecksum(items, blocks);
  const version: RankingListViewVersionDocument = {
    schemaVersion: RANKING_LIST_VIEW_SCHEMA_VERSION,
    segmentId: params.segmentId,
    listId,
    contentScope: sourceList.contentScope,
    rankingMode: sourceList.rankingMode,
    workType: sourceList.workType,
    versionId,
    runId: params.runId,
    startedAtMillis: params.startedAtMillis,
    sourceRankingVersionId: params.sourceRankingVersionId,
    sourceDate: sourceList.sourceDate,
    status: items.length > 0 ? "ready" : "empty",
    itemCount: items.length,
    blockCount: blocks.length,
    blocks: blocks.map((block) => block.descriptor),
    listChecksum,
    generatedAt: params.generatedAt,
    updatedAt: params.generatedAt,
  };

  await writeReadyVersion(listRef, version, blocks);
  let activation: ActivationResult;
  let activationRecoveryWarning: string | undefined;
  try {
    activation = await activateVersion(
      listRef,
      db.collection(SOURCE_RANKING_INDEXES_COLLECTION).doc(params.segmentId),
      version,
    );
  } catch (error) {
    const activationError = error instanceof Error ? error.message : String(error);
    try {
      const manifestSnapshot = await listRef.get();
      const manifest = manifestSnapshot.exists
        ? (manifestSnapshot.data() as Partial<RankingListViewManifestDocument>)
        : undefined;
      if (manifest?.activeVersion === versionId) {
        activation = {
          activated: true,
          previousVersion: manifest.previousVersion,
        };
        activationRecoveryWarning =
          `Activation transaction reported an error after the version became active: ${activationError}`;
        console.warn("Recovered an ambiguously committed ranking-list activation", {
          segmentId: params.segmentId,
          listId,
          versionId,
          error: activationError,
        });
      } else {
        await deleteVersion(listRef, versionId);
        throw error;
      }
    } catch (verificationError) {
      if (verificationError !== error) {
        console.error("Failed to verify ranking-list activation after transaction error", {
          segmentId: params.segmentId,
          listId,
          versionId,
          activationError,
          verificationError:
            verificationError instanceof Error
              ? verificationError.message
              : String(verificationError),
        });
      }
      throw error;
    }
  }

  const compressedBytes = blocks.reduce(
    (sum, block) => sum + block.descriptor.compressedBytes,
    0,
  );
  if (!activation.activated) {
    await deleteVersion(listRef, versionId);
    return {
      listId,
      status: "rejected",
      sourceStatus: sourceList.status,
      versionId,
      itemCount: items.length,
      blockCount: blocks.length,
      compressedBytes,
      reason: activation.rejectionReason ?? "activation_rejected",
    };
  }

  let cleanupError: string | undefined = activationRecoveryWarning;
  let cleanupDeletedVersion: string | undefined;
  if (activation.staleVersion) {
    try {
      await deleteVersion(listRef, activation.staleVersion);
      cleanupDeletedVersion = activation.staleVersion;
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : String(error);
      console.warn("Failed to clean up stale ranking-list view version", {
        segmentId: params.segmentId,
        listId,
        staleVersion: activation.staleVersion,
        error: cleanupError,
      });
    }
  }

  return {
    listId,
    status: "activated",
    sourceStatus: sourceList.status,
    versionId,
    previousVersion: activation.previousVersion,
    itemCount: items.length,
    blockCount: blocks.length,
    compressedBytes,
    cleanupDeletedVersion,
    cleanupError,
  };
}

export async function rebuildRankingListView(
  segment: SiteSegmentKey,
  options: { includeLists?: boolean } = {},
): Promise<RebuildRankingListViewResult> {
  const startedAt = Date.now();
  const runId = buildRunId(startedAt);
  const generatedAt = nowTimestamp();
  const segmentId = buildSegmentId(segment);
  const [source, products] = await Promise.all([
    loadSourceRankingData(segmentId),
    loadProjectedProductsForNewListView(segment),
  ]);
  const productsByProductId = new Map(
    products.map((product) => [product.productId, product as Product]),
  );
  const cardsByProductId = new Map(
    products.map((product) => [
      product.productId,
      toProductCardItem(product as Product),
    ]),
  );

  const expectedLists = buildExpectedListSpecs();
  const lists: RebuildRankingListViewListResult[] = [];
  for (const { listId } of expectedLists) {
    lists.push(
      await rebuildOneList({
        segmentId,
        sourceRankingVersionId: source.root.activeVersion,
        runId,
        startedAtMillis: startedAt,
        sourceList: source.lists.get(listId),
        cardsByProductId,
        productsByProductId,
        generatedAt,
        listId,
      }),
    );
  }

  const result: RebuildRankingListViewResult = {
    segmentId,
    runId,
    startedAtMillis: startedAt,
    sourceRankingVersionId: source.root.activeVersion,
    sourceListCount: source.version.listCount,
    productCount: products.length,
    listCount: lists.length,
    activatedListCount: lists.filter((list) => list.status === "activated").length,
    preservedListCount: lists.filter((list) => list.status === "preserved").length,
    rejectedListCount: lists.filter((list) => list.status === "rejected").length,
    totalItemOccurrences: lists.reduce((sum, list) => sum + list.itemCount, 0),
    totalBlockCount: lists.reduce((sum, list) => sum + list.blockCount, 0),
    totalCompressedBytes: lists.reduce(
      (sum, list) => sum + list.compressedBytes,
      0,
    ),
    elapsedMs: Date.now() - startedAt,
    lists: options.includeLists ? lists : undefined,
  };

  console.log("Ranking-list view rebuilt", result);
  return result;
}

export async function rebuildRankingListViewsForTargets(
  targets: SiteSegmentKey[],
  options: { includeLists?: boolean } = {},
): Promise<RebuildRankingListViewResult[]> {
  const uniqueSegments = new Map<string, SiteSegmentKey>();
  for (const target of targets) {
    const segmentId = buildSegmentId(target);
    uniqueSegments.set(segmentId, {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    });
  }

  const results: RebuildRankingListViewResult[] = [];
  for (const segment of uniqueSegments.values()) {
    results.push(await rebuildRankingListView(segment, options));
  }
  return results;
}
