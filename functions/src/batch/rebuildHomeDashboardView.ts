import type { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  HomeDashboardViewDocument,
  HomeProductIdsByWorkType,
  HomeRankingWorkType,
  HomeWeeklyCircleCandidate,
  Product,
  ProductContentType,
  ProductWorkType,
} from "../types";

const SITE_STATS_COLLECTION = "siteStats";
const HOME_VIEW_COLLECTION = "views";
const HOME_VIEW_DOCUMENT_ID = "home";
const HOME_VIEW_SCHEMA_VERSION = 1 as const;
const HOME_VIEW_STRATEGY = "homeDashboard_v1" as const;
const HOME_CANDIDATE_QUERY_LIMIT = 300;
const HOME_TOP_SALES_LIMIT = 30;
const HOME_WEEKLY_READ_LIMIT = 120;
const HOME_WEEKLY_TOP_LIMIT = 30;
const HOME_RECENT_LOOKBACK_DAYS = 3;
const HOME_WORK_TYPES: HomeRankingWorkType[] = ["all", "comic", "novel", "cg", "movie", "game", "voice", "other"];

export type HomeContentScope = "all" | ProductContentType;
type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;

  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.toDate === "function" && typeof timestampLike.seconds === "number") return value;
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

function buildSiteStatsId(segment: SiteSegmentKey, contentScope: HomeContentScope): string {
  const baseId = `${segment.platform}_${segment.audience}_${segment.category}`;
  return contentScope === "all" ? baseId : `${baseId}_${contentScope}`;
}

function normalizeStoredContentType(value: string | undefined): ProductContentType | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

function productHasContentScope(product: Product, contentScope: HomeContentScope): boolean {
  if (contentScope === "all") return true;
  const ids = (product.contentTypeIds ?? []).map((id) => normalizeStoredContentType(id));
  if (ids.includes(contentScope)) return true;
  const labels = (product.contentTypes ?? []).map((label) => normalizeStoredContentType(label));
  return labels.includes(contentScope);
}

function normalizeStoredWorkType(product: Product): ProductWorkType | undefined {
  const raw = (product.workType ?? product.workTypeLabel)?.toString().trim().toLowerCase();
  if (!raw) return undefined;
  if (["comic", "マンガ", "漫画", "同人誌"].includes(raw)) return "comic";
  if (["novel", "ノベル", "小説"].includes(raw)) return "novel";
  if (["cg", "ＣＧ", "イラスト", "cg・イラスト"].includes(raw)) return "cg";
  if (["movie", "video", "動画"].includes(raw)) return "movie";
  if (["game", "ゲーム"].includes(raw)) return "game";
  if (["voice", "sound", "音声", "asmr"].includes(raw)) return "voice";
  if (raw === "other") return "other";
  return undefined;
}

function matchesWorkType(product: Product, workType: HomeRankingWorkType): boolean {
  return workType === "all" || normalizeStoredWorkType(product) === workType;
}

function compareReleaseDateDesc(left: Product, right: Product): number {
  return (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") ||
    left.productId.localeCompare(right.productId);
}

function estimatedRevenue(product: Product): number {
  return (product.priceCurrent ?? 0) * (product.salesCount ?? 0);
}

function ratingValue(product: Product): number {
  return product.rating ?? product.ratingAverage ?? 0;
}

function compareSalesDesc(left: Product, right: Product): number {
  return (right.salesCount ?? 0) - (left.salesCount ?? 0) ||
    estimatedRevenue(right) - estimatedRevenue(left) ||
    ratingValue(right) - ratingValue(left) ||
    left.productId.localeCompare(right.productId);
}

function isSaleProduct(product: Product): boolean {
  return Boolean(product.isOnSale || product.isDiscounted || (product.discountRate ?? 0) > 0);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function toJstIsoDate(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}-${String(jst.getUTCDate()).padStart(2, "0")}`;
}

function getSellerKey(product: Product): string | undefined {
  return product.seller?.sellerId || product.seller?.sellerName;
}

function compactProduct(product: Product): Product {
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

function resolveSourceDate(products: Product[]): string | undefined {
  const counts = new Map<string, number>();
  for (const product of products) {
    const sourceDate = product.rankingMetrics?.sourceDate;
    if (!sourceDate || !/^\d{8}$/.test(sourceDate)) continue;
    counts.set(sourceDate, (counts.get(sourceDate) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  const maxCount = Math.max(0, ...entries.map(([, count]) => count));
  const minimumCoverageCount = Math.min(100, Math.max(2, Math.ceil(products.length * 0.01)));
  const minimumRepresentativeCount = Math.max(minimumCoverageCount, Math.ceil(maxCount * 0.25));
  return entries
    .filter(([, count]) => count >= minimumRepresentativeCount)
    .sort((left, right) => right[0].localeCompare(left[0]))[0]?.[0];
}

function buildTopSalesProductIds(products: Product[]): string[] {
  return [...products]
    .sort(compareSalesDesc)
    .slice(0, HOME_TOP_SALES_LIMIT)
    .map((product) => product.productId);
}

function buildWeeklyCircleCandidates(
  products: Product[],
  sourceDate: string | undefined,
): HomeWeeklyCircleCandidate[] {
  if (!sourceDate) return [];

  return products
    .filter((product) => {
      const metrics = product.rankingMetrics;
      return Boolean(
        getSellerKey(product) &&
        metrics &&
        metrics.sourceDate === sourceDate &&
        metrics.weeklyAvailable &&
        typeof metrics.weeklySalesCount === "number" &&
        Number.isFinite(metrics.weeklySalesCount),
      );
    })
    .sort((left, right) => {
      const salesDiff = (right.rankingMetrics?.weeklySalesCount ?? 0) -
        (left.rankingMetrics?.weeklySalesCount ?? 0);
      if (salesDiff !== 0) return salesDiff;
      return compareSalesDesc(left, right);
    })
    .slice(0, HOME_WEEKLY_READ_LIMIT)
    .slice(0, HOME_WEEKLY_TOP_LIMIT)
    .map((product) => ({
      product: compactProduct(product),
      weeklySalesCount: Math.max(0, product.rankingMetrics?.weeklySalesCount ?? 0),
    }));
}

export function buildHomeDashboardViewDocuments(
  segment: SiteSegmentKey,
  allProducts: Product[],
  generatedAt: Timestamp,
  contentScopes: HomeContentScope[] = ["all", "tl", "bl"],
): HomeDashboardViewDocument[] {
  const activeProducts = allProducts.filter((product) => product.isActive !== false);
  const recentSinceDate = toJstIsoDate(addDays(generatedAt.toDate(), -(HOME_RECENT_LOOKBACK_DAYS - 1)));

  return contentScopes.map((contentScope) => {
    const scopeProducts = activeProducts.filter((product) => productHasContentScope(product, contentScope));
    const sourceDate = resolveSourceDate(scopeProducts);
    const newCandidateProductIdsByWorkType: HomeProductIdsByWorkType = {};

    for (const workType of HOME_WORK_TYPES) {
      const newestCandidates = scopeProducts
        .filter((product) => matchesWorkType(product, workType))
        .sort(compareReleaseDateDesc)
        .slice(0, HOME_CANDIDATE_QUERY_LIMIT);
      newCandidateProductIdsByWorkType[workType] = buildTopSalesProductIds(newestCandidates);
    }

    const recentCandidates = scopeProducts
      .filter((product) => (product.releaseDate ?? "") >= recentSinceDate)
      .sort(compareReleaseDateDesc)
      .slice(0, HOME_CANDIDATE_QUERY_LIMIT);
    const saleCandidates = scopeProducts
      .filter(isSaleProduct)
      .sort(compareReleaseDateDesc)
      .slice(0, HOME_CANDIDATE_QUERY_LIMIT);
    const statId = buildSiteStatsId(segment, contentScope);
    return {
      schemaVersion: HOME_VIEW_SCHEMA_VERSION,
      strategy: HOME_VIEW_STRATEGY,
      statId,
      contentScope,
      sourceDate,
      newCandidateProductIdsByWorkType,
      recentCandidateProductIds: buildTopSalesProductIds(recentCandidates),
      saleCandidateProductIds: buildTopSalesProductIds(saleCandidates),
      weeklyCircleCandidates: buildWeeklyCircleCandidates(scopeProducts, sourceDate),
      generatedAt,
      updatedAt: generatedAt,
    } satisfies HomeDashboardViewDocument;
  });
}

export async function rebuildHomeDashboardViews(
  segment: SiteSegmentKey,
  allProducts: Product[],
  generatedAt: Timestamp,
  contentScopes: HomeContentScope[] = ["all", "tl", "bl"],
): Promise<string[]> {
  const documents = buildHomeDashboardViewDocuments(segment, allProducts, generatedAt, contentScopes);
  if (allProducts.length === 0) {
    const refs = documents.map((document) =>
      db
        .collection(SITE_STATS_COLLECTION)
        .doc(document.statId)
        .collection(HOME_VIEW_COLLECTION)
        .doc(HOME_VIEW_DOCUMENT_ID),
    );
    const existingSnapshots = refs.length > 0 ? await db.getAll(...refs) : [];
    if (existingSnapshots.some((snapshot) => snapshot.exists)) {
      throw new Error(
        "home dashboard rebuild produced no products; keeping the previous cached views",
      );
    }
  }

  const batch = db.batch();

  for (const document of documents) {
    const ref = db
      .collection(SITE_STATS_COLLECTION)
      .doc(document.statId)
      .collection(HOME_VIEW_COLLECTION)
      .doc(HOME_VIEW_DOCUMENT_ID);
    batch.set(ref, removeUndefinedDeep(document), { merge: false });
  }

  await batch.commit();
  return documents.map((document) => `${document.statId}/${HOME_VIEW_COLLECTION}/${HOME_VIEW_DOCUMENT_ID}`);
}
