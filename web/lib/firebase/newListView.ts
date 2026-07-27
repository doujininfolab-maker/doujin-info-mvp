import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type {
  NewListViewBlockDescriptor,
  NewListViewCompressedBlockDocument,
  NewListViewContentScope,
  NewListViewManifestDocument,
  NewListViewStatus,
  NewListViewVersionDocument,
  NewListViewWorkType,
  ProductCardItem,
  ProductListFilter,
} from "../types";
import { getAdminDb } from "./admin";

const NEW_LIST_VIEWS_COLLECTION = "newListViews";
const LISTS_SUBCOLLECTION = "newListViewLists";
const VERSIONS_SUBCOLLECTION = "newListViewVersions";
const BLOCKS_SUBCOLLECTION = "newListViewBlocks";
const SCHEMA_VERSION = 1;
const MAX_COMPRESSED_BYTES = 700 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

export type ListViewMode = "off" | "compare" | "prefer" | "require";

export type NewListViewPageResult = {
  products: ProductCardItem[];
  totalCount: number;
  segmentId: string;
  listId: string;
  versionId: string;
  usedPreviousVersion: boolean;
  blockIds: string[];
  firestoreReadEstimate: number;
};

type VersionMetadata = {
  status: NewListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: NewListViewBlockDescriptor[];
};

function buildSegmentId(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function contentScopeForFilter(filter: ProductListFilter): NewListViewContentScope {
  return filter.contentType ?? "all";
}

function workTypeForFilter(filter: ProductListFilter): NewListViewWorkType {
  return filter.workType ?? "all";
}

function buildListId(
  contentScope: NewListViewContentScope,
  workType: NewListViewWorkType,
): string {
  return `${contentScope}_${workType}`;
}

export function getListViewMode(): ListViewMode {
  const raw = process.env.LIST_VIEW_MODE?.trim().toLowerCase();
  if (raw === "compare" || raw === "prefer" || raw === "require") return raw;
  return "off";
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === "number" && value >= 0;
}

function isBlockDescriptor(value: unknown): value is NewListViewBlockDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<NewListViewBlockDescriptor>;
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
    value.blocks.length !== value.blockCount
  ) {
    throw new Error(`New-list view metadata is invalid: ${context}`);
  }

  const blocks = [...value.blocks].sort(
    (left, right) => left.blockIndex - right.blockIndex,
  );
  let expectedOffset = 0;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.blockIndex !== index || block.startOffset !== expectedOffset) {
      throw new Error(`New-list block ranges are invalid: ${context}`);
    }
    expectedOffset += block.itemCount;
  }
  if (expectedOffset !== value.itemCount) {
    throw new Error(`New-list item count is inconsistent: ${context}`);
  }
  if (value.status === "empty" && (value.itemCount !== 0 || blocks.length !== 0)) {
    throw new Error(`New-list empty metadata is inconsistent: ${context}`);
  }
  if (value.status === "ready" && value.itemCount > 0 && blocks.length === 0) {
    throw new Error(`New-list ready metadata has no blocks: ${context}`);
  }

  return {
    status: value.status,
    itemCount: value.itemCount,
    blockCount: value.blockCount,
    blocks,
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
    isString(item.title) &&
    isString(item.platform) &&
    isString(item.audience) &&
    isString(item.category)
  );
}

function decodeBlock(
  data: Partial<NewListViewCompressedBlockDocument>,
  descriptor: NewListViewBlockDescriptor,
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
      `New-list block metadata is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }
  if (
    payload.length !== descriptor.compressedBytes ||
    payload.length > MAX_COMPRESSED_BYTES ||
    sha256Hex(payload) !== descriptor.checksum
  ) {
    throw new Error(
      `New-list block checksum or size is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }

  const uncompressed = gunzipSync(payload);
  if (
    uncompressed.length !== descriptor.uncompressedBytes ||
    uncompressed.length > MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error(
      `New-list uncompressed block size is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
    );
  }

  const parsed: unknown = JSON.parse(uncompressed.toString("utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== descriptor.itemCount ||
    !parsed.every(isProductCardItem)
  ) {
    throw new Error(
      `New-list block payload is invalid: ${listId}/${versionId}/${descriptor.blockId}`,
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
): Promise<Omit<NewListViewPageResult, "segmentId" | "usedPreviousVersion">> {
  if (offset >= metadata.itemCount || limit <= 0) {
    return {
      products: [],
      totalCount: metadata.itemCount,
      listId,
      versionId,
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
    throw new Error(`No new-list blocks cover the requested page: ${listId}`);
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
        `New-list block is missing: ${listId}/${versionId}/${descriptor.blockId}`,
      );
    }
    const items = decodeBlock(
      snapshot.data() as Partial<NewListViewCompressedBlockDocument>,
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
      `New-list page item count mismatch: list=${listId}, expected=${expectedCount}, actual=${products.length}`,
    );
  }

  return {
    products,
    totalCount: metadata.itemCount,
    listId,
    versionId,
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
    throw new Error(`Previous new-list version is missing: ${listId}/${previousVersion}`);
  }
  const version = snapshot.data() as Partial<NewListViewVersionDocument>;
  if (
    version.schemaVersion !== SCHEMA_VERSION ||
    version.listId !== listId ||
    version.versionId !== previousVersion
  ) {
    throw new Error(`Previous new-list version is invalid: ${listId}/${previousVersion}`);
  }
  return validateVersionMetadata(version, `${listId}/${previousVersion}`);
}

export async function getNewListViewPage(
  filter: ProductListFilter,
): Promise<NewListViewPageResult | undefined> {
  const segmentId = buildSegmentId(filter);
  const contentScope = contentScopeForFilter(filter);
  const workType = workTypeForFilter(filter);
  const listId = buildListId(contentScope, workType);
  const offset = Math.max(0, filter.offsetCount ?? 0);
  const limit = Math.max(0, filter.limitCount ?? 24);
  const listRef = getAdminDb()
    .collection(NEW_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(LISTS_SUBCOLLECTION)
    .doc(listId);
  const manifestSnapshot = await listRef.get();
  if (!manifestSnapshot.exists) return undefined;

  const manifest = manifestSnapshot.data() as Partial<NewListViewManifestDocument>;
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.segmentId !== segmentId ||
    manifest.listId !== listId ||
    manifest.contentScope !== contentScope ||
    manifest.workType !== workType ||
    !isString(manifest.activeVersion)
  ) {
    console.warn("New-list manifest is invalid", { segmentId, listId });
    return undefined;
  }

  try {
    const metadata = validateVersionMetadata(manifest, `${listId}/${manifest.activeVersion}`);
    const page = await loadPageFromVersion(
      listRef,
      listId,
      manifest.activeVersion,
      metadata,
      offset,
      limit,
      1,
    );
    return {
      ...page,
      segmentId,
      usedPreviousVersion: false,
    };
  } catch (activeError) {
    console.error("Active new-list view failed validation", {
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
      offset,
      limit,
      2,
    );
    console.warn("Using previous new-list view version", {
      segmentId,
      listId,
      previousVersion: manifest.previousVersion,
    });
    return {
      ...page,
      segmentId,
      usedPreviousVersion: true,
    };
  } catch (previousError) {
    console.error("Previous new-list view also failed validation", {
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
