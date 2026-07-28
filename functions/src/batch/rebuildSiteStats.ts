import { createHash } from "node:crypto";
import { FieldPath, type QueryDocumentSnapshot, type Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  Category,
  FetchTarget,
  Platform,
  Product,
  SellerStatsDocument,
  SellerType,
  SiteStatsDocument,
} from "../types";
import { nowTimestamp } from "../util";
import { rebuildSearchIndex } from "./rebuildSearchIndex";
import { rebuildRankingIndex } from "./rebuildRankingIndex";
import { rebuildGenreIndex } from "./rebuildGenreIndex";
import { rebuildSellerIndex } from "./rebuildSellerIndex";
import { rebuildHomeDashboardViews } from "./rebuildHomeDashboardView";
import {
  analyzeListViewDryRun,
  LIST_VIEW_DRY_RUN_PRODUCT_FIELDS,
  type ListViewDryRunOptions,
  type ListViewDryRunReport,
} from "./analyzeListViewDryRun";

const PRODUCTS_COLLECTION = "products";
const SITE_STATS_COLLECTION = "siteStats";
const SELLERS_COLLECTION = "sellers";
const SITE_STATS_PRODUCT_PAGE_SIZE = 1000;
const SELLER_WRITE_BATCH_SIZE = 400;
const MAX_POPULAR_GENRES = 30;
const MAX_POPULAR_CATEGORIES = 12;
const MAX_CIRCLE_HIGHLIGHTS = 12;
const MAX_CIRCLE_GENRES = 18;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type ContentStatsScope = "all" | "tl" | "bl";
const CONTENT_STATS_SCOPES: ContentStatsScope[] = ["all", "tl", "bl"];

type StoredProduct = Product & {
  isOnSale?: boolean;
  fetchedAt?: Timestamp;
  seller?: Product["seller"] & { sellerUrl?: string };
};

type CompactProduct = Product & {
  isOnSale?: boolean;
};

type GenreSummary = {
  name: string;
  genreId: string;
  productCount: number;
  totalSalesCount: number;
};

type ProductCategorySummary = {
  name: string;
  categoryId: string;
  kind: "contentType" | "workType";
  value: string;
  productCount: number;
  totalSalesCount: number;
};

type CircleHighlight = {
  sellerKey: string;
  sellerId?: string;
  sellerName: string;
  sellerUrl?: string;
  sellerType?: SellerType;
  platform: Platform;
  audience: FetchTarget["audience"];
  category: Category;
  productCount: number;
  totalSalesCount: number;
  averageSalesCount: number;
  estimatedRevenue: number;
  averagePrice?: number;
  firstReleaseDate?: string;
  latestReleaseDate?: string;
  newestProductTitle?: string;
  topProduct?: CompactProduct;
  latestProduct?: CompactProduct;
  tags: { name: string; count: number }[];
};


function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) {
    return undefined as T;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.toDate === "function" && typeof timestampLike.seconds === "number") {
    return value;
  }

  if (value instanceof Date) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cleanedItem = removeUndefinedDeep(item);
    if (cleanedItem !== undefined) {
      cleaned[key] = cleanedItem;
    }
  }

  return cleaned as T;
}

function stableComparableValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;

  if (value instanceof Date) return value.toISOString();

  const timestampLike = value as { seconds?: number; nanoseconds?: number; toDate?: () => Date };
  if (typeof timestampLike.seconds === "number" && typeof timestampLike.toDate === "function") {
    return {
      seconds: timestampLike.seconds,
      nanoseconds: timestampLike.nanoseconds ?? 0,
    };
  }

  if (Array.isArray(value)) {
    return value.map((item) => stableComparableValue(item));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, stableComparableValue(item)]),
  );
}

function buildSiteStatsId(segment: SiteSegmentKey, contentScope: ContentStatsScope = "all"): string {
  const baseId = `${segment.platform}_${segment.audience}_${segment.category}`;
  return contentScope === "all" ? baseId : `${baseId}_${contentScope}`;
}

function toMiB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function logRebuildMemoryUsage(
  stage: string,
  segment: SiteSegmentKey,
  productCount: number,
): void {
  const memory = process.memoryUsage();
  console.log("rebuild indexes memory usage", {
    stage,
    segmentId: buildSiteStatsId(segment),
    productCount,
    heapUsedMiB: toMiB(memory.heapUsed),
    heapTotalMiB: toMiB(memory.heapTotal),
    rssMiB: toMiB(memory.rss),
    externalMiB: toMiB(memory.external),
  });
}

function toJstDateKey(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function timestampLikeToDate(value: unknown): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value;

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  if (typeof value === "object") {
    const maybeTimestamp = value as { seconds?: number; toDate?: () => Date };
    if (typeof maybeTimestamp.toDate === "function") return maybeTimestamp.toDate();
    if (typeof maybeTimestamp.seconds === "number") return new Date(maybeTimestamp.seconds * 1000);
  }

  return undefined;
}

function dateLikeToJstDateKey(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const dateOnly = trimmed.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) return dateOnly;
  }

  const date = timestampLikeToDate(value);
  return date ? toJstDateKey(date) : undefined;
}

function isProductReleasedToday(product: StoredProduct, todayKey: string): boolean {
  return dateLikeToJstDateKey(product.releaseDate) === todayKey;
}

function isSaleProduct(product: StoredProduct): boolean {
  return Boolean(product.isOnSale || product.isDiscounted || (product.discountRate ?? 0) > 0);
}

function normalizeStoredContentType(value: string | undefined): "tl" | "bl" | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

function productHasContentScope(product: StoredProduct, contentScope: ContentStatsScope): boolean {
  if (contentScope === "all") return true;

  const ids = (product.contentTypeIds ?? []).map((id) => normalizeStoredContentType(id));
  if (ids.includes(contentScope)) return true;

  const labels = (product.contentTypes ?? []).map((label) => normalizeStoredContentType(label));
  return labels.includes(contentScope);
}

function filterProductsByContentScope(products: StoredProduct[], contentScope: ContentStatsScope): StoredProduct[] {
  return contentScope === "all" ? products : products.filter((product) => productHasContentScope(product, contentScope));
}

function genreNameFromId(genreId: string): string {
  return genreId.replace(/^dlsite:/, "");
}

function normalizeGenreId(name: string, genreId?: string): string {
  const cleanGenreId = genreId?.trim();
  if (cleanGenreId) return cleanGenreId;
  return name.startsWith("dlsite:") ? name : `dlsite:${name}`;
}

function buildGenreSummaries(products: StoredProduct[]): GenreSummary[] {
  const genreMap = new Map<string, GenreSummary>();

  for (const product of products) {
    const genres = product.genres ?? [];
    const genreIds = product.genreIds ?? [];
    const maxLength = Math.max(genres.length, genreIds.length);
    const seenGenreIds = new Set<string>();

    for (let index = 0; index < maxLength; index += 1) {
      const rawName = genres[index]?.trim() || genreNameFromId(genreIds[index] ?? "").trim();
      if (!rawName) continue;

      const genreId = normalizeGenreId(rawName, genreIds[index]);
      if (seenGenreIds.has(genreId)) continue;
      seenGenreIds.add(genreId);

      const current = genreMap.get(genreId) ?? {
        name: rawName,
        genreId,
        productCount: 0,
        totalSalesCount: 0,
      };

      current.productCount += 1;
      current.totalSalesCount += product.salesCount ?? 0;
      genreMap.set(genreId, current);
    }
  }

  return [...genreMap.values()].sort(
    (a, b) =>
      b.totalSalesCount - a.totalSalesCount ||
      b.productCount - a.productCount ||
      a.name.localeCompare(b.name, "ja"),
  );
}



function normalizeContentCategoryId(value: string): string {
  const normalized = value.replace(/^dlsite:/, "").trim().toLowerCase();
  return `contentType:${normalized}`;
}

function buildProductCategorySummaries(products: StoredProduct[]): ProductCategorySummary[] {
  const categoryMap = new Map<string, ProductCategorySummary>();

  const addCategory = (params: { name: string; categoryId: string; kind: "contentType" | "workType"; value: string; product: StoredProduct }) => {
    const current = categoryMap.get(params.categoryId) ?? {
      name: params.name,
      categoryId: params.categoryId,
      kind: params.kind,
      value: params.value,
      productCount: 0,
      totalSalesCount: 0,
    } satisfies ProductCategorySummary;

    current.productCount += 1;
    current.totalSalesCount += params.product.salesCount ?? 0;
    categoryMap.set(params.categoryId, current);
  };

  for (const product of products) {
    const seenCategoryIds = new Set<string>();

    (product.contentTypeIds ?? []).forEach((rawId) => {
      const value = rawId.replace(/^dlsite:/, "").trim().toLowerCase();
      if (value !== "tl" && value !== "bl") return;
      const categoryId = normalizeContentCategoryId(value);
      if (seenCategoryIds.has(categoryId)) return;
      seenCategoryIds.add(categoryId);
      addCategory({
        name: value === "bl" ? "BL" : "TL",
        categoryId,
        kind: "contentType",
        value,
        product,
      });
    });

    if (product.workType) {
      const categoryId = `workType:${product.workType}`;
      if (!seenCategoryIds.has(categoryId)) {
        addCategory({
          name: product.workTypeLabel || product.workType,
          categoryId,
          kind: "workType",
          value: product.workType,
          product,
        });
      }
    }
  }

  const order = new Map([
    ["contentType:tl", 0],
    ["contentType:bl", 1],
    ["workType:comic", 2],
    ["workType:game", 3],
    ["workType:voice", 4],
    ["workType:cg", 5],
    ["workType:movie", 6],
    ["workType:other", 7],
  ]);

  return Array.from(categoryMap.values())
    .sort((a, b) => {
      const orderDiff = (order.get(a.categoryId) ?? 99) - (order.get(b.categoryId) ?? 99);
      if (orderDiff !== 0) return orderDiff;
      const salesDiff = b.totalSalesCount - a.totalSalesCount;
      if (salesDiff !== 0) return salesDiff;
      return a.name.localeCompare(b.name, "ja");
    })
    .slice(0, MAX_POPULAR_CATEGORIES);
}

function getSellerKey(product: StoredProduct): string | undefined {
  return product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim() || undefined;
}

function compareDateDesc(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

function compactProduct(product?: StoredProduct): CompactProduct | undefined {
  if (!product) return undefined;

  return {
    productId: product.productId,
    sourceProductId: product.sourceProductId,
    platform: product.platform,
    audience: product.audience,
    category: product.category,
    categories: product.categories,
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
    wishlistCount: product.wishlistCount,
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
    latestRankings: product.latestRankings,
    isActive: product.isActive,
    fetchStatus: product.fetchStatus,
    lastFetchedAt: product.lastFetchedAt,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function buildSellerSummaries(products: StoredProduct[]): CircleHighlight[] {
  const groups = new Map<string, StoredProduct[]>();

  for (const product of products) {
    const key = getSellerKey(product);
    if (!key) continue;
    const current = groups.get(key) ?? [];
    current.push(product);
    groups.set(key, current);
  }

  return Array.from(groups.entries())
    .map(([sellerKey, sellerProducts]) => {
      const sortedBySales = [...sellerProducts].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0));
      const sortedByRelease = [...sellerProducts].sort((a, b) => compareDateDesc(a.releaseDate, b.releaseDate));
      const topProduct = sortedBySales[0];
      const latestProduct = sortedByRelease[0] ?? topProduct;
      const totalSalesCount = sellerProducts.reduce((sum, product) => sum + (product.salesCount ?? 0), 0);
      const estimatedRevenue = sellerProducts.reduce(
        (sum, product) => sum + (product.salesCount ?? 0) * (product.priceCurrent ?? 0),
        0,
      );
      const tagCount = new Map<string, number>();

      for (const product of sellerProducts) {
        for (const genre of (product.genres ?? []).filter(Boolean)) {
          tagCount.set(genre, (tagCount.get(genre) ?? 0) + 1);
        }
      }

      const tags = [...tagCount.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
        .slice(0, MAX_CIRCLE_GENRES)
        .map(([name, count]) => ({ name, count }));

      return {
        sellerKey,
        sellerId: topProduct?.seller?.sellerId,
        sellerName: topProduct?.seller?.sellerName ?? sellerKey,
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
        firstReleaseDate: [...sellerProducts].sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""))[0]
          ?.releaseDate,
        latestReleaseDate: latestProduct?.releaseDate,
        newestProductTitle: latestProduct?.title,
        topProduct: compactProduct(topProduct),
        latestProduct: compactProduct(latestProduct),
        tags,
      } satisfies CircleHighlight;
    })
    .sort((a, b) => b.totalSalesCount - a.totalSalesCount || b.productCount - a.productCount);
}

function buildSellerStatsId(statId: string, sellerKey: string): string {
  const sellerHash = createHash("sha256").update(sellerKey).digest("hex").slice(0, 32);
  return `${statId}_${sellerHash}`;
}

function toSellerStatsDocument(
  statId: string,
  contentScope: ContentStatsScope,
  summary: CircleHighlight,
  generatedAt: Timestamp,
): SellerStatsDocument {
  return {
    sellerStatsId: buildSellerStatsId(statId, summary.sellerKey),
    statId,
    sellerKey: summary.sellerKey,
    sellerId: summary.sellerId,
    sellerName: summary.sellerName,
    sellerUrl: summary.sellerUrl,
    sellerType: summary.sellerType,
    platform: summary.platform,
    audience: summary.audience,
    category: summary.category,
    contentScope,
    productCount: summary.productCount,
    totalSalesCount: summary.totalSalesCount,
    averageSalesCount: summary.averageSalesCount,
    estimatedRevenue: summary.estimatedRevenue,
    averagePrice: summary.averagePrice,
    firstReleaseDate: summary.firstReleaseDate,
    latestReleaseDate: summary.latestReleaseDate,
    newestProductTitle: summary.newestProductTitle,
    topProduct: summary.topProduct,
    latestProduct: summary.latestProduct,
    tags: summary.tags,
    isActive: true,
    generatedAt,
    updatedAt: generatedAt,
  };
}

async function replaceSellerStatsForScope(
  statId: string,
  sellerStats: SellerStatsDocument[],
): Promise<void> {
  const existingSnapshot = await db
    .collection(SELLERS_COLLECTION)
    .where("statId", "==", statId)
    .get();
  const existingById = new Map(
    existingSnapshot.docs.map((doc) => [doc.id, doc.data() as SellerStatsDocument]),
  );
  const currentIds = new Set(sellerStats.map((seller) => seller.sellerStatsId));
  const staleIds = existingSnapshot.docs
    .map((doc) => doc.id)
    .filter((id) => !currentIds.has(id));
  const changedSellerStats = sellerStats.filter((seller) => {
    const existing = existingById.get(seller.sellerStatsId);
    if (!existing) return true;

    const { generatedAt: _existingGeneratedAt, updatedAt: _existingUpdatedAt, ...existingComparable } =
      removeUndefinedDeep(existing);
    const { generatedAt: _nextGeneratedAt, updatedAt: _nextUpdatedAt, ...nextComparable } =
      removeUndefinedDeep(seller);
    return JSON.stringify(stableComparableValue(existingComparable)) !==
      JSON.stringify(stableComparableValue(nextComparable));
  });

  const operations: Array<
    | { type: "set"; seller: SellerStatsDocument }
    | { type: "delete"; documentId: string }
  > = [
    ...changedSellerStats.map((seller) => ({ type: "set" as const, seller })),
    ...staleIds.map((documentId) => ({ type: "delete" as const, documentId })),
  ];

  for (let index = 0; index < operations.length; index += SELLER_WRITE_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = operations.slice(index, index + SELLER_WRITE_BATCH_SIZE);

    for (const operation of chunk) {
      const ref = db.collection(SELLERS_COLLECTION).doc(
        operation.type === "set" ? operation.seller.sellerStatsId : operation.documentId,
      );
      if (operation.type === "set") {
        batch.set(ref, removeUndefinedDeep(operation.seller), { merge: false });
      } else {
        batch.delete(ref);
      }
    }

    await batch.commit();
  }
}

async function getProductsForListViewDryRun(segment: SiteSegmentKey): Promise<StoredProduct[]> {
  const products: StoredProduct[] = [];
  let lastDoc: QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db
      .collection(PRODUCTS_COLLECTION)
      .where("platform", "==", segment.platform)
      .where("audience", "==", segment.audience)
      .where("category", "==", segment.category)
      .where("isActive", "==", true)
      .select(...LIST_VIEW_DRY_RUN_PRODUCT_FIELDS)
      .orderBy(FieldPath.documentId())
      .limit(SITE_STATS_PRODUCT_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() as StoredProduct;
      products.push({ ...data, productId: (data as Product).productId ?? doc.id });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < SITE_STATS_PRODUCT_PAGE_SIZE) break;
  }

  return products;
}

async function getProductsForSiteStats(segment: SiteSegmentKey): Promise<StoredProduct[]> {
  const products: StoredProduct[] = [];
  let lastDoc: QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db
      .collection(PRODUCTS_COLLECTION)
      .where("platform", "==", segment.platform)
      .where("audience", "==", segment.audience)
      .where("category", "==", segment.category)
      .where("isActive", "==", true)
      .orderBy(FieldPath.documentId())
      .limit(SITE_STATS_PRODUCT_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() as StoredProduct;
      products.push({ ...data, productId: (data as Product).productId ?? doc.id });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < SITE_STATS_PRODUCT_PAGE_SIZE) break;
  }

  return products;
}

async function rebuildSiteStatsFromProducts(
  segment: SiteSegmentKey,
  contentScope: ContentStatsScope,
  allProducts: StoredProduct[],
  generatedAt: Timestamp,
): Promise<string> {
  const statId = buildSiteStatsId(segment, contentScope);
  const products = filterProductsByContentScope(allProducts, contentScope);
  const todayKey = toJstDateKey(new Date());
  const popularGenres = buildGenreSummaries(products).slice(0, MAX_POPULAR_GENRES);
  const popularCategories = buildProductCategorySummaries(products);
  const sellerSummaries = buildSellerSummaries(products);
  const circleHighlights = sellerSummaries.slice(0, MAX_CIRCLE_HIGHLIGHTS);
  const sellerStats = sellerSummaries.map((summary) =>
    toSellerStatsDocument(statId, contentScope, summary, generatedAt),
  );

  const siteStats: SiteStatsDocument = {
    statId,
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    productCount: products.length,
    todayUpdatedCount: products.filter((product) => isProductReleasedToday(product, todayKey)).length,
    saleCount: products.filter(isSaleProduct).length,
    topGenre: popularGenres[0],
    popularGenres,
    popularCategories,
    circleHighlights,
    sellerCount: sellerStats.length,
    sellerStatsGeneratedAt: generatedAt,
    maxProducts: products.length,
    generatedAt,
    updatedAt: generatedAt,
  };

  await replaceSellerStatsForScope(statId, sellerStats);
  await db.collection(SITE_STATS_COLLECTION).doc(statId).set(removeUndefinedDeep(siteStats), { merge: true });
  return statId;
}

export async function rebuildSiteStats(segment: SiteSegmentKey, contentScope: ContentStatsScope = "all"): Promise<string> {
  const allProducts = await getProductsForSiteStats(segment);
  const generatedAt = nowTimestamp();
  const statId = await rebuildSiteStatsFromProducts(segment, contentScope, allProducts, generatedAt);

  try {
    await rebuildHomeDashboardViews(segment, allProducts, generatedAt, [contentScope]);
  } catch (error) {
    console.error("Failed to rebuild home dashboard view; keeping the previous cached view", {
      segment,
      contentScope,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await rebuildSearchIndex(segment, allProducts, generatedAt);
  } catch (error) {
    console.error("Failed to rebuild search index; keeping the previous active version", {
      segment,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await rebuildRankingIndex(segment, allProducts, generatedAt);
  } catch (error) {
    console.error("Failed to rebuild ranking index; keeping the previous active version", {
      segment,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await rebuildGenreIndex(segment, allProducts, generatedAt);
  } catch (error) {
    console.error("Failed to rebuild genre index; keeping the previous active version", {
      segment,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await rebuildSellerIndex(segment, allProducts, generatedAt);
  } catch (error) {
    console.error("Failed to rebuild seller index; keeping the previous active version", {
      segment,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return statId;
}

export type RebuildComponentStatus = "success" | "failed";

export type RebuildComponentResult = {
  status: RebuildComponentStatus;
  error?: string;
  details?: unknown;
};

export type RebuildSiteStatsSegmentResult = {
  segmentId: string;
  productCount: number;
  components: {
    siteStats: RebuildComponentResult;
    homeViews: RebuildComponentResult;
    searchIndex: RebuildComponentResult;
    rankingIndex: RebuildComponentResult;
    genreIndex: RebuildComponentResult;
    sellerIndex: RebuildComponentResult;
  };
};

export type RebuildSiteStatsForTargetsResult = {
  status: "success" | "partial";
  siteStatsIds: string[];
  segments: RebuildSiteStatsSegmentResult[];
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runRebuildComponent<T>(
  name: string,
  segment: SiteSegmentKey,
  productCount: number,
  operation: () => Promise<T>,
): Promise<RebuildComponentResult> {
  try {
    const details = await operation();
    console.log(`${name} rebuilt`, details);
    return { status: "success", details };
  } catch (error) {
    const message = toErrorMessage(error);
    console.error(`Failed to rebuild ${name}; keeping the previous active data`, {
      segment,
      error: message,
    });
    return { status: "failed", error: message };
  } finally {
    logRebuildMemoryUsage(name, segment, productCount);
  }
}

export async function rebuildSiteStatsForTargetsDetailed(
  targets: SiteSegmentKey[],
): Promise<RebuildSiteStatsForTargetsResult> {
  const uniqueSegments = new Map<string, SiteSegmentKey>();

  for (const target of targets) {
    const statId = buildSiteStatsId(target);
    uniqueSegments.set(statId, {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    });
  }

  const statIds: string[] = [];
  const segments: RebuildSiteStatsSegmentResult[] = [];

  for (const segment of uniqueSegments.values()) {
    const segmentId = buildSiteStatsId(segment);
    const allProducts = await getProductsForSiteStats(segment);
    const generatedAt = nowTimestamp();
    const segmentStatIds: string[] = [];
    logRebuildMemoryUsage("products loaded", segment, allProducts.length);

    for (const contentScope of CONTENT_STATS_SCOPES) {
      segmentStatIds.push(
        await rebuildSiteStatsFromProducts(
          segment,
          contentScope,
          allProducts,
          generatedAt,
        ),
      );
    }
    statIds.push(...segmentStatIds);
    logRebuildMemoryUsage("site stats", segment, allProducts.length);

    const components: RebuildSiteStatsSegmentResult["components"] = {
      siteStats: {
        status: "success",
        details: { statIds: segmentStatIds },
      },
      homeViews: await runRebuildComponent(
        "home dashboard views",
        segment,
        allProducts.length,
        () =>
          rebuildHomeDashboardViews(
            segment,
            allProducts,
            generatedAt,
            CONTENT_STATS_SCOPES,
          ),
      ),
      searchIndex: await runRebuildComponent(
        "search index",
        segment,
        allProducts.length,
        () => rebuildSearchIndex(segment, allProducts, generatedAt),
      ),
      rankingIndex: await runRebuildComponent(
        "ranking index",
        segment,
        allProducts.length,
        () => rebuildRankingIndex(segment, allProducts, generatedAt),
      ),
      genreIndex: await runRebuildComponent(
        "genre index",
        segment,
        allProducts.length,
        () => rebuildGenreIndex(segment, allProducts, generatedAt),
      ),
      sellerIndex: await runRebuildComponent(
        "seller index",
        segment,
        allProducts.length,
        () => rebuildSellerIndex(segment, allProducts, generatedAt),
      ),
    };

    segments.push({
      segmentId,
      productCount: allProducts.length,
      components,
    });
  }

  const hasFailure = segments.some((segment) =>
    Object.values(segment.components).some(
      (component) => component.status === "failed",
    ),
  );

  return {
    status: hasFailure ? "partial" : "success",
    siteStatsIds: [...new Set(statIds)],
    segments,
  };
}

export async function rebuildSiteStatsForTargets(
  targets: SiteSegmentKey[],
): Promise<string[]> {
  const result = await rebuildSiteStatsForTargetsDetailed(targets);
  return result.siteStatsIds;
}

export type AnalyzeListViewDryRunForTargetsResult = {
  status: "success";
  dryRun: true;
  writesPerformed: false;
  reports: ListViewDryRunReport[];
};

/**
 * Phase 0 only: reads active product documents and estimates the proposed
 * list-view/search-view footprint. This function never writes to Firestore.
 */
export async function analyzeListViewDryRunForTargets(
  targets: SiteSegmentKey[],
  options: ListViewDryRunOptions = {},
): Promise<AnalyzeListViewDryRunForTargetsResult> {
  const uniqueSegments = new Map<string, SiteSegmentKey>();
  for (const target of targets) {
    const segmentId = buildSiteStatsId(target);
    uniqueSegments.set(segmentId, {
      platform: target.platform,
      audience: target.audience,
      category: target.category,
    });
  }

  const reports: ListViewDryRunReport[] = [];
  for (const segment of uniqueSegments.values()) {
    const products = await getProductsForListViewDryRun(segment);
    const report = analyzeListViewDryRun(segment, products, options);
    reports.push(report);
    console.log("List-view Phase 0 dry-run completed", {
      segmentId: report.segmentId,
      productCount: report.productCount,
      elapsedMs: report.elapsedMs,
      selectedBlockSize: report.totals.selectedBlockSize,
      recommendedBlockSize: report.recommendation.recommendedBlockSize,
      listCount: report.totals.listCount,
      blockCount: report.totals.blockCount,
      totalCompressedBytes: report.totals.totalCompressedBytes,
      estimatedCreateWrites: report.totals.estimatedCreateWrites,
      estimatedCleanupDeletes: report.totals.estimatedCleanupDeletes,
      estimatedDailyMutationsWithCleanup:
        report.totals.estimatedDailyMutationsWithCleanup,
      oversizedDocumentCount: report.totals.oversizedDocumentCount,
      maxObservedHeapUsed: report.maxObservedMemory.heapUsed,
      maxObservedRss: report.maxObservedMemory.rss,
      warnings: report.warnings,
    });
  }

  return {
    status: "success",
    dryRun: true,
    writesPerformed: false,
    reports,
  };
}
