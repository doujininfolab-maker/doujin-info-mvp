import { randomUUID } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  ProductCardItem,
  SaleListViewManifestDocument,
  SaleListViewThreshold,
  SaleListViewThresholdCounts,
  SaleListViewVersionDocument,
  SaleSortMode,
  SearchIndexRootDocument,
} from "../types";
import { nowTimestamp } from "../util";
import { loadProjectedProductsForNewListView } from "./listViews/loadNewListViewProducts";
import {
  SALE_LIST_VIEW_CONTENT_SCOPES,
  SALE_LIST_VIEW_SCHEMA_VERSION,
  SALE_LIST_VIEW_SORT_MODES,
  SALE_LIST_VIEW_THRESHOLDS,
  SALE_LIST_VIEW_WORK_TYPES,
  buildCompressedSaleListBlocks,
  buildSaleListChecksum,
  buildSaleListViewListId,
  buildSaleListViewThresholdCounts,
  compareSaleListProducts,
  isSaleListProduct,
  removeUndefinedDeep,
  saleListViewProductHasScope,
  saleListViewProductMatchesWorkType,
  toProductCardItem,
  type SaleListViewContentScope,
  type SaleListViewSourceProduct,
  type SaleListViewWorkType,
} from "./listViews/saleListViewShared";

const SEARCH_INDEXES_COLLECTION = "searchIndexes";
const SEARCH_INDEX_SCHEMA_VERSION = 2;
const SALE_LIST_VIEWS_COLLECTION = "saleListViews";
const LISTS_SUBCOLLECTION = "saleListViewLists";
const VERSIONS_SUBCOLLECTION = "saleListViewVersions";
const BLOCKS_SUBCOLLECTION = "saleListViewBlocks";
const DELETE_BATCH_SIZE = 400;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

type SaleListDefinition = {
  contentScope: SaleListViewContentScope;
  workType: SaleListViewWorkType;
  sortMode: SaleSortMode;
  threshold: SaleListViewThreshold;
  thresholdCounts?: SaleListViewThresholdCounts;
  items: ProductCardItem[];
};

type PreparedList = {
  listId: string;
  contentScope: SaleListViewContentScope;
  workType: SaleListViewWorkType;
  sortMode: SaleSortMode;
  threshold: SaleListViewThreshold;
  listRef: DocumentReference;
  version: SaleListViewVersionDocument;
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
      reason: "newer_run_active" | "source_search_version_changed";
    };

export type RebuildSaleListViewListResult = {
  listId: string;
  contentScope: SaleListViewContentScope;
  workType: SaleListViewWorkType;
  sortMode: SaleSortMode;
  threshold: SaleListViewThreshold;
  thresholdCounts?: SaleListViewThresholdCounts;
  status: "activated" | "rejected";
  reason?:
    | "newer_run_active"
    | "source_search_version_changed"
    | "generation_failed";
  versionId: string;
  previousVersion?: string;
  itemCount: number;
  blockCount: number;
  compressedBytes: number;
  cleanupDeletedVersion?: string;
  cleanupError?: string;
};

export type RebuildSaleListViewResult = {
  segmentId: string;
  runId: string;
  startedAtMillis: number;
  sourceSearchVersionId: string;
  productCount: number;
  saleProductCount: number;
  groupCount: number;
  listCount: number;
  activatedListCount: number;
  rejectedListCount: number;
  totalItemOccurrences: number;
  totalBlockCount: number;
  totalCompressedBytes: number;
  elapsedMs: number;
  lists?: RebuildSaleListViewListResult[];
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

async function loadSourceSearchVersion(
  segmentId: string,
): Promise<{ rootRef: DocumentReference; activeVersion: string }> {
  const rootRef = db.collection(SEARCH_INDEXES_COLLECTION).doc(segmentId);
  const snapshot = await rootRef.get();
  if (!snapshot.exists) {
    throw new Error(`Search index root is missing: ${segmentId}`);
  }
  const root = snapshot.data() as Partial<SearchIndexRootDocument>;
  if (
    root.schemaVersion !== SEARCH_INDEX_SCHEMA_VERSION ||
    typeof root.activeVersion !== "string" ||
    root.activeVersion.length === 0
  ) {
    throw new Error(`Search index root is invalid: ${segmentId}`);
  }
  return { rootRef, activeVersion: root.activeVersion };
}

async function writeReadyVersion(
  listRef: DocumentReference,
  version: SaleListViewVersionDocument,
  blocks: ReturnType<typeof buildCompressedSaleListBlocks>,
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
  segmentId: string,
  sourceSearchVersionId: string,
  sourceProductCount: number,
  runId: string,
  startedAtMillis: number,
  definition: SaleListDefinition,
  generatedAt: Timestamp,
): Promise<PreparedList> {
  const listId = buildSaleListViewListId(
    definition.contentScope,
    definition.workType,
    definition.sortMode,
    definition.threshold,
  );
  const versionId = `${runId}_${listId}`;
  const listRef = db
    .collection(SALE_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const blocks = buildCompressedSaleListBlocks(
    listId,
    versionId,
    definition.items,
    generatedAt,
  );
  const version: SaleListViewVersionDocument = {
    schemaVersion: SALE_LIST_VIEW_SCHEMA_VERSION,
    segmentId,
    listId,
    contentScope: definition.contentScope,
    workType: definition.workType,
    sortMode: definition.sortMode,
    threshold: definition.threshold,
    thresholdCounts: definition.thresholdCounts,
    versionId,
    runId,
    startedAtMillis,
    sourceSearchVersionId,
    sourceProductCount,
    status: definition.items.length > 0 ? "ready" : "empty",
    itemCount: definition.items.length,
    blockCount: blocks.length,
    blocks: blocks.map((block) => block.descriptor),
    listChecksum: buildSaleListChecksum(definition.items, blocks),
    generatedAt,
    updatedAt: generatedAt,
  };
  await writeReadyVersion(listRef, version, blocks);
  return {
    listId,
    contentScope: definition.contentScope,
    workType: definition.workType,
    sortMode: definition.sortMode,
    threshold: definition.threshold,
    listRef,
    version,
    itemCount: definition.items.length,
    blockCount: blocks.length,
    compressedBytes: blocks.reduce(
      (sum, block) => sum + block.descriptor.compressedBytes,
      0,
    ),
  };
}

async function activatePreparedLists(
  searchRootRef: DocumentReference,
  sourceSearchVersionId: string,
  prepared: PreparedList[],
): Promise<ActivationResult> {
  return db.runTransaction(async (transaction) => {
    const sourceSnapshot = await transaction.get(searchRootRef);
    const sourceRoot = sourceSnapshot.exists
      ? (sourceSnapshot.data() as Partial<SearchIndexRootDocument>)
      : undefined;
    if (sourceRoot?.activeVersion !== sourceSearchVersionId) {
      return { activated: false, reason: "source_search_version_changed" };
    }

    const snapshots = await transaction.getAll(
      ...prepared.map((item) => item.listRef),
    );
    for (let index = 0; index < prepared.length; index += 1) {
      const existing = snapshots[index].exists
        ? (snapshots[index].data() as Partial<SaleListViewManifestDocument>)
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
        ? (snapshots[index].data() as Partial<SaleListViewManifestDocument>)
        : undefined;
      const previousVersion = existing?.activeVersion;
      const staleVersion = existing?.previousVersion;
      const manifest: SaleListViewManifestDocument = {
        schemaVersion: SALE_LIST_VIEW_SCHEMA_VERSION,
        segmentId: item.version.segmentId,
        listId: item.version.listId,
        contentScope: item.version.contentScope,
        workType: item.version.workType,
        sortMode: item.version.sortMode,
        threshold: item.version.threshold,
        thresholdCounts: item.version.thresholdCounts,
        activeVersion: item.version.versionId,
        previousVersion:
          previousVersion && previousVersion !== item.version.versionId
            ? previousVersion
            : undefined,
        sourceSearchVersionId,
        sourceProductCount: item.version.sourceProductCount,
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

function buildGroupDefinitions(
  contentScope: SaleListViewContentScope,
  workType: SaleListViewWorkType,
  products: SaleListViewSourceProduct[],
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): SaleListDefinition[] {
  const workProducts = products.filter(
    (product) =>
      saleListViewProductHasScope(product, contentScope) &&
      saleListViewProductMatchesWorkType(product, workType),
  );

  const definitions: SaleListDefinition[] = [];
  const discountRateSorted = [...workProducts].sort(
    compareSaleListProducts("discountRate"),
  );
  const thresholdCounts = buildSaleListViewThresholdCounts(discountRateSorted);
  definitions.push({
    contentScope,
    workType,
    sortMode: "discountRate",
    threshold: 0,
    thresholdCounts,
    items: discountRateSorted.map((product) => {
      const card = cardsByProductId.get(product.productId);
      if (!card) throw new Error(`Sale-list product card is missing: ${product.productId}`);
      return card;
    }),
  });

  for (const sortMode of SALE_LIST_VIEW_SORT_MODES.filter(
    (candidate) => candidate !== "discountRate",
  )) {
    const sorted = [...workProducts].sort(compareSaleListProducts(sortMode));
    for (const threshold of SALE_LIST_VIEW_THRESHOLDS) {
      const items = sorted
        .filter((product) => (product.discountRate ?? 0) >= threshold)
        .map((product) => {
          const card = cardsByProductId.get(product.productId);
          if (!card) {
            throw new Error(`Sale-list product card is missing: ${product.productId}`);
          }
          return card;
        });
      definitions.push({
        contentScope,
        workType,
        sortMode,
        threshold,
        items,
      });
    }
  }
  return definitions;
}

async function rebuildSaleListView(
  segment: SiteSegmentKey,
  options: { includeLists?: boolean } = {},
): Promise<RebuildSaleListViewResult> {
  const startedAt = Date.now();
  const runId = buildRunId(startedAt);
  const segmentId = buildSegmentId(segment);
  const generatedAt = nowTimestamp();
  const source = await loadSourceSearchVersion(segmentId);
  const products = await loadProjectedProductsForNewListView(segment);
  const saleProducts = products.filter(isSaleListProduct);
  const cardsByProductId = new Map(
    saleProducts.map((product) => [product.productId, toProductCardItem(product)]),
  );
  const prepared: PreparedList[] = [];

  try {
    for (const contentScope of SALE_LIST_VIEW_CONTENT_SCOPES) {
      for (const workType of SALE_LIST_VIEW_WORK_TYPES) {
        const definitions = buildGroupDefinitions(
          contentScope,
          workType,
          saleProducts,
          cardsByProductId,
        );
        for (const definition of definitions) {
          prepared.push(
            await prepareOneList(
              segmentId,
              source.activeVersion,
              products.length,
              runId,
              startedAt,
              definition,
              generatedAt,
            ),
          );
        }
      }
    }
  } catch (error) {
    for (const item of prepared) {
      await deleteVersion(item.listRef, item.version.versionId).catch(
        () => undefined,
      );
    }
    throw error;
  }

  const activation = await activatePreparedLists(
    source.rootRef,
    source.activeVersion,
    prepared,
  );
  const listResults: RebuildSaleListViewListResult[] = [];

  if (!activation.activated) {
    for (const item of prepared) {
      await deleteVersion(item.listRef, item.version.versionId).catch(
        () => undefined,
      );
      listResults.push({
        listId: item.listId,
        contentScope: item.contentScope,
        workType: item.workType,
        sortMode: item.sortMode,
        threshold: item.threshold,
        thresholdCounts: item.version.thresholdCounts,
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
      const activated = activation.lists.get(item.listId);
      const result: RebuildSaleListViewListResult = {
        listId: item.listId,
        contentScope: item.contentScope,
        workType: item.workType,
        sortMode: item.sortMode,
        threshold: item.threshold,
        thresholdCounts: item.version.thresholdCounts,
        status: "activated",
        versionId: item.version.versionId,
        previousVersion: activated?.previousVersion,
        itemCount: item.itemCount,
        blockCount: item.blockCount,
        compressedBytes: item.compressedBytes,
      };
      if (activated?.staleVersion) {
        try {
          await deleteVersion(item.listRef, activated.staleVersion);
          result.cleanupDeletedVersion = activated.staleVersion;
        } catch (error) {
          result.cleanupError =
            error instanceof Error ? error.message : String(error);
        }
      }
      listResults.push(result);
    }
  }

  return {
    segmentId,
    runId,
    startedAtMillis: startedAt,
    sourceSearchVersionId: source.activeVersion,
    productCount: products.length,
    saleProductCount: saleProducts.length,
    groupCount:
      SALE_LIST_VIEW_CONTENT_SCOPES.length * SALE_LIST_VIEW_WORK_TYPES.length,
    listCount: listResults.length,
    activatedListCount: listResults.filter((item) => item.status === "activated")
      .length,
    rejectedListCount: listResults.filter((item) => item.status === "rejected")
      .length,
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
    elapsedMs: Date.now() - startedAt,
    lists: options.includeLists ? listResults : undefined,
  };
}

export async function rebuildSaleListViewsForTargets(
  targets: FetchTarget[],
  options: { includeLists?: boolean } = {},
): Promise<RebuildSaleListViewResult[]> {
  const unique = new Map<string, SiteSegmentKey>();
  for (const target of targets) {
    const segment: SiteSegmentKey = {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    };
    unique.set(buildSegmentId(segment), segment);
  }

  const results: RebuildSaleListViewResult[] = [];
  for (const segment of unique.values()) {
    results.push(await rebuildSaleListView(segment, options));
  }
  return results;
}
