import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type {
  ProductCardItem,
  ProductListFilter,
  SaleListViewBlockDescriptor,
  SaleListViewCompressedBlockDocument,
  SaleListViewContentScope,
  SaleListViewManifestDocument,
  SaleListViewStatus,
  SaleListViewThreshold,
  SaleListViewThresholdCounts,
  SaleListViewVersionDocument,
  SaleListViewWorkType,
  SaleSortMode,
} from "../types";
import { getAdminDb } from "./admin";

const SALE_LIST_VIEWS_COLLECTION = "saleListViews";
const LISTS_SUBCOLLECTION = "saleListViewLists";
const VERSIONS_SUBCOLLECTION = "saleListViewVersions";
const BLOCKS_SUBCOLLECTION = "saleListViewBlocks";
const SCHEMA_VERSION = 1;
const MAX_COMPRESSED_BYTES = 700 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const VALID_THRESHOLDS: SaleListViewThreshold[] = [0, 30, 50, 70, 90];

export type SaleListViewPageResult = {
  products: ProductCardItem[];
  totalCount: number;
  segmentId: string;
  listId: string;
  versionId: string;
  sourceSearchVersionId: string;
  usedPreviousVersion: boolean;
  blockIds: string[];
  firestoreReadEstimate: number;
};

type VersionMetadata = {
  status: SaleListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: SaleListViewBlockDescriptor[];
  sortMode: SaleSortMode;
  threshold: SaleListViewThreshold;
  thresholdCounts?: SaleListViewThresholdCounts;
  sourceSearchVersionId: string;
};

function buildSegmentId(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function contentScopeForFilter(filter: ProductListFilter): SaleListViewContentScope {
  return filter.contentType ?? "all";
}

function workTypeForFilter(filter: ProductListFilter): SaleListViewWorkType {
  return filter.workType ?? "all";
}

function thresholdForFilter(filter: ProductListFilter): SaleListViewThreshold {
  const threshold = filter.discountRateMin ?? 0;
  return VALID_THRESHOLDS.includes(threshold as SaleListViewThreshold)
    ? (threshold as SaleListViewThreshold)
    : 0;
}

function buildListId(
  contentScope: SaleListViewContentScope,
  workType: SaleListViewWorkType,
  sortMode: SaleSortMode,
  threshold: SaleListViewThreshold,
): string {
  return sortMode === "discountRate"
    ? `${contentScope}_${workType}_discountRate_all`
    : `${contentScope}_${workType}_${sortMode}_${threshold}`;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && isFiniteNonNegativeNumber(value);
}

function isThreshold(value: unknown): value is SaleListViewThreshold {
  return VALID_THRESHOLDS.includes(value as SaleListViewThreshold);
}

function isThresholdCounts(value: unknown): value is SaleListViewThresholdCounts {
  if (!value || typeof value !== "object") return false;
  const counts = value as Partial<Record<SaleListViewThreshold, unknown>>;
  return VALID_THRESHOLDS.every((threshold) =>
    isFiniteNonNegativeInteger(counts[threshold]),
  );
}

function isBlockDescriptor(value: unknown): value is SaleListViewBlockDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<SaleListViewBlockDescriptor>;
  return (
    isString(descriptor.blockId) &&
    isFiniteNonNegativeInteger(descriptor.blockIndex) &&
    isFiniteNonNegativeInteger(descriptor.startOffset) &&
    isFiniteNonNegativeInteger(descriptor.itemCount) &&
    isFiniteNonNegativeInteger(descriptor.compressedBytes) &&
    isFiniteNonNegativeInteger(descriptor.uncompressedBytes) &&
    isString(descriptor.checksum)
  );
}

function validateVersionMetadata(
  value: Partial<VersionMetadata>,
  context: string,
): VersionMetadata {
  if (
    (value.status !== "ready" && value.status !== "empty") ||
    !isFiniteNonNegativeInteger(value.itemCount) ||
    !isFiniteNonNegativeInteger(value.blockCount) ||
    !Array.isArray(value.blocks) ||
    !value.blocks.every(isBlockDescriptor) ||
    value.blocks.length !== value.blockCount ||
    (value.sortMode !== "discountRate" &&
      value.sortMode !== "discountAmount" &&
      value.sortMode !== "newest") ||
    !isThreshold(value.threshold) ||
    !isString(value.sourceSearchVersionId)
  ) {
    throw new Error(`Sale-list view metadata is invalid: ${context}`);
  }
  if (
    value.sortMode === "discountRate" &&
    (!isThresholdCounts(value.thresholdCounts) || value.threshold !== 0)
  ) {
    throw new Error(`Sale-list threshold counts are invalid: ${context}`);
  }
  if (value.sortMode !== "discountRate" && value.thresholdCounts !== undefined) {
    throw new Error(`Sale-list threshold counts are unexpected: ${context}`);
  }

  const blocks = [...value.blocks].sort(
    (left, right) => left.blockIndex - right.blockIndex,
  );
  let expectedOffset = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.blockIndex !== index || block.startOffset !== expectedOffset) {
      throw new Error(`Sale-list block ranges are invalid: ${context}`);
    }
    expectedOffset += block.itemCount;
  }
  if (expectedOffset !== value.itemCount) {
    throw new Error(`Sale-list item count is inconsistent: ${context}`);
  }
  if (value.status === "empty" && (value.itemCount !== 0 || blocks.length !== 0)) {
    throw new Error(`Sale-list empty metadata is inconsistent: ${context}`);
  }
  if (value.status === "ready" && value.itemCount > 0 && blocks.length === 0) {
    throw new Error(`Sale-list ready metadata has no blocks: ${context}`);
  }
  if (
    value.sortMode === "discountRate" &&
    value.thresholdCounts &&
    (value.thresholdCounts[0] !== value.itemCount ||
      value.thresholdCounts[30] < value.thresholdCounts[50] ||
      value.thresholdCounts[50] < value.thresholdCounts[70] ||
      value.thresholdCounts[70] < value.thresholdCounts[90])
  ) {
    throw new Error(`Sale-list threshold counts are inconsistent: ${context}`);
  }

  return {
    status: value.status,
    itemCount: value.itemCount,
    blockCount: value.blockCount,
    blocks,
    sortMode: value.sortMode,
    threshold: value.threshold,
    thresholdCounts: value.thresholdCounts,
    sourceSearchVersionId: value.sourceSearchVersionId,
  };
}

function toBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object") {
    const maybeBytes = value as { toUint8Array?: () => Uint8Array };
    if (typeof maybeBytes.toUint8Array === "function") {
      return Buffer.from(maybeBytes.toUint8Array());
    }
  }
  return undefined;
}

function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isProductCardItem(value: unknown): value is ProductCardItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProductCardItem>;
  return (
    isString(item.productId) &&
    isString(item.platform) &&
    isString(item.audience) &&
    isString(item.category) &&
    isString(item.title) &&
    Array.isArray(item.genres) &&
    Array.isArray(item.genreIds) &&
    Array.isArray(item.tags)
  );
}

function decodeBlock(
  data: Partial<SaleListViewCompressedBlockDocument>,
  descriptor: SaleListViewBlockDescriptor,
  listId: string,
  versionId: string,
): ProductCardItem[] {
  const payload = toBuffer(data.payload);
  if (
    data.schemaVersion !== SCHEMA_VERSION ||
    data.encoding !== "gzip-json-v1" ||
    data.listId !== listId ||
    data.versionId !== versionId ||
    data.blockId !== descriptor.blockId ||
    data.blockIndex !== descriptor.blockIndex ||
    data.startOffset !== descriptor.startOffset ||
    data.itemCount !== descriptor.itemCount ||
    data.compressedBytes !== descriptor.compressedBytes ||
    data.uncompressedBytes !== descriptor.uncompressedBytes ||
    data.checksum !== descriptor.checksum ||
    !payload
  ) {
    throw new Error(
      `Sale-list block metadata is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }
  if (
    payload.length !== descriptor.compressedBytes ||
    payload.length > MAX_COMPRESSED_BYTES ||
    sha256Hex(payload) !== descriptor.checksum
  ) {
    throw new Error(
      `Sale-list block checksum or size is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }

  const uncompressed = gunzipSync(payload);
  if (
    uncompressed.length !== descriptor.uncompressedBytes ||
    uncompressed.length > MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error(
      `Sale-list uncompressed block size is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }

  const parsed: unknown = JSON.parse(uncompressed.toString("utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== descriptor.itemCount ||
    !parsed.every(isProductCardItem)
  ) {
    throw new Error(
      `Sale-list block payload is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }
  return parsed;
}

function totalCountForThreshold(
  metadata: VersionMetadata,
  requestedThreshold: SaleListViewThreshold,
): number {
  if (metadata.sortMode !== "discountRate") return metadata.itemCount;
  const count = metadata.thresholdCounts?.[requestedThreshold];
  if (!isFiniteNonNegativeInteger(count) || count > metadata.itemCount) {
    throw new Error(
      `Sale-list threshold count is unavailable: threshold=${requestedThreshold}`,
    );
  }
  return count;
}

async function loadPageFromVersion(
  listRef: FirebaseFirestore.DocumentReference,
  listId: string,
  versionId: string,
  metadata: VersionMetadata,
  requestedThreshold: SaleListViewThreshold,
  offset: number,
  limit: number,
  baseReadEstimate: number,
): Promise<Omit<SaleListViewPageResult, "segmentId" | "usedPreviousVersion">> {
  const totalCount = totalCountForThreshold(metadata, requestedThreshold);
  if (offset >= totalCount || limit <= 0) {
    return {
      products: [],
      totalCount,
      listId,
      versionId,
      sourceSearchVersionId: metadata.sourceSearchVersionId,
      blockIds: [],
      firestoreReadEstimate: baseReadEstimate,
    };
  }

  const endOffset = Math.min(totalCount, offset + limit);
  const descriptors = metadata.blocks.filter((block) => {
    const blockEnd = block.startOffset + block.itemCount;
    return block.startOffset < endOffset && blockEnd > offset;
  });
  if (descriptors.length === 0) {
    throw new Error(`No sale-list blocks cover the requested page: ${listId}`);
  }

  const versionRef = listRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const refs = descriptors.map((descriptor) =>
    versionRef.collection(BLOCKS_SUBCOLLECTION).doc(descriptor.blockId),
  );
  const snapshots = await getAdminDb().getAll(...refs);
  const products: ProductCardItem[] = [];

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const snapshot = snapshots[index];
    if (!snapshot.exists) {
      throw new Error(
        `Sale-list block is missing: ${listId}/${versionId}/${descriptor.blockId}`,
      );
    }
    const items = decodeBlock(
      snapshot.data() as Partial<SaleListViewCompressedBlockDocument>,
      descriptor,
      listId,
      versionId,
    );
    const localStart = Math.max(0, offset - descriptor.startOffset);
    const localEnd = Math.min(
      descriptor.itemCount,
      endOffset - descriptor.startOffset,
    );
    products.push(...items.slice(localStart, localEnd));
  }

  const expectedCount = endOffset - offset;
  if (products.length !== expectedCount) {
    throw new Error(
      `Sale-list page item count mismatch: list=${listId}, expected=${expectedCount}, actual=${products.length}`,
    );
  }

  return {
    products,
    totalCount,
    listId,
    versionId,
    sourceSearchVersionId: metadata.sourceSearchVersionId,
    blockIds: descriptors.map((descriptor) => descriptor.blockId),
    firestoreReadEstimate: baseReadEstimate + descriptors.length,
  };
}

async function loadPreviousMetadata(
  listRef: FirebaseFirestore.DocumentReference,
  listId: string,
  previousVersion: string,
): Promise<VersionMetadata> {
  const snapshot = await listRef
    .collection(VERSIONS_SUBCOLLECTION)
    .doc(previousVersion)
    .get();
  if (!snapshot.exists) {
    throw new Error(`Previous sale-list version is missing: ${listId}/${previousVersion}`);
  }
  const version = snapshot.data() as Partial<SaleListViewVersionDocument>;
  if (
    version.schemaVersion !== SCHEMA_VERSION ||
    version.listId !== listId ||
    version.versionId !== previousVersion
  ) {
    throw new Error(`Previous sale-list version is invalid: ${listId}/${previousVersion}`);
  }
  return validateVersionMetadata(version, `${listId}/${previousVersion}`);
}

export async function getSaleListViewPage(
  filter: ProductListFilter,
  sortMode: SaleSortMode,
): Promise<SaleListViewPageResult | undefined> {
  const segmentId = buildSegmentId(filter);
  const contentScope = contentScopeForFilter(filter);
  const workType = workTypeForFilter(filter);
  const requestedThreshold = thresholdForFilter(filter);
  const listThreshold = sortMode === "discountRate" ? 0 : requestedThreshold;
  const listId = buildListId(contentScope, workType, sortMode, listThreshold);
  const offset = Math.max(0, filter.offsetCount ?? 0);
  const limit = Math.max(0, filter.limitCount ?? 24);
  const listRef = getAdminDb()
    .collection(SALE_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const manifestSnapshot = await listRef.get();
  if (!manifestSnapshot.exists) return undefined;

  const manifest = manifestSnapshot.data() as Partial<SaleListViewManifestDocument>;
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.segmentId !== segmentId ||
    manifest.listId !== listId ||
    manifest.contentScope !== contentScope ||
    manifest.workType !== workType ||
    manifest.sortMode !== sortMode ||
    manifest.threshold !== listThreshold ||
    !isString(manifest.activeVersion)
  ) {
    console.warn("Sale-list manifest is invalid", { segmentId, listId });
    return undefined;
  }

  try {
    const metadata = validateVersionMetadata(
      manifest,
      `${listId}/${manifest.activeVersion}`,
    );
    const page = await loadPageFromVersion(
      listRef,
      listId,
      manifest.activeVersion,
      metadata,
      requestedThreshold,
      offset,
      limit,
      1,
    );
    return { ...page, segmentId, usedPreviousVersion: false };
  } catch (activeError) {
    console.error("Active sale-list view failed validation", {
      segmentId,
      listId,
      activeVersion: manifest.activeVersion,
      error: activeError instanceof Error ? activeError.message : String(activeError),
    });
  }

  if (!isString(manifest.previousVersion)) return undefined;

  try {
    const metadata = await loadPreviousMetadata(
      listRef,
      listId,
      manifest.previousVersion,
    );
    const page = await loadPageFromVersion(
      listRef,
      listId,
      manifest.previousVersion,
      metadata,
      requestedThreshold,
      offset,
      limit,
      2,
    );
    console.warn("Using previous sale-list view version", {
      segmentId,
      listId,
      previousVersion: manifest.previousVersion,
    });
    return { ...page, segmentId, usedPreviousVersion: true };
  } catch (previousError) {
    console.error("Previous sale-list view also failed validation", {
      segmentId,
      listId,
      previousVersion: manifest.previousVersion,
      error:
        previousError instanceof Error
          ? previousError.message
          : String(previousError),
    });
    return undefined;
  }
}
