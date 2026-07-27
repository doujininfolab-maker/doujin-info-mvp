import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type {
  ProductListFilter,
  SellerCardItem,
  SellerListViewBlockDescriptor,
  SellerListViewCompressedBlockDocument,
  SellerListViewManifestDocument,
  SellerListViewStatus,
  SellerListViewVersionDocument,
  SellerSortMode,
} from "../types";
import { getAdminDb } from "./admin";

const SELLER_LIST_VIEWS_COLLECTION = "sellerListViews";
const LISTS_SUBCOLLECTION = "sellerListViewLists";
const VERSIONS_SUBCOLLECTION = "sellerListViewVersions";
const BLOCKS_SUBCOLLECTION = "sellerListViewBlocks";
const SCHEMA_VERSION = 1;
const MAX_COMPRESSED_BYTES = 700 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

export type SellerListViewPageResult = {
  sellers: SellerCardItem[];
  totalCount: number;
  segmentId: string;
  listId: string;
  versionId: string;
  sourceSellerVersionId: string;
  usedPreviousVersion: boolean;
  blockIds: string[];
  firestoreReadEstimate: number;
};

type VersionMetadata = {
  status: SellerListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: SellerListViewBlockDescriptor[];
  sourceSellerVersionId: string;
};

function buildSegmentId(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function contentScopeForFilter(filter: ProductListFilter): "all" | "tl" | "bl" {
  return filter.contentType ?? "all";
}

function buildListId(
  contentScope: "all" | "tl" | "bl",
  sortMode: SellerSortMode,
): string {
  return `${contentScope}_${sortMode}`;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isBlockDescriptor(value: unknown): value is SellerListViewBlockDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<SellerListViewBlockDescriptor>;
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
    !isString(value.sourceSellerVersionId)
  ) {
    throw new Error(`Seller-list view metadata is invalid: ${context}`);
  }

  const blocks = [...value.blocks].sort(
    (left, right) => left.blockIndex - right.blockIndex,
  );
  let expectedOffset = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.blockIndex !== index || block.startOffset !== expectedOffset) {
      throw new Error(`Seller-list block ranges are invalid: ${context}`);
    }
    expectedOffset += block.itemCount;
  }
  if (expectedOffset !== value.itemCount) {
    throw new Error(`Seller-list item count is inconsistent: ${context}`);
  }
  if (value.status === "empty" && (value.itemCount !== 0 || blocks.length !== 0)) {
    throw new Error(`Seller-list empty metadata is inconsistent: ${context}`);
  }
  if (value.status === "ready" && value.itemCount > 0 && blocks.length === 0) {
    throw new Error(`Seller-list ready metadata has no blocks: ${context}`);
  }

  return {
    status: value.status,
    itemCount: value.itemCount,
    blockCount: value.blockCount,
    blocks,
    sourceSellerVersionId: value.sourceSellerVersionId,
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

function isTag(value: unknown): value is { name: string; count: number } {
  if (!value || typeof value !== "object") return false;
  const tag = value as { name?: unknown; count?: unknown };
  return isString(tag.name) && isFiniteNonNegativeInteger(tag.count);
}

function isSellerCardItem(value: unknown): value is SellerCardItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SellerCardItem>;
  return (
    isString(item.sellerKey) &&
    isString(item.sellerName) &&
    isString(item.platform) &&
    isString(item.audience) &&
    isString(item.category) &&
    isFiniteNonNegativeInteger(item.productCount) &&
    isFiniteNonNegativeInteger(item.totalSalesCount) &&
    isFiniteNonNegativeInteger(item.averageSalesCount) &&
    isFiniteNumber(item.estimatedRevenue) &&
    isString(item.cardImageUrl) &&
    Array.isArray(item.tags) &&
    item.tags.every(isTag)
  );
}

function decodeBlock(
  data: Partial<SellerListViewCompressedBlockDocument>,
  descriptor: SellerListViewBlockDescriptor,
  listId: string,
  versionId: string,
): SellerCardItem[] {
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
      `Seller-list block metadata is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }
  if (
    payload.length !== descriptor.compressedBytes ||
    payload.length > MAX_COMPRESSED_BYTES ||
    sha256Hex(payload) !== descriptor.checksum
  ) {
    throw new Error(
      `Seller-list block checksum or size is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }

  const uncompressed = gunzipSync(payload);
  if (
    uncompressed.length !== descriptor.uncompressedBytes ||
    uncompressed.length > MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error(
      `Seller-list uncompressed block size is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }

  const parsed: unknown = JSON.parse(uncompressed.toString("utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== descriptor.itemCount ||
    !parsed.every(isSellerCardItem)
  ) {
    throw new Error(
      `Seller-list block payload is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }
  return parsed;
}

async function loadPageFromVersion(
  listRef: FirebaseFirestore.DocumentReference,
  listId: string,
  versionId: string,
  metadata: VersionMetadata,
  offset: number,
  limit: number,
  baseReadEstimate: number,
): Promise<Omit<SellerListViewPageResult, "segmentId" | "usedPreviousVersion">> {
  if (offset >= metadata.itemCount || limit <= 0) {
    return {
      sellers: [],
      totalCount: metadata.itemCount,
      listId,
      versionId,
      sourceSellerVersionId: metadata.sourceSellerVersionId,
      blockIds: [],
      firestoreReadEstimate: baseReadEstimate,
    };
  }

  const endOffset = Math.min(metadata.itemCount, offset + limit);
  const descriptors = metadata.blocks.filter((block) => {
    const blockEnd = block.startOffset + block.itemCount;
    return block.startOffset < endOffset && blockEnd > offset;
  });
  if (descriptors.length === 0) {
    throw new Error(`No seller-list blocks cover the requested page: ${listId}`);
  }

  const versionRef = listRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const refs = descriptors.map((descriptor) =>
    versionRef.collection(BLOCKS_SUBCOLLECTION).doc(descriptor.blockId),
  );
  const snapshots = await getAdminDb().getAll(...refs);
  const sellers: SellerCardItem[] = [];

  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    const snapshot = snapshots[index];
    if (!snapshot.exists) {
      throw new Error(
        `Seller-list block is missing: ${listId}/${versionId}/${descriptor.blockId}`,
      );
    }
    const items = decodeBlock(
      snapshot.data() as Partial<SellerListViewCompressedBlockDocument>,
      descriptor,
      listId,
      versionId,
    );
    const localStart = Math.max(0, offset - descriptor.startOffset);
    const localEnd = Math.min(
      descriptor.itemCount,
      endOffset - descriptor.startOffset,
    );
    sellers.push(...items.slice(localStart, localEnd));
  }

  const expectedCount = endOffset - offset;
  if (sellers.length !== expectedCount) {
    throw new Error(
      `Seller-list page item count mismatch: list=${listId}, expected=${expectedCount}, actual=${sellers.length}`,
    );
  }

  return {
    sellers,
    totalCount: metadata.itemCount,
    listId,
    versionId,
    sourceSellerVersionId: metadata.sourceSellerVersionId,
    blockIds: descriptors.map((descriptor) => descriptor.blockId),
    firestoreReadEstimate: baseReadEstimate + descriptors.length,
  };
}

async function loadPreviousMetadata(
  listRef: FirebaseFirestore.DocumentReference,
  listId: string,
  previousVersion: string,
  contentScope: "all" | "tl" | "bl",
  sortMode: SellerSortMode,
): Promise<VersionMetadata> {
  const snapshot = await listRef
    .collection(VERSIONS_SUBCOLLECTION)
    .doc(previousVersion)
    .get();
  if (!snapshot.exists) {
    throw new Error(`Previous seller-list version is missing: ${listId}/${previousVersion}`);
  }
  const version = snapshot.data() as Partial<SellerListViewVersionDocument>;
  if (
    version.schemaVersion !== SCHEMA_VERSION ||
    version.listId !== listId ||
    version.versionId !== previousVersion ||
    version.contentScope !== contentScope ||
    version.sortMode !== sortMode
  ) {
    throw new Error(`Previous seller-list version is invalid: ${listId}/${previousVersion}`);
  }
  return validateVersionMetadata(version, `${listId}/${previousVersion}`);
}

export async function getSellerListViewPage(
  filter: ProductListFilter,
  sortMode: SellerSortMode,
): Promise<SellerListViewPageResult | undefined> {
  const segmentId = buildSegmentId(filter);
  const contentScope = contentScopeForFilter(filter);
  const listId = buildListId(contentScope, sortMode);
  const offset = Math.max(0, filter.offsetCount ?? 0);
  const limit = Math.max(0, filter.limitCount ?? 30);
  const listRef = getAdminDb()
    .collection(SELLER_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const manifestSnapshot = await listRef.get();
  if (!manifestSnapshot.exists) return undefined;

  const manifest = manifestSnapshot.data() as Partial<SellerListViewManifestDocument>;
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.segmentId !== segmentId ||
    manifest.listId !== listId ||
    manifest.contentScope !== contentScope ||
    manifest.sortMode !== sortMode ||
    !isString(manifest.activeVersion) ||
    !isString(manifest.sourceSellerVersionId)
  ) {
    console.warn("Seller-list manifest is invalid", { segmentId, listId });
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
      offset,
      limit,
      1,
    );
    return { ...page, segmentId, usedPreviousVersion: false };
  } catch (activeError) {
    console.error("Active seller-list view failed validation", {
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
      contentScope,
      sortMode,
    );
    const page = await loadPageFromVersion(
      listRef,
      listId,
      manifest.previousVersion,
      metadata,
      offset,
      limit,
      2,
    );
    console.warn("Using previous seller-list view version", {
      segmentId,
      listId,
      previousVersion: manifest.previousVersion,
    });
    return { ...page, segmentId, usedPreviousVersion: true };
  } catch (previousError) {
    console.error("Previous seller-list view also failed validation", {
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
