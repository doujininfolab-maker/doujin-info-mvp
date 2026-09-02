import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type {
  CompactSearchIndexBlockDescriptor,
  CompactSearchIndexBlockDocument,
  CompactSearchIndexRootDocument,
  CompactSearchIndexRow,
  CompactSearchIndexVersionDocument,
  ProductListFilter,
} from "../types";
import { getAdminDb } from "./admin";

const COLLECTION = "compactSearchIndexes";
const VERSIONS_SUBCOLLECTION = "compactSearchIndexVersions";
const BLOCKS_SUBCOLLECTION = "compactSearchIndexBlocks";
const SCHEMA_VERSION = 1;
const MAX_COMPRESSED_BYTES = 700 * 1024;
const MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 2;
const FAILURE_CACHE_TTL_MS = 10_000;

type CacheEntry = {
  activeVersion: string;
  rows: CompactSearchIndexRow[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const loading = new Map<string, Promise<CompactSearchIndexRow[] | undefined>>();
const unavailableUntil = new Map<string, number>();

function segmentId(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function isCompactSearchIndexRow(
  value: unknown,
): value is CompactSearchIndexRow {
  if (!Array.isArray(value) || value.length !== 23) return false;
  return (
    isString(value[0]) &&
    value.slice(1, 7).every(isNullableString) &&
    value.slice(7, 13).every(isStringArray) &&
    value.slice(13, 16).every(isNullableNumber) &&
    isNullableString(value[16]) &&
    value.slice(17, 21).every(isNullableNumber) &&
    (value[21] === 0 || value[21] === 1) &&
    isNullableString(value[22])
  );
}

function isDescriptor(
  value: unknown,
): value is CompactSearchIndexBlockDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<CompactSearchIndexBlockDescriptor>;
  return (
    isString(descriptor.blockId) &&
    isNonNegativeInteger(descriptor.blockIndex) &&
    isNonNegativeInteger(descriptor.startOffset) &&
    isNonNegativeInteger(descriptor.itemCount) &&
    isNonNegativeInteger(descriptor.compressedBytes) &&
    isNonNegativeInteger(descriptor.uncompressedBytes) &&
    isString(descriptor.checksum)
  );
}

function validateDescriptors(
  value: unknown,
  expectedCount: number,
  expectedBlockCount: number,
  context: string,
): CompactSearchIndexBlockDescriptor[] {
  if (!Array.isArray(value) || !value.every(isDescriptor)) {
    throw new Error(`Compact search descriptors are invalid: ${context}`);
  }
  const descriptors = [...value].sort(
    (left, right) => left.blockIndex - right.blockIndex,
  );
  if (descriptors.length !== expectedBlockCount) {
    throw new Error(`Compact search block count is invalid: ${context}`);
  }
  let offset = 0;
  for (let index = 0; index < descriptors.length; index += 1) {
    const descriptor = descriptors[index];
    if (descriptor.blockIndex !== index || descriptor.startOffset !== offset) {
      throw new Error(`Compact search block ranges are invalid: ${context}`);
    }
    offset += descriptor.itemCount;
  }
  if (offset !== expectedCount) {
    throw new Error(`Compact search item count is invalid: ${context}`);
  }
  return descriptors;
}

function toBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object") {
    const bytes = value as { toUint8Array?: () => Uint8Array };
    if (typeof bytes.toUint8Array === "function") {
      return Buffer.from(bytes.toUint8Array());
    }
  }
  return undefined;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rowsChecksum(rows: CompactSearchIndexRow[]): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(JSON.stringify(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function decodeBlock(
  data: Partial<CompactSearchIndexBlockDocument>,
  descriptor: CompactSearchIndexBlockDescriptor,
  requestedSegmentId: string,
  versionId: string,
): CompactSearchIndexRow[] {
  const payload = toBuffer(data.payload);
  if (
    data.schemaVersion !== SCHEMA_VERSION ||
    data.encoding !== "gzip-json-v1" ||
    data.segmentId !== requestedSegmentId ||
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
      `Compact search block metadata is invalid: ${requestedSegmentId}/${versionId}/${descriptor.blockId}`,
    );
  }
  if (
    payload.length !== descriptor.compressedBytes ||
    payload.length > MAX_COMPRESSED_BYTES ||
    sha256(payload) !== descriptor.checksum
  ) {
    throw new Error(
      `Compact search block checksum is invalid: ${requestedSegmentId}/${versionId}/${descriptor.blockId}`,
    );
  }
  const uncompressed = gunzipSync(payload);
  if (
    uncompressed.length !== descriptor.uncompressedBytes ||
    uncompressed.length > MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error(
      `Compact search block size is invalid: ${requestedSegmentId}/${versionId}/${descriptor.blockId}`,
    );
  }
  const parsed: unknown = JSON.parse(uncompressed.toString("utf8"));
  if (
    !Array.isArray(parsed) ||
    parsed.length !== descriptor.itemCount ||
    !parsed.every(isCompactSearchIndexRow)
  ) {
    throw new Error(
      `Compact search block payload is invalid: ${requestedSegmentId}/${versionId}/${descriptor.blockId}`,
    );
  }
  return parsed;
}

async function loadVersion(
  rootRef: FirebaseFirestore.DocumentReference,
  requestedSegmentId: string,
  versionId: string,
): Promise<CompactSearchIndexRow[]> {
  const versionRef = rootRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const snapshot = await versionRef.get();
  if (!snapshot.exists) {
    throw new Error(`Compact search version is missing: ${requestedSegmentId}/${versionId}`);
  }
  const version = snapshot.data() as Partial<CompactSearchIndexVersionDocument>;
  if (
    version.schemaVersion !== SCHEMA_VERSION ||
    version.segmentId !== requestedSegmentId ||
    version.versionId !== versionId ||
    version.status !== "ready" ||
    !isNonNegativeInteger(version.productCount) ||
    !isNonNegativeInteger(version.blockCount) ||
    !isString(version.indexChecksum)
  ) {
    throw new Error(`Compact search version is invalid: ${requestedSegmentId}/${versionId}`);
  }
  const descriptors = validateDescriptors(
    version.blocks,
    version.productCount,
    version.blockCount,
    `${requestedSegmentId}/${versionId}`,
  );
  const refs = descriptors.map((descriptor) =>
    versionRef.collection(BLOCKS_SUBCOLLECTION).doc(descriptor.blockId),
  );
  const snapshots = refs.length ? await getAdminDb().getAll(...refs) : [];
  const rows: CompactSearchIndexRow[] = [];
  for (let index = 0; index < descriptors.length; index += 1) {
    const blockSnapshot = snapshots[index];
    if (!blockSnapshot.exists) {
      throw new Error(
        `Compact search block is missing: ${requestedSegmentId}/${versionId}/${descriptors[index].blockId}`,
      );
    }
    rows.push(
      ...decodeBlock(
        blockSnapshot.data() as Partial<CompactSearchIndexBlockDocument>,
        descriptors[index],
        requestedSegmentId,
        versionId,
      ),
    );
  }
  if (rows.length !== version.productCount || rowsChecksum(rows) !== version.indexChecksum) {
    throw new Error(`Compact search index checksum mismatch: ${requestedSegmentId}/${versionId}`);
  }
  return rows;
}

function setCache(key: string, entry: CacheEntry): void {
  cache.delete(key);
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
  cache.set(key, entry);
}

async function load(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): Promise<CompactSearchIndexRow[] | undefined> {
  const id = segmentId(filter);
  const rootRef = getAdminDb().collection(COLLECTION).doc(id);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) return undefined;
  const root = rootSnapshot.data() as Partial<CompactSearchIndexRootDocument>;
  if (
    root.schemaVersion !== SCHEMA_VERSION ||
    root.segmentId !== id ||
    !isString(root.activeVersion)
  ) {
    console.warn("Compact search root is invalid", { segmentId: id });
    return undefined;
  }

  if (cache.get(id)?.activeVersion === root.activeVersion) {
    const current = cache.get(id)!;
    current.expiresAt = Date.now() + CACHE_TTL_MS;
    setCache(id, current);
    return current.rows;
  }

  // Never retain two complete search versions during the daily swap.
  cache.delete(id);
  try {
    const rows = await loadVersion(rootRef, id, root.activeVersion);
    setCache(id, {
      activeVersion: root.activeVersion,
      rows,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return rows;
  } catch (activeError) {
    console.error("Active compact search index is unavailable", {
      segmentId: id,
      activeVersion: root.activeVersion,
      error: activeError instanceof Error ? activeError.message : String(activeError),
    });
  }

  if (!isString(root.previousVersion)) return undefined;
  try {
    const rows = await loadVersion(rootRef, id, root.previousVersion);
    setCache(id, {
      activeVersion: root.previousVersion,
      rows,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    console.warn("Using previous compact search index version", {
      segmentId: id,
      previousVersion: root.previousVersion,
    });
    return rows;
  } catch (previousError) {
    console.error("Previous compact search index is unavailable", {
      segmentId: id,
      previousVersion: root.previousVersion,
      error:
        previousError instanceof Error
          ? previousError.message
          : String(previousError),
    });
    return undefined;
  }
}

export async function getCompactSearchIndexRows(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): Promise<CompactSearchIndexRow[] | undefined> {
  const id = segmentId(filter);
  const retryAt = unavailableUntil.get(id);
  if (retryAt && retryAt > Date.now()) return undefined;
  unavailableUntil.delete(id);
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const current = loading.get(id);
  if (current) return current;
  const promise = load(filter)
    .then((rows) => {
      if (rows) {
        unavailableUntil.delete(id);
      } else {
        unavailableUntil.set(id, Date.now() + FAILURE_CACHE_TTL_MS);
      }
      return rows;
    })
    .catch((error) => {
      console.error("Failed to load compact search index", {
        segmentId: id,
        error: error instanceof Error ? error.message : String(error),
      });
      unavailableUntil.set(id, Date.now() + FAILURE_CACHE_TTL_MS);
      return undefined;
    })
    .finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}
