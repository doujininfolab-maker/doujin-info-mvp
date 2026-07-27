import { randomUUID } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  SellerCardItem,
  SellerIndexChunkDocument,
  SellerIndexItem,
  SellerIndexRootDocument,
  SellerIndexVersionDocument,
  SellerListViewManifestDocument,
  SellerListViewVersionDocument,
  SellerSortMode,
} from "../types";
import { nowTimestamp } from "../util";
import { removeUndefinedDeep } from "./listViews/newListViewShared";
import {
  SELLER_LIST_VIEW_CONTENT_SCOPES,
  SELLER_LIST_VIEW_SCHEMA_VERSION,
  SELLER_LIST_VIEW_SORT_MODES,
  buildCompressedSellerListBlocks,
  buildSellerListChecksum,
  buildSellerListViewListId,
  compareSellerCardItems,
  toSellerCardItem,
  type SellerListViewContentScope,
} from "./listViews/sellerListViewShared";

const SELLER_INDEXES_COLLECTION = "sellerIndexes";
const SELLER_INDEX_SCHEMA_VERSION = 1;
const SELLER_LIST_VIEWS_COLLECTION = "sellerListViews";
const LISTS_SUBCOLLECTION = "sellerListViewLists";
const VERSIONS_SUBCOLLECTION = "sellerListViewVersions";
const BLOCKS_SUBCOLLECTION = "sellerListViewBlocks";
const DELETE_BATCH_SIZE = 400;

export type RebuildSellerListViewListResult = {
  listId: string;
  contentScope: SellerListViewContentScope;
  sortMode: SellerSortMode;
  status: "activated" | "rejected";
  reason?: "newer_run_active" | "source_seller_version_changed";
  versionId: string;
  previousVersion?: string;
  itemCount: number;
  blockCount: number;
  compressedBytes: number;
  cleanupDeletedVersion?: string;
  cleanupError?: string;
};

export type RebuildSellerListViewResult = {
  segmentId: string;
  runId: string;
  startedAtMillis: number;
  sourceSellerVersionId: string;
  sellerItemCount: number;
  listCount: number;
  activatedListCount: number;
  rejectedListCount: number;
  totalItemOccurrences: number;
  totalBlockCount: number;
  totalCompressedBytes: number;
  elapsedMs: number;
  lists?: RebuildSellerListViewListResult[];
};

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

type LoadedSellerIndex = {
  segmentId: string;
  sourceSellerVersionId: string;
  rootRef: DocumentReference;
  items: SellerIndexItem[];
};

type PreparedList = {
  listId: string;
  contentScope: SellerListViewContentScope;
  sortMode: SellerSortMode;
  listRef: DocumentReference;
  version: SellerListViewVersionDocument;
  itemCount: number;
  blockCount: number;
  compressedBytes: number;
};

type ActivatedList = {
  previousVersion?: string;
  staleVersion?: string;
};

type ActivationResult =
  | {
      activated: true;
      lists: Map<string, ActivatedList>;
    }
  | {
      activated: false;
      reason: "newer_run_active" | "source_seller_version_changed";
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

async function loadSellerIndex(segment: SiteSegmentKey): Promise<LoadedSellerIndex> {
  const segmentId = buildSegmentId(segment);
  const rootRef = db.collection(SELLER_INDEXES_COLLECTION).doc(segmentId);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) {
    throw new Error(`Seller index root is missing: ${segmentId}`);
  }
  const root = rootSnapshot.data() as Partial<SellerIndexRootDocument>;
  if (
    root.schemaVersion !== SELLER_INDEX_SCHEMA_VERSION ||
    typeof root.activeVersion !== "string"
  ) {
    throw new Error(`Seller index root is invalid: ${segmentId}`);
  }

  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    throw new Error(
      `Seller index active version is missing: ${segmentId}/${root.activeVersion}`,
    );
  }
  const version = versionSnapshot.data() as Partial<SellerIndexVersionDocument>;
  if (
    version.schemaVersion !== SELLER_INDEX_SCHEMA_VERSION ||
    version.status !== "ready" ||
    version.versionId !== root.activeVersion ||
    !Array.isArray(version.chunkIds)
  ) {
    throw new Error(
      `Seller index active version is invalid: ${segmentId}/${root.activeVersion}`,
    );
  }

  const refs = version.chunkIds.map((chunkId) =>
    versionRef.collection("chunks").doc(chunkId),
  );
  const snapshots = refs.length ? await db.getAll(...refs) : [];
  const items: SellerIndexItem[] = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    const chunkId = version.chunkIds[index];
    if (!snapshot.exists) {
      throw new Error(
        `Seller index chunk is missing: ${segmentId}/${root.activeVersion}/${chunkId}`,
      );
    }
    const chunk = snapshot.data() as Partial<SellerIndexChunkDocument>;
    if (
      chunk.versionId !== root.activeVersion ||
      chunk.chunkId !== chunkId ||
      !Array.isArray(chunk.items)
    ) {
      throw new Error(
        `Seller index chunk is invalid: ${segmentId}/${root.activeVersion}/${chunkId}`,
      );
    }
    items.push(...chunk.items);
  }
  if (typeof version.itemCount === "number" && items.length !== version.itemCount) {
    throw new Error(
      `Seller index item count mismatch: segment=${segmentId}, expected=${version.itemCount}, actual=${items.length}`,
    );
  }
  return {
    segmentId,
    sourceSellerVersionId: root.activeVersion,
    rootRef,
    items,
  };
}

async function writeReadyVersion(
  listRef: DocumentReference,
  version: SellerListViewVersionDocument,
  blocks: ReturnType<typeof buildCompressedSellerListBlocks>,
): Promise<void> {
  const versionRef = listRef
    .collection(VERSIONS_SUBCOLLECTION)
    .doc(version.versionId);
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

async function prepareOneList(
  source: LoadedSellerIndex,
  runId: string,
  startedAtMillis: number,
  contentScope: SellerListViewContentScope,
  sortMode: SellerSortMode,
  items: SellerCardItem[],
  generatedAt: Timestamp,
): Promise<PreparedList> {
  const listId = buildSellerListViewListId(contentScope, sortMode);
  const versionId = `${runId}_${listId}`;
  const listRef = db
    .collection(SELLER_LIST_VIEWS_COLLECTION)
    .doc(source.segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const blocks = buildCompressedSellerListBlocks(
    listId,
    versionId,
    items,
    generatedAt,
  );
  const version: SellerListViewVersionDocument = {
    schemaVersion: SELLER_LIST_VIEW_SCHEMA_VERSION,
    segmentId: source.segmentId,
    listId,
    contentScope,
    sortMode,
    versionId,
    runId,
    startedAtMillis,
    sourceSellerVersionId: source.sourceSellerVersionId,
    status: items.length > 0 ? "ready" : "empty",
    itemCount: items.length,
    blockCount: blocks.length,
    blocks: blocks.map((block) => block.descriptor),
    listChecksum: buildSellerListChecksum(items, blocks),
    generatedAt,
    updatedAt: generatedAt,
  };
  await writeReadyVersion(listRef, version, blocks);
  return {
    listId,
    contentScope,
    sortMode,
    listRef,
    version,
    itemCount: items.length,
    blockCount: blocks.length,
    compressedBytes: blocks.reduce(
      (sum, block) => sum + block.descriptor.compressedBytes,
      0,
    ),
  };
}

async function activatePreparedLists(
  source: LoadedSellerIndex,
  prepared: PreparedList[],
): Promise<ActivationResult> {
  return db.runTransaction(async (transaction) => {
    const sourceSnapshot = await transaction.get(source.rootRef);
    const sourceRoot = sourceSnapshot.exists
      ? (sourceSnapshot.data() as Partial<SellerIndexRootDocument>)
      : undefined;
    if (sourceRoot?.activeVersion !== source.sourceSellerVersionId) {
      return {
        activated: false,
        reason: "source_seller_version_changed",
      };
    }

    const snapshots = await transaction.getAll(
      ...prepared.map((item) => item.listRef),
    );
    for (let index = 0; index < prepared.length; index += 1) {
      const existing = snapshots[index].exists
        ? (snapshots[index].data() as Partial<SellerListViewManifestDocument>)
        : undefined;
      const next = prepared[index].version;
      if (
        existing &&
        isNewerRun(
          existing.activeStartedAtMillis,
          existing.activeRunId,
          next.startedAtMillis,
          next.runId,
        )
      ) {
        return { activated: false, reason: "newer_run_active" };
      }
    }

    const activationByList = new Map<string, ActivatedList>();
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const existing = snapshots[index].exists
        ? (snapshots[index].data() as Partial<SellerListViewManifestDocument>)
        : undefined;
      const previousVersion = existing?.activeVersion;
      const staleVersion = existing?.previousVersion;
      const manifest: SellerListViewManifestDocument = {
        schemaVersion: SELLER_LIST_VIEW_SCHEMA_VERSION,
        segmentId: item.version.segmentId,
        listId: item.version.listId,
        contentScope: item.version.contentScope,
        sortMode: item.version.sortMode,
        activeVersion: item.version.versionId,
        previousVersion:
          previousVersion && previousVersion !== item.version.versionId
            ? previousVersion
            : undefined,
        sourceSellerVersionId: source.sourceSellerVersionId,
        status: item.version.status,
        itemCount: item.version.itemCount,
        blockCount: item.version.blockCount,
        blocks: item.version.blocks,
        listChecksum: item.version.listChecksum,
        activeRunId: item.version.runId,
        activeStartedAtMillis: item.version.startedAtMillis,
        generatedAt: item.version.generatedAt,
        updatedAt: nowTimestamp(),
      };
      transaction.set(item.listRef, removeUndefinedDeep(manifest), {
        merge: false,
      });
      activationByList.set(item.listId, {
        previousVersion,
        staleVersion:
          staleVersion && staleVersion !== previousVersion
            ? staleVersion
            : undefined,
      });
    }
    return { activated: true, lists: activationByList };
  });
}

async function verifyAmbiguousActivation(
  source: LoadedSellerIndex,
  prepared: PreparedList[],
): Promise<boolean> {
  const [sourceSnapshot, ...manifestSnapshots] = await db.getAll(
    source.rootRef,
    ...prepared.map((item) => item.listRef),
  );
  const sourceRoot = sourceSnapshot.exists
    ? (sourceSnapshot.data() as Partial<SellerIndexRootDocument>)
    : undefined;
  if (sourceRoot?.activeVersion !== source.sourceSellerVersionId) return false;
  return prepared.every((item, index) => {
    const snapshot = manifestSnapshots[index];
    if (!snapshot.exists) return false;
    const manifest = snapshot.data() as Partial<SellerListViewManifestDocument>;
    return (
      manifest.activeVersion === item.version.versionId &&
      manifest.sourceSellerVersionId === source.sourceSellerVersionId
    );
  });
}

async function deleteVersion(
  listRef: DocumentReference,
  versionId: string,
): Promise<void> {
  const versionRef = listRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const blocksSnapshot = await versionRef.collection(BLOCKS_SUBCOLLECTION).get();
  const refs = [...blocksSnapshot.docs.map((doc) => doc.ref), versionRef];
  for (let index = 0; index < refs.length; index += DELETE_BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(index, index + DELETE_BATCH_SIZE)) {
      batch.delete(ref);
    }
    await batch.commit();
  }
}

async function deletePreparedVersions(prepared: PreparedList[]): Promise<void> {
  await Promise.all(
    prepared.map((item) =>
      deleteVersion(item.listRef, item.version.versionId).catch((error) => {
        console.warn("Failed to clean up rejected seller-list version", {
          listId: item.listId,
          versionId: item.version.versionId,
          error: error instanceof Error ? error.message : String(error),
        });
      }),
    ),
  );
}

export async function rebuildSellerListView(
  segment: SiteSegmentKey,
  options: { includeLists?: boolean } = {},
): Promise<RebuildSellerListViewResult> {
  const started = Date.now();
  const startedAtMillis = started;
  const runId = buildRunId(startedAtMillis);
  const generatedAt = nowTimestamp();
  const source = await loadSellerIndex(segment);

  const cardsByScope = new Map<SellerListViewContentScope, SellerCardItem[]>();
  for (const contentScope of SELLER_LIST_VIEW_CONTENT_SCOPES) {
    cardsByScope.set(
      contentScope,
      source.items
        .filter((item) => item.contentScope === contentScope)
        .map(toSellerCardItem),
    );
  }

  const prepared: PreparedList[] = [];
  try {
    for (const contentScope of SELLER_LIST_VIEW_CONTENT_SCOPES) {
      const sourceCards = cardsByScope.get(contentScope) ?? [];
      for (const sortMode of SELLER_LIST_VIEW_SORT_MODES) {
        const items = [...sourceCards].sort(compareSellerCardItems(sortMode));
        prepared.push(
          await prepareOneList(
            source,
            runId,
            startedAtMillis,
            contentScope,
            sortMode,
            items,
            generatedAt,
          ),
        );
      }
    }
  } catch (error) {
    await deletePreparedVersions(prepared);
    throw error;
  }

  let activation: ActivationResult;
  let activationRecoveryWarning: string | undefined;
  try {
    activation = await activatePreparedLists(source, prepared);
  } catch (error) {
    const activationError = error instanceof Error ? error.message : String(error);
    if (await verifyAmbiguousActivation(source, prepared)) {
      activation = {
        activated: true,
        lists: new Map(
          prepared.map((item) => [item.listId, {} satisfies ActivatedList]),
        ),
      };
      activationRecoveryWarning =
        `Activation transaction reported an error after all lists became active: ${activationError}`;
      console.warn("Recovered an ambiguously committed seller-list activation", {
        segmentId: source.segmentId,
        runId,
        error: activationError,
      });
    } else {
      await deletePreparedVersions(prepared);
      throw error;
    }
  }

  const listResults: RebuildSellerListViewListResult[] = [];
  if (!activation.activated) {
    await deletePreparedVersions(prepared);
    for (const item of prepared) {
      listResults.push({
        listId: item.listId,
        contentScope: item.contentScope,
        sortMode: item.sortMode,
        status: "rejected",
        reason: activation.reason,
        versionId: item.version.versionId,
        itemCount: item.itemCount,
        blockCount: item.blockCount,
        compressedBytes: item.compressedBytes,
      });
    }
  } else {
    for (const item of prepared) {
      const active = activation.lists.get(item.listId) ?? {};
      let cleanupError = activationRecoveryWarning;
      let cleanupDeletedVersion: string | undefined;
      if (active.staleVersion) {
        try {
          await deleteVersion(item.listRef, active.staleVersion);
          cleanupDeletedVersion = active.staleVersion;
        } catch (error) {
          cleanupError = error instanceof Error ? error.message : String(error);
          console.warn("Failed to clean up stale seller-list view version", {
            segmentId: source.segmentId,
            listId: item.listId,
            staleVersion: active.staleVersion,
            error: cleanupError,
          });
        }
      }
      listResults.push({
        listId: item.listId,
        contentScope: item.contentScope,
        sortMode: item.sortMode,
        status: "activated",
        versionId: item.version.versionId,
        previousVersion: active.previousVersion,
        itemCount: item.itemCount,
        blockCount: item.blockCount,
        compressedBytes: item.compressedBytes,
        cleanupDeletedVersion,
        cleanupError,
      });
    }
  }

  const activated = listResults.filter((result) => result.status === "activated");
  const result: RebuildSellerListViewResult = {
    segmentId: source.segmentId,
    runId,
    startedAtMillis,
    sourceSellerVersionId: source.sourceSellerVersionId,
    sellerItemCount: source.items.length,
    listCount: listResults.length,
    activatedListCount: activated.length,
    rejectedListCount: listResults.length - activated.length,
    totalItemOccurrences: listResults.reduce(
      (sum, item) => sum + item.itemCount,
      0,
    ),
    totalBlockCount: listResults.reduce(
      (sum, item) => sum + item.blockCount,
      0,
    ),
    totalCompressedBytes: listResults.reduce(
      (sum, item) => sum + item.compressedBytes,
      0,
    ),
    elapsedMs: Date.now() - started,
  };
  if (options.includeLists) result.lists = listResults;
  return result;
}

export async function rebuildSellerListViewsForTargets(
  targets: FetchTarget[],
  options: { includeLists?: boolean } = {},
): Promise<RebuildSellerListViewResult[]> {
  const unique = new Map<string, SiteSegmentKey>();
  for (const target of targets) {
    const key = buildSegmentId(target);
    unique.set(key, {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    });
  }
  const results: RebuildSellerListViewResult[] = [];
  for (const segment of unique.values()) {
    results.push(await rebuildSellerListView(segment, options));
  }
  return results;
}
