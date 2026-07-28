import { createHash, randomBytes } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  Product,
  SearchIndexChunkDocument,
  SearchIndexItem,
  SearchIndexRootDocument,
  SearchIndexVersionDocument,
} from "../types";

const SEARCH_INDEXES_COLLECTION = "searchIndexes";
const SEARCH_INDEX_SCHEMA_VERSION = 2;
const SEARCH_INDEX_TARGET_CHUNK_BYTES = 400 * 1024;
const SEARCH_INDEX_MAX_ITEMS_PER_CHUNK = 500;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type SearchIndexSourceProduct = Product & { contentType?: string };

export type RebuildSearchIndexResult = {
  segmentId: string;
  versionId: string;
  productCount: number;
  chunkCount: number;
  checksum: string;
};

function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;

  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.toDate === "function" && typeof timestampLike.seconds === "number") {
    return value;
  }

  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cleanedItem = removeUndefinedDeep(item);
    if (cleanedItem !== undefined) cleaned[key] = cleanedItem;
  }
  return cleaned as T;
}

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildVersionId(date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}_${randomBytes(4).toString("hex")}`;
}

function toSearchIndexItem(product: SearchIndexSourceProduct): SearchIndexItem | undefined {
  const productId = product.productId?.trim();
  if (!productId) return undefined;

  return removeUndefinedDeep({
    productId,
    sourceProductId: product.sourceProductId,
    title: product.title,
    seller: product.seller?.sellerName
      ? { sellerName: product.seller.sellerName }
      : undefined,
    workType: product.workType,
    workTypeLabel: product.workTypeLabel,
    contentType: product.contentType,
    contentTypes: product.contentTypes ?? [],
    contentTypeIds: product.contentTypeIds ?? [],
    genres: product.genres ?? [],
    tags: product.tags ?? [],
    genreIds: product.genreIds ?? [],
    tagIds: product.tagIds ?? [],
    salesCount: product.salesCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    releaseDate: product.releaseDate,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    discountAmount:
      typeof product.priceOriginal === "number" && typeof product.priceCurrent === "number"
        ? Math.max(0, product.priceOriginal - product.priceCurrent)
        : undefined,
    isDiscounted: Boolean(product.isDiscounted || product.isOnSale || (product.discountRate ?? 0) > 0),
    sellerKey: product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim() || undefined,
  });
}

function buildSearchIndexItems(products: Product[]): SearchIndexItem[] {
  return products
    .map((product) => toSearchIndexItem(product as SearchIndexSourceProduct))
    .filter((item): item is SearchIndexItem => Boolean(item))
    .sort((left, right) => left.productId.localeCompare(right.productId));
}

function getSerializedItemBytes(item: SearchIndexItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8") + 2;
}

function chunkSearchIndexItems(items: SearchIndexItem[]): SearchIndexItem[][] {
  const chunks: SearchIndexItem[][] = [];
  let current: SearchIndexItem[] = [];
  let currentBytes = 0;

  for (const item of items) {
    const itemBytes = getSerializedItemBytes(item);
    const exceedsBytes = current.length > 0 && currentBytes + itemBytes > SEARCH_INDEX_TARGET_CHUNK_BYTES;
    const exceedsCount = current.length >= SEARCH_INDEX_MAX_ITEMS_PER_CHUNK;

    if (exceedsBytes || exceedsCount) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }

    current.push(item);
    currentBytes += itemBytes;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

function calculateChecksum(items: SearchIndexItem[]): string {
  const hash = createHash("sha256");
  for (const item of items) {
    hash.update(JSON.stringify(item));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function deleteVersion(versionRef: DocumentReference): Promise<void> {
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) return;

  const version = versionSnapshot.data() as Partial<SearchIndexVersionDocument>;
  const chunkIds = Array.isArray(version.chunkIds)
    ? version.chunkIds.filter((value): value is string => typeof value === "string")
    : [];
  for (const chunkId of chunkIds) {
    await versionRef.collection("chunks").doc(chunkId).delete();
  }
  await versionRef.delete();
}

export async function rebuildSearchIndex(
  segment: SiteSegmentKey,
  products: Product[],
  generatedAt: Timestamp,
): Promise<RebuildSearchIndexResult> {
  const segmentId = buildSegmentId(segment);
  const generatedDate = generatedAt.toDate();
  const versionId = buildVersionId(generatedDate);
  const items = buildSearchIndexItems(products);
  const chunks = chunkSearchIndexItems(items);
  const chunkIds = chunks.map((_, index) => index.toString().padStart(4, "0"));
  const checksum = calculateChecksum(items);

  const rootRef = db.collection(SEARCH_INDEXES_COLLECTION).doc(segmentId);
  const versionsRef = rootRef.collection("versions");
  const versionRef = versionsRef.doc(versionId);
  const previousRootSnapshot = await rootRef.get();
  const previousRoot = previousRootSnapshot.exists
    ? previousRootSnapshot.data() as Partial<SearchIndexRootDocument>
    : undefined;
  const previousActiveVersion = typeof previousRoot?.activeVersion === "string"
    ? previousRoot.activeVersion
    : undefined;
  const versionToDelete = typeof previousRoot?.previousVersion === "string"
    ? previousRoot.previousVersion
    : undefined;
  if (
    items.length === 0 &&
    previousActiveVersion &&
    (previousRoot?.productCount ?? 0) > 0
  ) {
    throw new Error(
      `search index rebuild produced no items for ${segmentId}; keeping ${previousActiveVersion}`,
    );
  }
  let activated = false;

  try {
    const buildingVersion: SearchIndexVersionDocument = {
      versionId,
      segmentId,
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      platform: segment.platform,
      audience: segment.audience,
      category: segment.category,
      status: "building",
      productCount: items.length,
      chunkCount: chunks.length,
      chunkIds,
      checksum,
      generatedAt,
      updatedAt: generatedAt,
    };
    await versionRef.set(removeUndefinedDeep(buildingVersion), { merge: false });

    for (let index = 0; index < chunks.length; index += 1) {
      const chunkItems = chunks[index];
      const chunkId = chunkIds[index];
      const chunkDocument: SearchIndexChunkDocument = {
        versionId,
        chunkId,
        index,
        itemCount: chunkItems.length,
        items: chunkItems,
        generatedAt,
      };
      await versionRef
        .collection("chunks")
        .doc(chunkId)
        .set(removeUndefinedDeep(chunkDocument), { merge: false });
    }

    const readyVersion: SearchIndexVersionDocument = {
      ...buildingVersion,
      status: "ready",
      updatedAt: generatedAt,
    };
    await versionRef.set(removeUndefinedDeep(readyVersion), { merge: false });

    const rootDocument: SearchIndexRootDocument = {
      segmentId,
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      platform: segment.platform,
      audience: segment.audience,
      category: segment.category,
      activeVersion: versionId,
      previousVersion: previousActiveVersion,
      productCount: items.length,
      chunkCount: chunks.length,
      chunkIds,
      checksum,
      generatedAt,
      updatedAt: generatedAt,
    };
    await rootRef.set(removeUndefinedDeep(rootDocument), { merge: false });
    activated = true;

    if (
      versionToDelete &&
      versionToDelete !== versionId &&
      versionToDelete !== previousActiveVersion
    ) {
      try {
        await deleteVersion(versionsRef.doc(versionToDelete));
      } catch (error) {
        console.warn("Failed to delete old search index version", {
          segmentId,
          versionId: versionToDelete,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      segmentId,
      versionId,
      productCount: items.length,
      chunkCount: chunks.length,
      checksum,
    };
  } catch (error) {
    if (!activated) {
      try {
        await deleteVersion(versionRef);
      } catch (cleanupError) {
        console.warn("Failed to clean up incomplete search index version", {
          segmentId,
          versionId,
          error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
        });
      }
    }
    throw error;
  }
}
