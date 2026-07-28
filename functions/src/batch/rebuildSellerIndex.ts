import { randomBytes } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  Product,
  ProductContentType,
  SellerIndexChunkDocument,
  SellerIndexItem,
  SellerIndexRootDocument,
  SellerIndexVersionDocument,
} from "../types";

const SELLER_INDEXES_COLLECTION = "sellerIndexes";
const SELLER_INDEX_SCHEMA_VERSION = 1;
const TARGET_CHUNK_BYTES = 400 * 1024;
const MAX_ITEMS_PER_CHUNK = 250;
const CONTENT_SCOPES = ["all", "tl", "bl"] as const;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type ContentScope = (typeof CONTENT_SCOPES)[number];

type SellerItemRange = {
  start: number;
  end: number;
};

export type RebuildSellerIndexResult = {
  indexId: string;
  versionId: string;
  itemCount: number;
  chunkCount: number;
};

function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;
  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.toDate === "function" && typeof timestampLike.seconds === "number") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return value.map(removeUndefinedDeep).filter((item) => item !== undefined) as T;
  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const next = removeUndefinedDeep(item);
    if (next !== undefined) cleaned[key] = next;
  }
  return cleaned as T;
}

function buildIndexId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildVersionId(date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}_${randomBytes(4).toString("hex")}`;
}

function normalizeContentType(value: string | undefined): ProductContentType | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw ?? "")) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw ?? "")) return "bl";
  return undefined;
}

function hasScope(product: Product, scope: ContentScope): boolean {
  if (scope === "all") return true;
  return [...(product.contentTypeIds ?? []), ...(product.contentTypes ?? [])]
    .map(normalizeContentType)
    .includes(scope);
}

function sellerKey(product: Product): string | undefined {
  return product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim() || undefined;
}

function normalizeSellerName(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function compactProduct(product?: Product): Product | undefined {
  if (!product) return undefined;
  return removeUndefinedDeep({
    productId: product.productId,
    sourceProductId: product.sourceProductId,
    platform: product.platform,
    audience: product.audience,
    category: product.category,
    affiliateProvider: product.affiliateProvider,
    title: product.title,
    seller: product.seller,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    isDiscounted: product.isDiscounted,
    isOnSale: product.isOnSale,
    currency: product.currency,
    salesCount: product.salesCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    reviewCount: product.reviewCount,
    releaseDate: product.releaseDate,
    ageRating: product.ageRating,
    isAdult: product.isAdult,
    workType: product.workType,
    workTypeLabel: product.workTypeLabel,
    contentTypes: product.contentTypes,
    contentTypeIds: product.contentTypeIds,
    thumbnailUrl: product.thumbnailUrl,
    mainImageUrl: product.mainImageUrl,
    images: product.images?.slice(0, 1) ?? [],
    sourceUrl: product.sourceUrl,
    affiliateUrl: product.affiliateUrl,
    genres: product.genres ?? [],
    tags: [],
    genreIds: product.genreIds ?? [],
    tagIds: [],
    isActive: product.isActive,
    fetchStatus: product.fetchStatus,
  } as Product);
}

function buildSellerItem(
  contentScope: ContentScope,
  key: string,
  sellerProducts: Product[],
): SellerIndexItem {
  let topProduct = sellerProducts[0];
  let totalSalesCount = 0;
  let estimatedRevenue = 0;
  const tagCounts = new Map<string, number>();

  for (const product of sellerProducts) {
    const salesCount = product.salesCount ?? 0;
    totalSalesCount += salesCount;
    estimatedRevenue += salesCount * (product.priceCurrent ?? 0);
    if (
      !topProduct
      || salesCount > (topProduct.salesCount ?? 0)
      || (
        salesCount === (topProduct.salesCount ?? 0)
        && product.productId.localeCompare(topProduct.productId) < 0
      )
    ) {
      topProduct = product;
    }
    for (const genre of product.genres ?? []) {
      if (genre) tagCounts.set(genre, (tagCounts.get(genre) ?? 0) + 1);
    }
  }

  sellerProducts.sort(
    (a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "")
      || (a.title ?? "").localeCompare(b.title ?? "", "ja")
      || a.productId.localeCompare(b.productId),
  );
  const latestProduct = sellerProducts[0] ?? topProduct;
  let firstReleaseDate: string | undefined;
  for (let index = sellerProducts.length - 1; index >= 0; index -= 1) {
    if (sellerProducts[index].releaseDate) {
      firstReleaseDate = sellerProducts[index].releaseDate;
      break;
    }
  }
  const sellerName = topProduct?.seller?.sellerName ?? key;

  return removeUndefinedDeep({
    contentScope,
    sellerKey: key,
    sellerId: topProduct?.seller?.sellerId,
    sellerName,
    sellerUrl: topProduct?.seller?.sellerUrl,
    sellerType: topProduct?.seller?.sellerType,
    platform: topProduct?.platform ?? "dlsite",
    audience: topProduct?.audience ?? "female",
    category: topProduct?.category ?? "doujin",
    productCount: sellerProducts.length,
    totalSalesCount,
    averageSalesCount: sellerProducts.length
      ? Math.round(totalSalesCount / sellerProducts.length)
      : 0,
    estimatedRevenue,
    averagePrice: totalSalesCount > 0
      ? Math.round(estimatedRevenue / totalSalesCount)
      : undefined,
    firstReleaseDate,
    latestReleaseDate: latestProduct?.releaseDate,
    newestProductTitle: latestProduct?.title,
    topProduct: compactProduct(topProduct),
    latestProduct: compactProduct(latestProduct),
    tags: [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
      .slice(0, 18)
      .map(([name, count]) => ({ name, count })),
    normalizedSellerName: normalizeSellerName(sellerName),
    productIdsByReleaseDate: sellerProducts.map((product) => product.productId),
  } as SellerIndexItem);
}

function buildItemsForScope(
  products: Product[],
  contentScope: ContentScope,
): SellerIndexItem[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    if (product.isActive === false || !hasScope(product, contentScope)) continue;
    const key = sellerKey(product);
    if (!key) continue;
    const current = groups.get(key) ?? [];
    current.push(product);
    groups.set(key, current);
  }

  const items: SellerIndexItem[] = [];
  for (const [key, sellerProducts] of groups) {
    items.push(buildSellerItem(contentScope, key, sellerProducts));
    sellerProducts.length = 0;
  }
  return items;
}

function toMiB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function logScopeMemory(
  contentScope: ContentScope,
  scopeItemCount: number,
  totalItemCount: number,
): void {
  const memory = process.memoryUsage();
  console.log("seller index scope aggregated", {
    contentScope,
    scopeItemCount,
    totalItemCount,
    heapUsedMiB: toMiB(memory.heapUsed),
    heapTotalMiB: toMiB(memory.heapTotal),
    rssMiB: toMiB(memory.rss),
    externalMiB: toMiB(memory.external),
  });
}

function buildItems(products: Product[]): SellerIndexItem[] {
  const items: SellerIndexItem[] = [];
  for (const contentScope of CONTENT_SCOPES) {
    const scopeItems = buildItemsForScope(products, contentScope);
    items.push(...scopeItems);
    logScopeMemory(contentScope, scopeItems.length, items.length);
  }
  return items.sort(
    (a, b) => a.contentScope.localeCompare(b.contentScope)
      || a.sellerKey.localeCompare(b.sellerKey),
  );
}

function itemBytes(item: SellerIndexItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8") + 2;
}

function buildItemRanges(items: SellerIndexItem[]): SellerItemRange[] {
  const ranges: SellerItemRange[] = [];
  let start = 0;
  let count = 0;
  let bytes = 0;

  for (let index = 0; index < items.length; index += 1) {
    const nextBytes = itemBytes(items[index]);
    if (
      count > 0
      && (bytes + nextBytes > TARGET_CHUNK_BYTES || count >= MAX_ITEMS_PER_CHUNK)
    ) {
      ranges.push({ start, end: index });
      start = index;
      count = 0;
      bytes = 0;
    }
    count += 1;
    bytes += nextBytes;
  }

  if (count > 0) ranges.push({ start, end: items.length });
  return ranges;
}

async function deleteVersion(versionRef: DocumentReference): Promise<void> {
  const snapshot = await versionRef.get();
  if (!snapshot.exists) return;
  const version = snapshot.data() as Partial<SellerIndexVersionDocument>;
  const chunkIds = Array.isArray(version.chunkIds)
    ? version.chunkIds.filter((value): value is string => typeof value === "string")
    : [];

  for (const chunkId of chunkIds) {
    await versionRef.collection("chunks").doc(chunkId).delete();
  }
  await versionRef.delete();
}

export async function rebuildSellerIndex(
  segment: SiteSegmentKey,
  products: Product[],
  generatedAt: Timestamp,
): Promise<RebuildSellerIndexResult> {
  const indexId = buildIndexId(segment);
  const versionId = buildVersionId(generatedAt.toDate());
  const items = buildItems(products);
  const ranges = buildItemRanges(items);
  const chunkIds = ranges.map((_, index) => index.toString().padStart(4, "0"));
  const rootRef = db.collection(SELLER_INDEXES_COLLECTION).doc(indexId);
  const versionsRef = rootRef.collection("versions");
  const versionRef = versionsRef.doc(versionId);
  const previousSnapshot = await rootRef.get();
  const previous = previousSnapshot.exists
    ? previousSnapshot.data() as Partial<SellerIndexRootDocument>
    : undefined;
  const previousActiveVersion = typeof previous?.activeVersion === "string"
    ? previous.activeVersion
    : undefined;
  const versionToDelete = typeof previous?.previousVersion === "string"
    ? previous.previousVersion
    : undefined;
  if (items.length === 0 && previousActiveVersion && (previous?.itemCount ?? 0) > 0) {
    throw new Error(
      `seller index rebuild produced no items for ${indexId}; keeping ${previousActiveVersion}`,
    );
  }
  let activated = false;

  try {
    const building: SellerIndexVersionDocument = {
      indexId,
      versionId,
      schemaVersion: SELLER_INDEX_SCHEMA_VERSION,
      status: "building",
      itemCount: items.length,
      chunkIds,
      generatedAt,
      updatedAt: generatedAt,
    };
    await versionRef.set(removeUndefinedDeep(building), { merge: false });

    for (let index = 0; index < ranges.length; index += 1) {
      const range = ranges[index];
      const chunkId = chunkIds[index];
      const chunkItems = items.slice(range.start, range.end);
      const chunkDocument: SellerIndexChunkDocument = {
        indexId,
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

    await versionRef.set(
      removeUndefinedDeep({ ...building, status: "ready", updatedAt: generatedAt }),
      { merge: false },
    );
    const root: SellerIndexRootDocument = {
      indexId,
      schemaVersion: SELLER_INDEX_SCHEMA_VERSION,
      activeVersion: versionId,
      previousVersion: previousActiveVersion,
      itemCount: items.length,
      chunkIds,
      generatedAt,
      updatedAt: generatedAt,
    };
    await rootRef.set(removeUndefinedDeep(root), { merge: false });
    activated = true;

    if (versionToDelete && versionToDelete !== previousActiveVersion && versionToDelete !== versionId) {
      try {
        await deleteVersion(versionsRef.doc(versionToDelete));
      } catch (error) {
        console.warn("Failed to delete old seller index version", {
          indexId,
          versionToDelete,
          error,
        });
      }
    }

    return {
      indexId,
      versionId,
      itemCount: items.length,
      chunkCount: ranges.length,
    };
  } catch (error) {
    if (!activated) {
      try {
        await deleteVersion(versionRef);
      } catch (cleanupError) {
        console.warn("Failed to clean up incomplete seller index", {
          indexId,
          versionId,
          cleanupError,
        });
      }
    }
    throw error;
  }
}
