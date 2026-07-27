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
const WRITE_BATCH_SIZE = 400;
const CONTENT_SCOPES = ["all", "tl", "bl"] as const;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type ContentScope = (typeof CONTENT_SCOPES)[number];

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

function buildItems(products: Product[]): SellerIndexItem[] {
  const items: SellerIndexItem[] = [];
  for (const contentScope of CONTENT_SCOPES) {
    const groups = new Map<string, Product[]>();
    for (const product of products) {
      if (product.isActive === false || !hasScope(product, contentScope)) continue;
      const key = sellerKey(product);
      if (!key) continue;
      const current = groups.get(key) ?? [];
      current.push(product);
      groups.set(key, current);
    }
    for (const [key, sellerProducts] of groups) {
      const bySales = [...sellerProducts].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0) || a.productId.localeCompare(b.productId));
      const byRelease = [...sellerProducts].sort((a, b) => (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "") || (a.title ?? "").localeCompare(b.title ?? "", "ja") || a.productId.localeCompare(b.productId));
      const topProduct = bySales[0];
      const latestProduct = byRelease[0] ?? topProduct;
      const totalSalesCount = sellerProducts.reduce((sum, product) => sum + (product.salesCount ?? 0), 0);
      const estimatedRevenue = sellerProducts.reduce((sum, product) => sum + (product.salesCount ?? 0) * (product.priceCurrent ?? 0), 0);
      const tagCounts = new Map<string, number>();
      for (const product of sellerProducts) {
        for (const genre of product.genres ?? []) {
          if (genre) tagCounts.set(genre, (tagCounts.get(genre) ?? 0) + 1);
        }
      }
      const sellerName = topProduct?.seller?.sellerName ?? key;
      items.push(removeUndefinedDeep({
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
        averageSalesCount: sellerProducts.length ? Math.round(totalSalesCount / sellerProducts.length) : 0,
        estimatedRevenue,
        averagePrice: totalSalesCount > 0 ? Math.round(estimatedRevenue / totalSalesCount) : undefined,
        firstReleaseDate: [...byRelease].reverse().find((product) => product.releaseDate)?.releaseDate,
        latestReleaseDate: latestProduct?.releaseDate,
        newestProductTitle: latestProduct?.title,
        topProduct: compactProduct(topProduct),
        latestProduct: compactProduct(latestProduct),
        tags: [...tagCounts.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
          .slice(0, 18)
          .map(([name, count]) => ({ name, count })),
        normalizedSellerName: normalizeSellerName(sellerName),
        productIdsByReleaseDate: byRelease.map((product) => product.productId),
      } as SellerIndexItem));
    }
  }
  return items.sort((a, b) => a.contentScope.localeCompare(b.contentScope) || a.sellerKey.localeCompare(b.sellerKey));
}

function itemBytes(item: SellerIndexItem): number {
  return Buffer.byteLength(JSON.stringify(item), "utf8") + 2;
}

function chunkItems(items: SellerIndexItem[]): SellerIndexItem[][] {
  const chunks: SellerIndexItem[][] = [];
  let current: SellerIndexItem[] = [];
  let bytes = 0;
  for (const item of items) {
    const nextBytes = itemBytes(item);
    if (current.length > 0 && (bytes + nextBytes > TARGET_CHUNK_BYTES || current.length >= MAX_ITEMS_PER_CHUNK)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += nextBytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function commitSets(operations: Array<{ ref: DocumentReference; data: Record<string, unknown> }>): Promise<void> {
  for (let index = 0; index < operations.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + WRITE_BATCH_SIZE)) batch.set(operation.ref, operation.data, { merge: false });
    await batch.commit();
  }
}

async function deleteVersion(versionRef: DocumentReference): Promise<void> {
  const snapshot = await versionRef.get();
  if (!snapshot.exists) return;
  const version = snapshot.data() as Partial<SellerIndexVersionDocument>;
  const chunkIds = Array.isArray(version.chunkIds) ? version.chunkIds : [];
  const refs = [...chunkIds.map((id) => versionRef.collection("chunks").doc(id)), versionRef];
  for (let index = 0; index < refs.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    for (const ref of refs.slice(index, index + WRITE_BATCH_SIZE)) batch.delete(ref);
    await batch.commit();
  }
}

export async function rebuildSellerIndex(segment: SiteSegmentKey, products: Product[], generatedAt: Timestamp): Promise<RebuildSellerIndexResult> {
  const indexId = buildIndexId(segment);
  const versionId = buildVersionId(generatedAt.toDate());
  const items = buildItems(products);
  const chunks = chunkItems(items);
  const chunkIds = chunks.map((_, index) => index.toString().padStart(4, "0"));
  const rootRef = db.collection(SELLER_INDEXES_COLLECTION).doc(indexId);
  const versionsRef = rootRef.collection("versions");
  const versionRef = versionsRef.doc(versionId);
  const previousSnapshot = await rootRef.get();
  const previous = previousSnapshot.exists ? previousSnapshot.data() as Partial<SellerIndexRootDocument> : undefined;
  const previousActiveVersion = typeof previous?.activeVersion === "string" ? previous.activeVersion : undefined;
  const versionToDelete = typeof previous?.previousVersion === "string" ? previous.previousVersion : undefined;
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
    await commitSets(chunks.map((chunkItems, index) => ({
      ref: versionRef.collection("chunks").doc(chunkIds[index]),
      data: removeUndefinedDeep({
        indexId,
        versionId,
        chunkId: chunkIds[index],
        index,
        itemCount: chunkItems.length,
        items: chunkItems,
        generatedAt,
      } satisfies SellerIndexChunkDocument) as Record<string, unknown>,
    })));
    await versionRef.set(removeUndefinedDeep({ ...building, status: "ready", updatedAt: generatedAt }), { merge: false });
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
      try { await deleteVersion(versionsRef.doc(versionToDelete)); } catch (error) {
        console.warn("Failed to delete old seller index version", { indexId, versionToDelete, error });
      }
    }
    return { indexId, versionId, itemCount: items.length, chunkCount: chunks.length };
  } catch (error) {
    if (!activated) {
      try { await deleteVersion(versionRef); } catch (cleanupError) {
        console.warn("Failed to clean up incomplete seller index", { indexId, versionId, cleanupError });
      }
    }
    throw error;
  }
}
