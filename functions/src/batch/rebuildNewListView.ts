import { randomUUID } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  NewListViewManifestDocument,
  NewListViewVersionDocument,
  ProductCardItem,
} from "../types";
import { nowTimestamp } from "../util";
import { loadProjectedProductsForNewListView } from "./listViews/loadNewListViewProducts";
import {
  NEW_LIST_VIEW_CONTENT_SCOPES,
  NEW_LIST_VIEW_SCHEMA_VERSION,
  NEW_LIST_VIEW_WORK_TYPES,
  buildCompressedNewListBlocks,
  buildListChecksum,
  buildNewListId,
  compareNewListProducts,
  listViewProductHasScope,
  listViewProductMatchesWorkType,
  removeUndefinedDeep,
  toProductCardItem,
  type NewListViewContentScope,
  type NewListViewSourceProduct,
  type NewListViewWorkType,
} from "./listViews/newListViewShared";

const NEW_LIST_VIEWS_COLLECTION = "newListViews";
const LISTS_SUBCOLLECTION = "newListViewLists";
const VERSIONS_SUBCOLLECTION = "newListViewVersions";
const BLOCKS_SUBCOLLECTION = "newListViewBlocks";

export type RebuildNewListViewListResult = {
  listId: string;
  contentScope: NewListViewContentScope;
  workType: NewListViewWorkType;
  status: "activated" | "rejected";
  versionId: string;
  previousVersion?: string;
  itemCount: number;
  blockCount: number;
  compressedBytes: number;
  cleanupDeletedVersion?: string;
  cleanupError?: string;
};

export type RebuildNewListViewResult = {
  segmentId: string;
  runId: string;
  startedAtMillis: number;
  productCount: number;
  listCount: number;
  activatedListCount: number;
  rejectedListCount: number;
  totalItemOccurrences: number;
  totalBlockCount: number;
  totalCompressedBytes: number;
  elapsedMs: number;
  lists?: RebuildNewListViewListResult[];
};

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

type ActivationResult = {
  activated: boolean;
  previousVersion?: string;
  staleVersion?: string;
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

async function writeReadyVersion(
  listRef: DocumentReference,
  version: NewListViewVersionDocument,
  blocks: ReturnType<typeof buildCompressedNewListBlocks>,
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
  version: NewListViewVersionDocument,
): Promise<ActivationResult> {
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(listRef);
    const existing = snapshot.exists
      ? (snapshot.data() as Partial<NewListViewManifestDocument>)
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
      return { activated: false };
    }

    const previousVersion = existing?.activeVersion;
    const staleVersion = existing?.previousVersion;
    const manifest: NewListViewManifestDocument = {
      schemaVersion: NEW_LIST_VIEW_SCHEMA_VERSION,
      segmentId: version.segmentId,
      listId: version.listId,
      contentScope: version.contentScope,
      workType: version.workType,
      activeVersion: version.versionId,
      previousVersion:
        previousVersion && previousVersion !== version.versionId
          ? previousVersion
          : undefined,
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

function buildListItems(
  sortedScopeProducts: NewListViewSourceProduct[],
  workType: NewListViewWorkType,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): ProductCardItem[] {
  return sortedScopeProducts
    .filter((product) => listViewProductMatchesWorkType(product, workType))
    .map((product) => cardsByProductId.get(product.productId))
    .filter((card): card is ProductCardItem => card !== undefined);
}

async function rebuildOneList(
  segmentId: string,
  runId: string,
  startedAtMillis: number,
  contentScope: NewListViewContentScope,
  workType: NewListViewWorkType,
  items: ProductCardItem[],
  generatedAt: Timestamp,
): Promise<RebuildNewListViewListResult> {
  const listId = buildNewListId(contentScope, workType);
  const versionId = `${runId}_${listId}`;
  const listRef = db
    .collection(NEW_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const blocks = buildCompressedNewListBlocks(
    listId,
    versionId,
    items,
    generatedAt,
  );
  const listChecksum = buildListChecksum(items, blocks);
  const version: NewListViewVersionDocument = {
    schemaVersion: NEW_LIST_VIEW_SCHEMA_VERSION,
    segmentId,
    listId,
    contentScope,
    workType,
    versionId,
    runId,
    startedAtMillis,
    status: items.length > 0 ? "ready" : "empty",
    itemCount: items.length,
    blockCount: blocks.length,
    blocks: blocks.map((block) => block.descriptor),
    listChecksum,
    generatedAt,
    updatedAt: generatedAt,
  };

  await writeReadyVersion(listRef, version, blocks);
  let activation: ActivationResult;
  let activationRecoveryWarning: string | undefined;
  try {
    activation = await activateVersion(listRef, version);
  } catch (error) {
    const activationError = error instanceof Error ? error.message : String(error);
    try {
      const manifestSnapshot = await listRef.get();
      const manifest = manifestSnapshot.exists
        ? (manifestSnapshot.data() as Partial<NewListViewManifestDocument>)
        : undefined;
      if (manifest?.activeVersion === versionId) {
        activation = {
          activated: true,
          previousVersion: manifest.previousVersion,
        };
        activationRecoveryWarning =
          `Activation transaction reported an error after the version became active: ${activationError}`;
        console.warn("Recovered an ambiguously committed new-list activation", {
          segmentId,
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
        console.error("Failed to verify new-list activation after transaction error", {
          segmentId,
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

  if (!activation.activated) {
    await deleteVersion(listRef, versionId);
    return {
      listId,
      contentScope,
      workType,
      status: "rejected",
      versionId,
      itemCount: items.length,
      blockCount: blocks.length,
      compressedBytes: blocks.reduce(
        (sum, block) => sum + block.descriptor.compressedBytes,
        0,
      ),
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
      console.warn("Failed to clean up stale new-list view version", {
        segmentId,
        listId,
        staleVersion: activation.staleVersion,
        error: cleanupError,
      });
    }
  }

  return {
    listId,
    contentScope,
    workType,
    status: "activated",
    versionId,
    previousVersion: activation.previousVersion,
    itemCount: items.length,
    blockCount: blocks.length,
    compressedBytes: blocks.reduce(
      (sum, block) => sum + block.descriptor.compressedBytes,
      0,
    ),
    cleanupDeletedVersion,
    cleanupError,
  };
}

export async function rebuildNewListView(
  segment: SiteSegmentKey,
  options: { includeLists?: boolean } = {},
): Promise<RebuildNewListViewResult> {
  const startedAt = Date.now();
  const runId = buildRunId(startedAt);
  const generatedAt = nowTimestamp();
  const segmentId = buildSegmentId(segment);
  const products = await loadProjectedProductsForNewListView(segment);
  const cardsByProductId = new Map(
    products.map((product) => [product.productId, toProductCardItem(product)]),
  );

  const sortedByScope = new Map<
    NewListViewContentScope,
    NewListViewSourceProduct[]
  >();
  for (const contentScope of NEW_LIST_VIEW_CONTENT_SCOPES) {
    sortedByScope.set(
      contentScope,
      products
        .filter((product) => listViewProductHasScope(product, contentScope))
        .sort(compareNewListProducts),
    );
  }

  const lists: RebuildNewListViewListResult[] = [];
  for (const contentScope of NEW_LIST_VIEW_CONTENT_SCOPES) {
    const sortedScopeProducts = sortedByScope.get(contentScope) ?? [];
    for (const workType of NEW_LIST_VIEW_WORK_TYPES) {
      const items = buildListItems(
        sortedScopeProducts,
        workType,
        cardsByProductId,
      );
      lists.push(
        await rebuildOneList(
          segmentId,
          runId,
          startedAt,
          contentScope,
          workType,
          items,
          generatedAt,
        ),
      );
    }
  }

  const result: RebuildNewListViewResult = {
    segmentId,
    runId,
    startedAtMillis: startedAt,
    productCount: products.length,
    listCount: lists.length,
    activatedListCount: lists.filter((list) => list.status === "activated").length,
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

  console.log("New-list view rebuilt", result);
  return result;
}

export async function rebuildNewListViewsForTargets(
  targets: SiteSegmentKey[],
  options: { includeLists?: boolean } = {},
): Promise<RebuildNewListViewResult[]> {
  const uniqueSegments = new Map<string, SiteSegmentKey>();
  for (const target of targets) {
    const segmentId = buildSegmentId(target);
    uniqueSegments.set(segmentId, {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    });
  }

  const results: RebuildNewListViewResult[] = [];
  for (const segment of uniqueSegments.values()) {
    results.push(await rebuildNewListView(segment, options));
  }
  return results;
}
