import { FieldPath, type QueryDocumentSnapshot, type Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type { Category, FetchTarget, Platform, Product, SellerType, SiteStatsDocument } from "../types";
import { nowTimestamp } from "../util";

const PRODUCTS_COLLECTION = "products";
const SITE_STATS_COLLECTION = "siteStats";
const SITE_STATS_PRODUCT_PAGE_SIZE = 1000;
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

function buildSiteStatsId(segment: SiteSegmentKey, contentScope: ContentStatsScope = "all"): string {
  const baseId = `${segment.platform}_${segment.audience}_${segment.category}`;
  return contentScope === "all" ? baseId : `${baseId}_${contentScope}`;
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

function buildCircleHighlights(products: StoredProduct[]): CircleHighlight[] {
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
    .sort((a, b) => b.totalSalesCount - a.totalSalesCount || b.productCount - a.productCount)
    .slice(0, MAX_CIRCLE_HIGHLIGHTS);
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

export async function rebuildSiteStats(segment: SiteSegmentKey, contentScope: ContentStatsScope = "all"): Promise<string> {
  const statId = buildSiteStatsId(segment, contentScope);
  const allProducts = await getProductsForSiteStats(segment);
  const products = filterProductsByContentScope(allProducts, contentScope);
  const todayKey = toJstDateKey(new Date());
  const popularGenres = buildGenreSummaries(products).slice(0, MAX_POPULAR_GENRES);
  const popularCategories = buildProductCategorySummaries(products);
  const circleHighlights = buildCircleHighlights(products);
  const generatedAt = nowTimestamp();

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
    maxProducts: products.length,
    generatedAt,
    updatedAt: generatedAt,
  };

  await db.collection(SITE_STATS_COLLECTION).doc(statId).set(removeUndefinedDeep(siteStats), { merge: true });
  return statId;
}

export async function rebuildSiteStatsForTargets(targets: SiteSegmentKey[]): Promise<string[]> {
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
  for (const segment of uniqueSegments.values()) {
    for (const contentScope of CONTENT_STATS_SCOPES) {
      statIds.push(await rebuildSiteStats(segment, contentScope));
    }
  }

  return statIds;
}
