import { createHash, randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  CompactSearchIndexBlockDescriptor,
  CompactSearchIndexBlockDocument,
  CompactSearchIndexRootDocument,
  CompactSearchIndexRow,
  CompactSearchIndexVersionDocument,
  FetchTarget,
  Product,
  SearchIndexItem,
} from "../types";

export const COMPACT_SEARCH_INDEXES_COLLECTION = "compactSearchIndexes";
export const COMPACT_SEARCH_INDEX_SCHEMA_VERSION = 1;
export const COMPACT_SEARCH_INDEX_ENCODING = "gzip-json-v1" as const;
export const COMPACT_SEARCH_INDEX_SOFT_COMPRESSED_BYTES = 512 * 1024;
export const COMPACT_SEARCH_INDEX_MAX_COMPRESSED_BYTES = 700 * 1024;
export const COMPACT_SEARCH_INDEX_MAX_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
export const COMPACT_SEARCH_INDEX_MAX_ITEMS_PER_BLOCK = 5_000;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type SearchIndexSourceProduct = Product & { contentType?: string };

export type BuiltCompactSearchIndexBlock = {
  descriptor: CompactSearchIndexBlockDescriptor;
  document: CompactSearchIndexBlockDocument;
};

export type RebuildCompactSearchIndexResult = {
  segmentId: string;
  versionId: string;
  productCount: number;
  blockCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  indexChecksum: string;
};

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function toCompactSearchIndexRow(
  product: SearchIndexSourceProduct,
): CompactSearchIndexRow | undefined {
  const productId = product.productId?.trim();
  if (!productId) return undefined;
  const priceCurrent = numberOrNull(product.priceCurrent);
  const priceOriginal = numberOrNull(product.priceOriginal);

  return [
    productId,
    stringOrNull(product.sourceProductId),
    stringOrNull(product.title),
    stringOrNull(product.seller?.sellerName),
    stringOrNull(product.workType),
    stringOrNull(product.workTypeLabel),
    stringOrNull(product.contentType),
    stringArray(product.contentTypes),
    stringArray(product.contentTypeIds),
    stringArray(product.genres),
    stringArray(product.tags),
    stringArray(product.genreIds),
    stringArray(product.tagIds),
    numberOrNull(product.salesCount),
    numberOrNull(product.rating),
    numberOrNull(product.ratingAverage),
    stringOrNull(product.releaseDate),
    priceCurrent,
    priceOriginal,
    numberOrNull(product.discountRate),
    priceOriginal !== null && priceCurrent !== null
      ? Math.max(0, priceOriginal - priceCurrent)
      : null,
    product.isDiscounted || product.isOnSale || (product.discountRate ?? 0) > 0
      ? 1
      : 0,
    stringOrNull(
      product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim(),
    ),
  ];
}

export function compactSearchIndexRowToItem(
  row: CompactSearchIndexRow,
): SearchIndexItem {
  const item: SearchIndexItem = { productId: row[0] };
  if (row[1] !== null) item.sourceProductId = row[1];
  if (row[2] !== null) item.title = row[2];
  if (row[3] !== null) item.seller = { sellerName: row[3] };
  if (row[4] !== null) item.workType = row[4];
  if (row[5] !== null) item.workTypeLabel = row[5];
  if (row[6] !== null) item.contentType = row[6];
  item.contentTypes = row[7];
  item.contentTypeIds = row[8];
  item.genres = row[9];
  item.tags = row[10];
  item.genreIds = row[11];
  item.tagIds = row[12];
  if (row[13] !== null) item.salesCount = row[13];
  if (row[14] !== null) item.rating = row[14];
  if (row[15] !== null) item.ratingAverage = row[15];
  if (row[16] !== null) item.releaseDate = row[16];
  if (row[17] !== null) item.priceCurrent = row[17];
  if (row[18] !== null) item.priceOriginal = row[18];
  if (row[19] !== null) item.discountRate = row[19];
  if (row[20] !== null) item.discountAmount = row[20];
  item.isDiscounted = row[21] === 1;
  if (row[22] !== null) item.sellerKey = row[22];
  return item;
}

export function buildCompactSearchIndexRows(
  products: Product[],
): CompactSearchIndexRow[] {
  return products
    .map((product) =>
      toCompactSearchIndexRow(product as SearchIndexSourceProduct),
    )
    .filter((row): row is CompactSearchIndexRow => Boolean(row))
    .sort((left, right) => left[0].localeCompare(right[0]));
}

function checksum(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function calculateCompactSearchIndexChecksum(
  rows: CompactSearchIndexRow[],
): string {
  const hash = createHash("sha256");
  for (const row of rows) {
    hash.update(JSON.stringify(row));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function serializeRows(rows: CompactSearchIndexRow[]): {
  json: Buffer;
  compressed: Buffer;
} {
  const json = Buffer.from(JSON.stringify(rows), "utf8");
  if (json.length > COMPACT_SEARCH_INDEX_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Compact search block exceeds uncompressed limit: ${json.length}`,
    );
  }
  return { json, compressed: gzipSync(json, { level: 6 }) };
}

function splitRowsBySize(rows: CompactSearchIndexRow[]): CompactSearchIndexRow[][] {
  const { json, compressed } = serializeRows(rows);
  if (
    (compressed.length <= COMPACT_SEARCH_INDEX_SOFT_COMPRESSED_BYTES &&
      json.length <= COMPACT_SEARCH_INDEX_MAX_UNCOMPRESSED_BYTES) ||
    rows.length <= 1
  ) {
    if (compressed.length > COMPACT_SEARCH_INDEX_MAX_COMPRESSED_BYTES) {
      throw new Error(
        `A compact search row exceeds compressed limit: ${compressed.length}`,
      );
    }
    return [rows];
  }
  const midpoint = Math.ceil(rows.length / 2);
  return [
    ...splitRowsBySize(rows.slice(0, midpoint)),
    ...splitRowsBySize(rows.slice(midpoint)),
  ];
}

export function buildCompactSearchIndexBlocks(
  segmentId: string,
  versionId: string,
  rows: CompactSearchIndexRow[],
  generatedAt: Timestamp,
): BuiltCompactSearchIndexBlock[] {
  const chunks: CompactSearchIndexRow[][] = [];
  for (
    let offset = 0;
    offset < rows.length;
    offset += COMPACT_SEARCH_INDEX_MAX_ITEMS_PER_BLOCK
  ) {
    chunks.push(
      ...splitRowsBySize(
        rows.slice(offset, offset + COMPACT_SEARCH_INDEX_MAX_ITEMS_PER_BLOCK),
      ),
    );
  }

  let startOffset = 0;
  return chunks.map((chunk, blockIndex) => {
    const blockId = String(blockIndex).padStart(6, "0");
    const { json, compressed } = serializeRows(chunk);
    if (compressed.length > COMPACT_SEARCH_INDEX_MAX_COMPRESSED_BYTES) {
      throw new Error(
        `Compact search block exceeds compressed limit: ${compressed.length}`,
      );
    }
    const descriptor: CompactSearchIndexBlockDescriptor = {
      blockId,
      blockIndex,
      startOffset,
      itemCount: chunk.length,
      compressedBytes: compressed.length,
      uncompressedBytes: json.length,
      checksum: checksum(compressed),
    };
    startOffset += chunk.length;
    return {
      descriptor,
      document: {
        schemaVersion: COMPACT_SEARCH_INDEX_SCHEMA_VERSION,
        encoding: COMPACT_SEARCH_INDEX_ENCODING,
        segmentId,
        versionId,
        blockId,
        blockIndex,
        startOffset: descriptor.startOffset,
        itemCount: descriptor.itemCount,
        compressedBytes: descriptor.compressedBytes,
        uncompressedBytes: descriptor.uncompressedBytes,
        checksum: descriptor.checksum,
        payload: compressed,
        generatedAt,
      },
    };
  });
}

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildVersionId(date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}_${randomBytes(4).toString("hex")}`;
}

async function deleteVersion(versionRef: DocumentReference): Promise<void> {
  const snapshot = await versionRef.get();
  if (!snapshot.exists) return;
  const version = snapshot.data() as Partial<CompactSearchIndexVersionDocument>;
  const blockIds = Array.isArray(version.blocks)
    ? version.blocks
        .map((block) => block.blockId)
        .filter((blockId): blockId is string => typeof blockId === "string")
    : [];
  const refs = [
    ...blockIds.map((blockId) =>
      versionRef.collection("compactSearchIndexBlocks").doc(blockId),
    ),
    versionRef,
  ];
  for (let index = 0; index < refs.length; index += 400) {
    const batch = db.batch();
    for (const ref of refs.slice(index, index + 400)) batch.delete(ref);
    await batch.commit();
  }
}

export async function rebuildCompactSearchIndex(
  segment: SiteSegmentKey,
  products: Product[],
  generatedAt: Timestamp,
): Promise<RebuildCompactSearchIndexResult> {
  const segmentId = buildSegmentId(segment);
  const versionId = buildVersionId(generatedAt.toDate());
  const rows = buildCompactSearchIndexRows(products);
  const blocks = buildCompactSearchIndexBlocks(
    segmentId,
    versionId,
    rows,
    generatedAt,
  );
  const indexChecksum = calculateCompactSearchIndexChecksum(rows);
  const rootRef = db.collection(COMPACT_SEARCH_INDEXES_COLLECTION).doc(segmentId);
  const versionsRef = rootRef.collection("compactSearchIndexVersions");
  const versionRef = versionsRef.doc(versionId);
  const previousSnapshot = await rootRef.get();
  const previous = previousSnapshot.exists
    ? (previousSnapshot.data() as Partial<CompactSearchIndexRootDocument>)
    : undefined;
  const previousActiveVersion =
    typeof previous?.activeVersion === "string"
      ? previous.activeVersion
      : undefined;
  const staleVersion =
    typeof previous?.previousVersion === "string"
      ? previous.previousVersion
      : undefined;
  if (rows.length === 0 && previousActiveVersion && (previous?.productCount ?? 0) > 0) {
    throw new Error(
      `compact search index produced no rows for ${segmentId}; keeping ${previousActiveVersion}`,
    );
  }

  const baseVersion: CompactSearchIndexVersionDocument = {
    schemaVersion: COMPACT_SEARCH_INDEX_SCHEMA_VERSION,
    segmentId,
    versionId,
    status: "building",
    productCount: rows.length,
    blockCount: blocks.length,
    blocks: blocks.map((block) => block.descriptor),
    indexChecksum,
    generatedAt,
    updatedAt: generatedAt,
  };
  let activated = false;

  try {
    await versionRef.set(baseVersion, { merge: false });
    for (let index = 0; index < blocks.length; index += 400) {
      const batch = db.batch();
      for (const block of blocks.slice(index, index + 400)) {
        batch.set(
          versionRef
            .collection("compactSearchIndexBlocks")
            .doc(block.descriptor.blockId),
          block.document,
          { merge: false },
        );
      }
      await batch.commit();
    }
    await versionRef.set({ ...baseVersion, status: "ready" }, { merge: false });

    const root: CompactSearchIndexRootDocument = {
      schemaVersion: COMPACT_SEARCH_INDEX_SCHEMA_VERSION,
      segmentId,
      activeVersion: versionId,
      previousVersion: previousActiveVersion,
      productCount: rows.length,
      blockCount: blocks.length,
      blocks: blocks.map((block) => block.descriptor),
      indexChecksum,
      generatedAt,
      updatedAt: generatedAt,
    };
    await rootRef.set(root, { merge: false });
    activated = true;

    if (
      staleVersion &&
      staleVersion !== previousActiveVersion &&
      staleVersion !== versionId
    ) {
      await deleteVersion(versionsRef.doc(staleVersion)).catch((error) => {
        console.warn("Failed to delete stale compact search index", {
          segmentId,
          staleVersion,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return {
      segmentId,
      versionId,
      productCount: rows.length,
      blockCount: blocks.length,
      compressedBytes: blocks.reduce(
        (sum, block) => sum + block.descriptor.compressedBytes,
        0,
      ),
      uncompressedBytes: blocks.reduce(
        (sum, block) => sum + block.descriptor.uncompressedBytes,
        0,
      ),
      indexChecksum,
    };
  } catch (error) {
    if (!activated) await deleteVersion(versionRef).catch(() => undefined);
    throw error;
  }
}
