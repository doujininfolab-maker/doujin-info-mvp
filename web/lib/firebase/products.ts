import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import { getSearchIndexCandidates } from "./searchIndex";
import { getGenreIndexEntries } from "./genreIndex";
import { getSellerIndexItems } from "./sellerIndex";
import { getRankingIndexEntries } from "./rankingIndex";
import { getListViewMode, getNewListViewPage } from "./newListView";
import { getRankingListViewPage } from "./rankingListView";
import { getSellerListViewPage } from "./sellerListView";
import { getSaleListViewPage } from "./saleListView";
import { getHomeDashboardListView } from "./homeDashboardListView";
import type {
  HomeDailyRankingProductIds,
  HomeDashboardViewDocument,
  Product,
  ProductCardItem,
  ProductListFilter,
  ProductWorkType,
  ProductRankingMode,
  HomeDashboardStats,
  GenreSummary,
  GenreRankingItem,
  GenreSortMode,
  SaleSortMode,
  SellerSortMode,
  SellerIndexItem,
  ProductCategorySummary,
  ProductDailyMetric,
  ProductTrendPoint,
  RankingSnapshot,
  RankingSnapshotItem,
  RankingType,
  SearchIndexItem,
  SellerStatsDocument,
  SellerCardItem,
  SellerSummary,
  SiteStatsDocument,
} from "../types";
import type { SearchTarget } from "../searchTarget";

const PRODUCTS_COLLECTION = "products";
const RANKING_SNAPSHOTS_COLLECTION = "rankingSnapshots";
const SITE_STATS_COLLECTION = "siteStats";
const SELLERS_COLLECTION = "sellers";

const JST_TIME_ZONE = "Asia/Tokyo";

function toJstDateParts(date = new Date()): { year: string; month: string; day: string } {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: JST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

  return {
    year: parts.year ?? "1970",
    month: parts.month ?? "01",
    day: parts.day ?? "01",
  };
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toJstDateKey(date = new Date()): string {
  const parts = toJstDateParts(date);
  return `${parts.year}${parts.month}${parts.day}`;
}

function toJstIsoDate(date = new Date()): string {
  const parts = toJstDateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeMetricDate(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  const yyyymmdd = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd?.[1] && yyyymmdd[2] && yyyymmdd[3]) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso?.[1] && iso[2] && iso[3]) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  return undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}


function toProduct(id: string, data: FirebaseFirestore.DocumentData): Product {
  return {
    ...(data as Product),
    productId: (data as Product).productId ?? id,
  };
}

function normalizeStoredWorkType(product: Product): string | undefined {
  const raw = (product.workType ?? product.workTypeLabel)?.toString().trim().toLowerCase();
  if (!raw) return undefined;
  if (["comic", "マンガ", "漫画", "同人誌"].includes(raw)) return "comic";
  if (["novel", "ノベル", "小説"].includes(raw)) return "novel";
  if (["cg", "ＣＧ", "イラスト", "cg・イラスト"].includes(raw)) return "cg";
  if (["movie", "video", "動画"].includes(raw)) return "movie";
  if (["game", "ゲーム"].includes(raw)) return "game";
  if (["voice", "sound", "音声", "asmr"].includes(raw)) return "voice";
  return raw;
}



function normalizeStoredContentType(value: string | undefined): string | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return raw;
}

function productHasContentType(product: Product, contentType: string): boolean {
  const normalized = normalizeStoredContentType(contentType);
  if (!normalized) return false;

  const ids = (product.contentTypeIds ?? []).map((id) => normalizeStoredContentType(id));
  if (ids.includes(normalized)) return true;

  const labels = (product.contentTypes ?? []).map((label) => normalizeStoredContentType(label));
  return labels.includes(normalized);
}

function matchesProductListFilter(product: Product, filter: ProductListFilter): boolean {
  if (filter.workType && normalizeStoredWorkType(product) !== filter.workType) return false;
  if (filter.contentType && !productHasContentType(product, filter.contentType)) return false;
  if (filter.discountRateMin !== undefined && (product.discountRate ?? 0) < filter.discountRateMin) return false;
  return true;
}

function shouldPostFilter(filter: ProductListFilter): boolean {
  return Boolean(filter.workType || filter.contentType || filter.discountRateMin !== undefined);
}

function postFilterProducts(products: Product[], filter: ProductListFilter): Product[] {
  const offset = filter.offsetCount ?? 0;
  const limit = filter.limitCount ?? 24;
  return products.filter((product) => matchesProductListFilter(product, filter)).slice(offset, offset + limit);
}

function getEstimatedRevenueValue(product: Product): number {
  const price = product.priceCurrent ?? 0;
  const sales = product.salesCount ?? 0;
  return price * sales;
}

function sortProductsByEstimatedRevenue(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const revenueDiff = getEstimatedRevenueValue(b) - getEstimatedRevenueValue(a);
    if (revenueDiff !== 0) return revenueDiff;

    const salesDiff = (b.salesCount ?? 0) - (a.salesCount ?? 0);
    if (salesDiff !== 0) return salesDiff;

    return (b.rating ?? b.ratingAverage ?? 0) - (a.rating ?? a.ratingAverage ?? 0);
  });
}

function sortProductsBySales(products: Product[]): Product[] {
  return [...products].sort((a, b) => {
    const salesDiff = (b.salesCount ?? 0) - (a.salesCount ?? 0);
    if (salesDiff !== 0) return salesDiff;

    const revenueDiff = getEstimatedRevenueValue(b) - getEstimatedRevenueValue(a);
    if (revenueDiff !== 0) return revenueDiff;

    return (b.rating ?? b.ratingAverage ?? 0) - (a.rating ?? a.ratingAverage ?? 0);
  });
}

function shuffleValues<T>(values: T[]): T[] {
  const shuffled = [...values];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

function shuffleProducts(products: Product[]): Product[] {
  return shuffleValues(products);
}

function pickRandomTopSalesProducts(products: Product[], filter: ProductListFilter, topSalesLimit = 30): Product[] {
  return shuffleProducts(sortProductsBySales(products).slice(0, topSalesLimit)).slice(0, filter.limitCount ?? 10);
}

function rankingTypeForMode(mode?: ProductRankingMode): RankingType | undefined {
  if (mode === "weekly") return "weekly";
  if (mode === "monthly") return "monthly";
  if (mode === "cumulative") return undefined;
  return "daily";
}

function buildRankingKey(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
  rankingType: RankingType,
  contentType: "tl" | "bl",
): string {
  return `${filter.platform}_${filter.audience}_${filter.category}_${contentType}_${rankingType}`;
}

async function getLatestRankingSnapshots(
  filter: ProductListFilter,
  rankingType: RankingType,
): Promise<RankingSnapshot[]> {
  const db = getAdminDb();
  const contentTypes: Array<"tl" | "bl"> = filter.contentType
    ? [filter.contentType]
    : ["tl", "bl"];

  const snapshots = await Promise.all(
    contentTypes.map(async (contentType) => {
      const rankingKey = buildRankingKey(filter, rankingType, contentType);
      const snapshotDocs = await db
        .collection(RANKING_SNAPSHOTS_COLLECTION)
        .where("rankingKey", "==", rankingKey)
        .orderBy("date", "desc")
        .limit(1)
        .get();

      if (snapshotDocs.empty) return undefined;
      const snapshotDoc = snapshotDocs.docs[0];
      return {
        ...(snapshotDoc.data() as RankingSnapshot),
        snapshotId: snapshotDoc.id,
      } satisfies RankingSnapshot;
    }),
  );

  return snapshots.filter((snapshot): snapshot is RankingSnapshot => Boolean(snapshot));
}

async function getEstimatedRevenueProducts(filter: ProductListFilter): Promise<Product[]> {
  const db = getAdminDb();

  const query = db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .orderBy("salesCount", "desc");

  const snapshot = await query.limit(queryLimitForFilter(filter, Math.max((filter.limitCount ?? 24) * 8, 300))).get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));

  return postFilterProducts(sortProductsByEstimatedRevenue(products), filter);
}

function queryLimitForFilter(filter: ProductListFilter, fallback: number): number {
  if (!shouldPostFilter(filter)) return fallback;
  // Firestoreの複合indexを増やさずMVPで安全に動かすため、絞り込み時は少し多めに読んでからサーバー側で絞る。
  // 掲載数が増えたら workType / discountRate を含む複合index方式に切り替える。
  return Math.max((filter.offsetCount ?? 0) + (filter.limitCount ?? 24) * 8, 300);
}


export async function getPopularProducts(
  filter: ProductListFilter,
): Promise<Product[]> {
  const db = getAdminDb();
  const needsPostFilter = shouldPostFilter(filter);

  let query = db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .orderBy("salesCount", "desc");

  if (!needsPostFilter) {
    query = query.offset(filter.offsetCount ?? 0);
  }

  const snapshot = await query.limit(queryLimitForFilter(filter, filter.limitCount ?? 24)).get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));

  return needsPostFilter ? postFilterProducts(products, filter) : products;
}


function catalogCandidateMatchesFilter(candidate: SearchIndexItem, filter: ProductListFilter): boolean {
  if (filter.workType && normalizeStoredWorkType(candidate as Product) !== filter.workType) return false;
  if (filter.contentType && !candidateHasContentType(candidate, filter.contentType)) return false;
  if (filter.discountRateMin !== undefined && (candidate.discountRate ?? 0) < filter.discountRateMin) return false;
  return true;
}

async function getCatalogProductsPage(
  filter: ProductListFilter,
  options: {
    predicate?: (candidate: SearchIndexItem) => boolean;
    compare: (left: SearchIndexItem, right: SearchIndexItem) => number;
  },
): Promise<Product[] | undefined> {
  const candidates = await getSearchIndexCandidates(filter);
  if (!candidates) {
    console.warn("Product catalog index unavailable; using Firestore fallback", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
    });
    return undefined;
  }
  const offset = filter.offsetCount ?? 0;
  const limit = filter.limitCount ?? 24;
  const selectedIds = candidates
    .filter((candidate) => catalogCandidateMatchesFilter(candidate, filter))
    .filter((candidate) => options.predicate?.(candidate) ?? true)
    .sort(options.compare)
    .slice(offset, offset + limit)
    .map((candidate) => candidate.productId);
  return getProductsByIds(selectedIds);
}

function compareReleaseDateOnlyDesc(left: SearchIndexItem, right: SearchIndexItem): number {
  return (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "");
}

function compareReleaseDateDesc(left: SearchIndexItem, right: SearchIndexItem): number {
  return compareReleaseDateOnlyDesc(left, right) || left.productId.localeCompare(right.productId);
}

function compareSaleCandidates(sortMode: SaleSortMode): (left: SearchIndexItem, right: SearchIndexItem) => number {
  if (sortMode === "discountAmount") {
    return (left, right) =>
      (right.discountAmount ?? 0) - (left.discountAmount ?? 0) ||
      (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
      compareReleaseDateDesc(left, right);
  }
  if (sortMode === "newest") {
    return (left, right) =>
      compareReleaseDateOnlyDesc(left, right) ||
      (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
      left.productId.localeCompare(right.productId);
  }
  return (left, right) =>
    (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
    (right.discountAmount ?? 0) - (left.discountAmount ?? 0) ||
    compareReleaseDateDesc(left, right);
}

async function getNewProductsLegacy(
  filter: ProductListFilter,
): Promise<Product[]> {
  const indexed = await getCatalogProductsPage(filter, { compare: compareReleaseDateDesc });
  if (indexed) return indexed;

  const db = getAdminDb();
  const needsPostFilter = shouldPostFilter(filter);
  let query = db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .orderBy("releaseDate", "desc");
  if (!needsPostFilter) query = query.offset(filter.offsetCount ?? 0);
  const snapshot = await query.limit(queryLimitForFilter(filter, filter.limitCount ?? 24)).get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
  return needsPostFilter ? postFilterProducts(products, filter) : products;
}

function getCardImageForComparison(product: ProductCardItem): string {
  return (
    product.cardImageUrl ||
    product.mainImageUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    product.images?.[0]?.thumbnailUrl ||
    "/no-image.svg"
  );
}

function toNewListComparable(product: ProductCardItem): Record<string, unknown> {
  const genres = (product.genres ?? []).slice(0, 8);
  const sourceGenreIds = product.genreIds ?? [];
  return {
    productId: product.productId,
    title: product.title,
    sellerId: product.seller?.sellerId,
    sellerName: product.seller?.sellerName,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    isDiscounted: product.isDiscounted,
    isOnSale: product.isOnSale,
    salesCount: product.salesCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    releaseDate: product.releaseDate,
    workType: product.workType,
    workTypeLabel: product.workTypeLabel,
    cardImageUrl: getCardImageForComparison(product),
    genres,
    genreIds: genres.map(
      (genre, index) => sourceGenreIds[index] || `dlsite:${genre}`,
    ),
    tags: (product.tags ?? []).slice(0, 8),
  };
}

async function getLegacyNewProductTotalCount(
  filter: ProductListFilter,
): Promise<number | undefined> {
  const candidates = await getSearchIndexCandidates(filter);
  if (!candidates) return undefined;
  return candidates.filter((candidate) =>
    catalogCandidateMatchesFilter(candidate, filter),
  ).length;
}

function logNewListComparison(
  filter: ProductListFilter,
  legacyProducts: Product[],
  legacyTotalCount: number | undefined,
  next: Awaited<ReturnType<typeof getNewListViewPage>>,
): void {
  if (!next) {
    console.warn("New-list compare skipped because the new view is unavailable", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      offsetCount: filter.offsetCount ?? 0,
      limitCount: filter.limitCount ?? 24,
    });
    return;
  }

  const legacyIds = legacyProducts.map((product) => product.productId);
  const nextIds = next.products.map((product) => product.productId);
  const idOrderMatches = JSON.stringify(legacyIds) === JSON.stringify(nextIds);
  const cardMismatches: Array<{ productId: string; legacy: unknown; next: unknown }> = [];
  for (let index = 0; index < Math.min(legacyProducts.length, next.products.length); index += 1) {
    const legacy = toNewListComparable(legacyProducts[index]);
    const current = toNewListComparable(next.products[index]);
    if (JSON.stringify(legacy) !== JSON.stringify(current)) {
      cardMismatches.push({
        productId: legacyProducts[index].productId,
        legacy,
        next: current,
      });
      if (cardMismatches.length >= 3) break;
    }
  }
  const totalCountMatches =
    legacyTotalCount === undefined || legacyTotalCount === next.totalCount;
  const matches = idOrderMatches && cardMismatches.length === 0 && totalCountMatches;
  const payload = {
    matches,
    segmentId: next.segmentId,
    listId: next.listId,
    versionId: next.versionId,
    usedPreviousVersion: next.usedPreviousVersion,
    firestoreReadEstimate: next.firestoreReadEstimate,
    blockIds: next.blockIds,
    offsetCount: filter.offsetCount ?? 0,
    limitCount: filter.limitCount ?? 24,
    legacyCount: legacyProducts.length,
    nextCount: next.products.length,
    legacyTotalCount,
    nextTotalCount: next.totalCount,
    idOrderMatches,
    firstLegacyIds: legacyIds.slice(0, 5),
    firstNextIds: nextIds.slice(0, 5),
    cardMismatches,
  };
  if (matches) {
    console.info("New-list compare matched", payload);
  } else {
    console.error("New-list compare mismatch", payload);
  }
}

export async function getNewProducts(
  filter: ProductListFilter,
): Promise<ProductCardItem[]> {
  const mode = getListViewMode();
  if (mode === "off") return getNewProductsLegacy(filter);

  if (mode === "compare") {
    const [legacyProducts, next] = await Promise.all([
      getNewProductsLegacy(filter),
      getNewListViewPage(filter).catch((error) => {
        console.error("Failed to read new-list view in compare mode", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }),
    ]);
    const legacyTotalCount = await getLegacyNewProductTotalCount(filter);
    logNewListComparison(filter, legacyProducts, legacyTotalCount, next);
    return legacyProducts;
  }

  const next = await getNewListViewPage(filter).catch((error) => {
    console.error("Failed to read new-list view", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });
  if (next) {
    if (process.env.LIST_VIEW_DEBUG === "true") {
      console.info("New-list view used", {
        mode,
        segmentId: next.segmentId,
        listId: next.listId,
        versionId: next.versionId,
        usedPreviousVersion: next.usedPreviousVersion,
        blockIds: next.blockIds,
        firestoreReadEstimate: next.firestoreReadEstimate,
        itemCount: next.products.length,
        totalCount: next.totalCount,
      });
    }
    return next.products;
  }

  if (mode === "prefer") {
    console.warn("New-list view unavailable; using the existing new-products path", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
    });
    return getNewProductsLegacy(filter);
  }

  console.error("New-list view is required but unavailable", {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    contentType: filter.contentType,
    workType: filter.workType,
  });
  return [];
}

async function getSaleProductsLegacy(
  filter: ProductListFilter & { sortMode?: SaleSortMode },
): Promise<Product[]> {
  const sortMode = filter.sortMode ?? "discountRate";
  const indexed = await getCatalogProductsPage(filter, {
    predicate: (candidate) =>
      Boolean(candidate.isDiscounted || (candidate.discountRate ?? 0) > 0),
    compare: compareSaleCandidates(sortMode),
  });
  if (indexed) return indexed;

  const db = getAdminDb();
  const needsPostFilter = shouldPostFilter(filter) || sortMode !== "discountRate";
  let query = db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where("isDiscounted", "==", true)
    .orderBy("discountRate", "desc");
  if (!needsPostFilter) query = query.offset(filter.offsetCount ?? 0);
  const fallbackLimit = queryLimitForFilter(
    filter,
    Math.max(
      ((filter.offsetCount ?? 0) + (filter.limitCount ?? 24)) * 8,
      300,
    ),
  );
  if (sortMode !== "discountRate") {
    console.warn("Sale catalog fallback is using a bounded candidate query", {
      sortMode,
      fallbackLimit,
    });
  }
  const snapshot = await query
    .limit(
      sortMode === "discountRate"
        ? queryLimitForFilter(filter, filter.limitCount ?? 24)
        : fallbackLimit,
    )
    .get();
  let products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
  if (needsPostFilter) {
    products = products.filter((product) =>
      matchesProductListFilter(product, filter),
    );
  }
  products.sort((left, right) =>
    compareSaleCandidates(sortMode)(
      {
        productId: left.productId,
        releaseDate: left.releaseDate,
        discountRate: left.discountRate,
        discountAmount: Math.max(
          0,
          (left.priceOriginal ?? 0) - (left.priceCurrent ?? 0),
        ),
      },
      {
        productId: right.productId,
        releaseDate: right.releaseDate,
        discountRate: right.discountRate,
        discountAmount: Math.max(
          0,
          (right.priceOriginal ?? 0) - (right.priceCurrent ?? 0),
        ),
      },
    ),
  );
  return needsPostFilter
    ? products.slice(
        filter.offsetCount ?? 0,
        (filter.offsetCount ?? 0) + (filter.limitCount ?? 24),
      )
    : products;
}

async function getLegacySaleProductTotalCount(
  filter: ProductListFilter,
): Promise<number | undefined> {
  const candidates = await getSearchIndexCandidates(filter);
  if (!candidates) return undefined;
  return candidates
    .filter((candidate) => catalogCandidateMatchesFilter(candidate, filter))
    .filter((candidate) =>
      Boolean(candidate.isDiscounted || (candidate.discountRate ?? 0) > 0),
    ).length;
}

function logSaleListComparison(
  filter: ProductListFilter,
  sortMode: SaleSortMode,
  legacyProducts: Product[],
  legacyTotalCount: number | undefined,
  next: Awaited<ReturnType<typeof getSaleListViewPage>>,
): void {
  if (!next) {
    console.warn("Sale-list compare skipped because the new view is unavailable", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      discountRateMin: filter.discountRateMin,
      sortMode,
      offsetCount: filter.offsetCount ?? 0,
      limitCount: filter.limitCount ?? 24,
    });
    return;
  }

  const legacyIds = legacyProducts.map((product) => product.productId);
  const nextIds = next.products.map((product) => product.productId);
  const idOrderMatches = JSON.stringify(legacyIds) === JSON.stringify(nextIds);
  const cardMismatches: Array<{
    productId: string;
    legacy: unknown;
    next: unknown;
  }> = [];
  for (
    let index = 0;
    index < Math.min(legacyProducts.length, next.products.length);
    index += 1
  ) {
    const legacy = toNewListComparable(legacyProducts[index]);
    const current = toNewListComparable(next.products[index]);
    if (JSON.stringify(legacy) !== JSON.stringify(current)) {
      cardMismatches.push({
        productId: legacyProducts[index].productId,
        legacy,
        next: current,
      });
      if (cardMismatches.length >= 3) break;
    }
  }
  const totalCountMatches =
    legacyTotalCount === undefined || legacyTotalCount === next.totalCount;
  const matches =
    idOrderMatches && cardMismatches.length === 0 && totalCountMatches;
  const payload = {
    matches,
    segmentId: next.segmentId,
    listId: next.listId,
    versionId: next.versionId,
    sourceSearchVersionId: next.sourceSearchVersionId,
    usedPreviousVersion: next.usedPreviousVersion,
    firestoreReadEstimate: next.firestoreReadEstimate,
    blockIds: next.blockIds,
    discountRateMin: filter.discountRateMin,
    sortMode,
    offsetCount: filter.offsetCount ?? 0,
    limitCount: filter.limitCount ?? 24,
    legacyCount: legacyProducts.length,
    nextCount: next.products.length,
    legacyTotalCount,
    nextTotalCount: next.totalCount,
    idOrderMatches,
    firstLegacyIds: legacyIds.slice(0, 5),
    firstNextIds: nextIds.slice(0, 5),
    cardMismatches,
  };
  if (matches) {
    console.info("Sale-list compare matched", payload);
  } else {
    console.error("Sale-list compare mismatch", payload);
  }
}

export async function getSaleProducts(
  filter: ProductListFilter & { sortMode?: SaleSortMode },
): Promise<ProductCardItem[]> {
  const sortMode = filter.sortMode ?? "discountRate";
  const mode = getListViewMode();
  if (mode === "off") return getSaleProductsLegacy(filter);

  if (mode === "compare") {
    const [legacyProducts, next] = await Promise.all([
      getSaleProductsLegacy(filter),
      getSaleListViewPage(filter, sortMode).catch((error) => {
        console.error("Failed to read sale-list view in compare mode", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }),
    ]);
    const legacyTotalCount = await getLegacySaleProductTotalCount(filter);
    logSaleListComparison(
      filter,
      sortMode,
      legacyProducts,
      legacyTotalCount,
      next,
    );
    return legacyProducts;
  }

  const next = await getSaleListViewPage(filter, sortMode).catch((error) => {
    console.error("Failed to read sale-list view", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });
  if (next) {
    if (process.env.LIST_VIEW_DEBUG === "true") {
      console.info("Sale-list view used", {
        mode,
        segmentId: next.segmentId,
        listId: next.listId,
        versionId: next.versionId,
        sourceSearchVersionId: next.sourceSearchVersionId,
        usedPreviousVersion: next.usedPreviousVersion,
        blockIds: next.blockIds,
        firestoreReadEstimate: next.firestoreReadEstimate,
        discountRateMin: filter.discountRateMin,
        sortMode,
        itemCount: next.products.length,
        totalCount: next.totalCount,
      });
    }
    return next.products;
  }

  if (mode === "prefer") {
    console.warn("Sale-list view unavailable; using the existing sale-products path", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      discountRateMin: filter.discountRateMin,
      sortMode,
    });
    return getSaleProductsLegacy(filter);
  }

  console.error("Sale-list view is required but unavailable", {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    contentType: filter.contentType,
    workType: filter.workType,
    discountRateMin: filter.discountRateMin,
    sortMode,
  });
  return [];
}

export async function getHomeRandomNewProducts(
  filter: ProductListFilter & { candidateLimit?: number; topSalesLimit?: number },
): Promise<Product[]> {
  const db = getAdminDb();
  const candidateLimit = filter.candidateLimit ?? 300;

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .orderBy("releaseDate", "desc")
    .limit(queryLimitForFilter(filter, candidateLimit))
    .get();

  const products = snapshot.docs
    .map((doc) => toProduct(doc.id, doc.data()))
    .filter((product) => matchesProductListFilter(product, filter));

  return pickRandomTopSalesProducts(products, filter, filter.topSalesLimit ?? 30);
}


export async function getHomeRandomRecentAddedProducts(
  filter: ProductListFilter & { lookbackDays?: number; candidateLimit?: number; topSalesLimit?: number },
): Promise<Product[]> {
  const db = getAdminDb();
  const lookbackDays = Math.max(filter.lookbackDays ?? 3, 1);
  const sinceDate = toJstIsoDate(addDays(new Date(), -(lookbackDays - 1)));
  const candidateLimit = filter.candidateLimit ?? 300;

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where("releaseDate", ">=", sinceDate)
    .orderBy("releaseDate", "desc")
    .limit(queryLimitForFilter(filter, candidateLimit))
    .get();

  const products = snapshot.docs
    .map((doc) => toProduct(doc.id, doc.data()))
    .filter((product) => matchesProductListFilter(product, filter));

  return pickRandomTopSalesProducts(products, filter, filter.topSalesLimit ?? 30).slice(0, filter.limitCount ?? 5);
}

export async function getHomeRandomSaleProducts(
  filter: ProductListFilter & { candidateLimit?: number; topSalesLimit?: number },
): Promise<Product[]> {
  const db = getAdminDb();
  const candidateLimit = filter.candidateLimit ?? 300;

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where("isDiscounted", "==", true)
    .orderBy("releaseDate", "desc")
    .limit(queryLimitForFilter(filter, candidateLimit))
    .get();

  const products = snapshot.docs
    .map((doc) => toProduct(doc.id, doc.data()))
    .filter((product) => matchesProductListFilter(product, filter));

  return pickRandomTopSalesProducts(products, filter, filter.topSalesLimit ?? 30);
}

export async function getProductsByGenre(
  filter: ProductListFilter & { genreId: string },
): Promise<Product[]> {
  const db = getAdminDb();
  const needsPostFilter = shouldPostFilter(filter);

  let query = db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where("genreIds", "array-contains", filter.genreId)
    .orderBy("salesCount", "desc");

  if (!needsPostFilter) {
    query = query.offset(filter.offsetCount ?? 0);
  }

  const snapshot = await query.limit(queryLimitForFilter(filter, filter.limitCount ?? 24)).get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));

  return needsPostFilter ? postFilterProducts(products, filter) : products;
}

type SellerProductFilter = ProductListFilter & { maxProducts?: number };

type SellerFieldName = "seller.sellerId" | "seller.sellerName";

async function getProductsBySellerField(
  fieldName: SellerFieldName,
  fieldValue: string,
  filter: SellerProductFilter,
  maxProducts?: number,
): Promise<Product[]> {
  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = getAdminDb()
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where(fieldName, "==", fieldValue);

  if (maxProducts) {
    query = query.limit(maxProducts);
  }

  const snapshot = await query.get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
  return shouldPostFilter(filter) ? products.filter((product) => matchesProductListFilter(product, filter)) : products;
}

async function getProductsBySellerKey(filter: SellerProductFilter & { sellerKey: string }): Promise<Product[]> {
  const sellerKey = decodeURIComponent(filter.sellerKey).trim();
  if (!sellerKey) return [];

  const maxProducts = filter.maxProducts;
  const [bySellerId, bySellerName] = await Promise.all([
    getProductsBySellerField("seller.sellerId", sellerKey, filter, maxProducts),
    getProductsBySellerField("seller.sellerName", sellerKey, filter, maxProducts),
  ]);

  const productById = new Map<string, Product>();
  for (const product of [...bySellerId, ...bySellerName]) {
    productById.set(product.productId, product);
  }

  return sortProductsBySales([...productById.values()]);
}

export async function getProductsBySameSeller(
  filter: ProductListFilter & { sellerId?: string; sellerName?: string; excludeProductId?: string },
): Promise<Product[]> {
  const sellerId = filter.sellerId?.trim();
  const sellerName = filter.sellerName?.trim();

  if (!sellerId && !sellerName) {
    return [];
  }

  const products = sellerId
    ? await getProductsBySellerField("seller.sellerId", sellerId, filter)
    : await getProductsBySellerField("seller.sellerName", sellerName ?? "", filter);

  const relatedProducts = [...products]
    .filter((product) => product.productId !== filter.excludeProductId)
    .sort((a, b) => {
      const releaseDateDiff = compareDateDesc(a.releaseDate, b.releaseDate);
      if (releaseDateDiff !== 0) return releaseDateDiff;

      return (b.salesCount ?? 0) - (a.salesCount ?? 0);
    });

  return filter.limitCount ? relatedProducts.slice(0, filter.limitCount) : relatedProducts;
}

export async function getProductById(
  productId: string,
): Promise<Product | null> {
  const db = getAdminDb();

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .doc(productId)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return toProduct(snapshot.id, snapshot.data() ?? {});
}


function isoDateToKey(value: string): string | undefined {
  const normalized = normalizeMetricDate(value);
  return normalized?.replace(/-/g, "");
}


const TREND_QUERY_CACHE_TTL_MS = 5 * 60 * 1000;

type TrendQueryCacheEntry = {
  expiresAt: number;
  points: ProductTrendPoint[];
};

const productTrendQueryCache = new Map<string, TrendQueryCacheEntry>();
const sellerTrendQueryCache = new Map<string, TrendQueryCacheEntry>();

function getCachedTrendPoints(cache: Map<string, TrendQueryCacheEntry>, key: string): ProductTrendPoint[] | undefined {
  const cached = cache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return cached.points;
}

function setCachedTrendPoints(
  cache: Map<string, TrendQueryCacheEntry>,
  key: string,
  points: ProductTrendPoint[],
): ProductTrendPoint[] {
  cache.set(key, {
    expiresAt: Date.now() + TREND_QUERY_CACHE_TTL_MS,
    points,
  });
  return points;
}

function isoDateToUtcMs(value: string): number | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMs = Date.UTC(year, month - 1, day);
  const parsed = new Date(utcMs);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  return utcMs;
}

function isNextCalendarDay(previousDate: string, currentDate: string): boolean {
  const previousUtcMs = isoDateToUtcMs(previousDate);
  const currentUtcMs = isoDateToUtcMs(currentDate);
  return previousUtcMs !== undefined && currentUtcMs !== undefined && currentUtcMs - previousUtcMs === 86_400_000;
}

function trendStartIsoDate(days: number): string {
  return toJstIsoDate(addDays(new Date(), -(Math.max(days, 1) - 1)));
}

export function getProductTrendPointsFromSnapshots(product: Product, days = 35): ProductTrendPoint[] {
  const snapshots = [...(product.recentSalesSnapshots ?? [])]
    .flatMap((snapshot) => {
      const date = normalizeMetricDate(snapshot.date);
      if (!date || !isFiniteNumber(snapshot.salesCount)) return [];
      return [{
        date,
        salesCount: snapshot.salesCount,
        price: isFiniteNumber(snapshot.priceCurrent)
          ? snapshot.priceCurrent
          : product.priceCurrent ?? product.priceOriginal ?? 0,
      }];
    })
    .sort((left, right) => left.date.localeCompare(right.date));

  const pointsByDate = new Map<string, ProductTrendPoint>();
  for (let index = 1; index < snapshots.length; index += 1) {
    const previous = snapshots[index - 1];
    const current = snapshots[index];
    if (!previous || !current || !isNextCalendarDay(previous.date, current.date)) continue;
    const sales = current.salesCount - previous.salesCount;
    if (sales < 0 || !isFiniteNumber(current.price)) continue;
    pointsByDate.set(current.date, {
      date: current.date,
      sales,
      revenue: sales * current.price,
      price: current.price,
    });
  }

  const rankingMetrics = product.rankingMetrics;
  const rankingDate = normalizeMetricDate(rankingMetrics?.sourceDate);
  if (
    rankingDate &&
    rankingMetrics?.dailyAvailable &&
    isFiniteNumber(rankingMetrics.dailySalesCount) &&
    rankingMetrics.dailySalesCount >= 0
  ) {
    const price = isFiniteNumber(rankingMetrics.priceCurrent)
      ? rankingMetrics.priceCurrent
      : product.priceCurrent ?? product.priceOriginal ?? 0;
    if (isFiniteNumber(price)) {
      pointsByDate.set(rankingDate, {
        date: rankingDate,
        sales: rankingMetrics.dailySalesCount,
        revenue: rankingMetrics.dailySalesCount * price,
        price,
      });
    }
  }

  const startDate = trendStartIsoDate(days);
  return [...pointsByDate.values()]
    .filter((point) => point.date >= startDate)
    .sort((left, right) => left.date.localeCompare(right.date));
}

export function getAggregateTrendPointsFromProductSnapshots(
  products: Product[],
  days = 35,
): ProductTrendPoint[] {
  const trendByDate = new Map<string, { sales: number; revenue: number; priceSum: number; priceCount: number }>();

  for (const product of products) {
    for (const point of getProductTrendPointsFromSnapshots(product, days)) {
      const current = trendByDate.get(point.date) ?? { sales: 0, revenue: 0, priceSum: 0, priceCount: 0 };
      current.sales += point.sales;
      current.revenue += point.revenue;
      current.priceSum += point.price;
      current.priceCount += 1;
      trendByDate.set(point.date, current);
    }
  }

  return [...trendByDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      date,
      sales: value.sales,
      revenue: value.revenue,
      price: value.sales > 0
        ? Math.round(value.revenue / value.sales)
        : Math.round(value.priceSum / Math.max(value.priceCount, 1)),
    }));
}

export async function getProductTrendPoints(productId: string, days = 365): Promise<ProductTrendPoint[]> {
  const normalizedDays = Math.max(1, Math.min(365, Math.floor(days)));
  const cacheKey = `${productId}:${normalizedDays}`;
  const cached = getCachedTrendPoints(productTrendQueryCache, cacheKey);
  if (cached) return cached;

  const startDateKey = toJstDateKey(addDays(new Date(), -(normalizedDays - 1)));
  const snapshot = await getAdminDb()
    .collection(PRODUCTS_COLLECTION)
    .doc(productId)
    .collection("dailyMetrics")
    .where("date", ">=", startDateKey)
    .orderBy("date", "asc")
    .get();

  const points = snapshot.docs.flatMap((doc) => {
    const metric = doc.data() as ProductDailyMetric;
    const date = normalizeMetricDate(metric.date || doc.id);
    const sales = getMetricSalesCount(metric);
    const price = metric.priceCurrent ?? metric.priceOriginal ?? 0;

    if (!date || sales === undefined || !isFiniteNumber(price)) {
      return [];
    }

    return [{
      date,
      sales,
      revenue: sales * price,
      price,
    } satisfies ProductTrendPoint];
  });
  return setCachedTrendPoints(productTrendQueryCache, cacheKey, points);
}

export async function getAggregateTrendPointsForProducts(products: Product[], days = 365): Promise<ProductTrendPoint[]> {
  if (products.length === 0) return [];

  const startDateKey = toJstDateKey(addDays(new Date(), -(Math.max(days, 1) - 1)));
  const trendByDate = new Map<string, { sales: number; revenue: number; priceSum: number; priceCount: number }>();

  for (let index = 0; index < products.length; index += 20) {
    const chunk = products.slice(index, index + 20);

    await Promise.all(
      chunk.map(async (product) => {
        const snapshot = await getAdminDb()
          .collection(PRODUCTS_COLLECTION)
          .doc(product.productId)
          .collection("dailyMetrics")
          .where("date", ">=", startDateKey)
          .orderBy("date", "asc")
          .get();

        for (const doc of snapshot.docs) {
          const metric = doc.data() as ProductDailyMetric;
          const date = normalizeMetricDate(metric.date || doc.id);
          const sales = getMetricSalesCount(metric);
          const price = metric.priceCurrent ?? metric.priceOriginal ?? product.priceCurrent ?? product.priceOriginal ?? 0;

          if (!date || sales === undefined || !isFiniteNumber(price)) continue;

          const current = trendByDate.get(date) ?? { sales: 0, revenue: 0, priceSum: 0, priceCount: 0 };
          current.sales += sales;
          current.revenue += sales * price;
          current.priceSum += price;
          current.priceCount += 1;
          trendByDate.set(date, current);
        }
      }),
    );
  }

  return Array.from(trendByDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      sales: value.sales,
      revenue: value.revenue,
      price: value.sales > 0
        ? Math.round(value.revenue / value.sales)
        : Math.round(value.priceSum / Math.max(value.priceCount, 1)),
    } satisfies ProductTrendPoint));
}


export async function getSellerTrendPoints(
  filter: ProductListFilter & { sellerKey: string },
  days = 365,
): Promise<ProductTrendPoint[]> {
  const normalizedDays = Math.max(1, Math.min(365, Math.floor(days)));
  const cacheKey = [
    filter.platform,
    filter.audience,
    filter.category,
    filter.contentType ?? "all",
    filter.sellerKey.trim(),
    normalizedDays,
  ].join(":");
  const cached = getCachedTrendPoints(sellerTrendQueryCache, cacheKey);
  if (cached) return cached;

  const summary = await getSellerSummaryByKey(filter);
  if (!summary?.products?.length) {
    return setCachedTrendPoints(sellerTrendQueryCache, cacheKey, []);
  }
  const points = await getAggregateTrendPointsForProducts(summary.products, normalizedDays);
  return setCachedTrendPoints(sellerTrendQueryCache, cacheKey, points);
}

export function hasRecentProductTrendData(points: ProductTrendPoint[], lookbackDays = 3): boolean {
  const sinceDateKey = toJstDateKey(addDays(new Date(), -(Math.max(lookbackDays, 1) - 1)));

  return points.some((point) => {
    const dateKey = isoDateToKey(point.date);
    return Boolean(dateKey && dateKey >= sinceDateKey && isFiniteNumber(point.sales));
  });
}

async function getProductsByIds(productIds: string[]): Promise<Product[]> {
  if (productIds.length === 0) {
    return [];
  }

  const db = getAdminDb();
  const products: Product[] = [];

  for (let i = 0; i < productIds.length; i += 30) {
    const chunk = productIds.slice(i, i + 30);

    const snapshot = await db
      .collection(PRODUCTS_COLLECTION)
      .where(FieldPath.documentId(), "in", chunk)
      .get();

    products.push(...snapshot.docs.map((doc) => toProduct(doc.id, doc.data())));
  }

  const order = new Map(productIds.map((id, index) => [id, index]));

  return products.sort(
    (a, b) =>
      (order.get(a.productId) ?? 9999) -
      (order.get(b.productId) ?? 9999),
  );
}

export async function getLatestRankingProducts(
  filter: ProductListFilter & {
    rankingType?: RankingType;
    rankingMode?: ProductRankingMode;
    useRankingIndex?: boolean;
    excludeFreeProducts?: boolean;
  },
): Promise<Product[]> {
  const db = getAdminDb();
  const rankingMode = filter.rankingMode ?? "dailyRevenue";
  const excludeFreeProducts = filter.excludeFreeProducts !== false;
  const keepEligiblePrice = (product: Product) =>
    !excludeFreeProducts || (product.priceCurrent ?? 0) > 0;
  const indexedRanking = filter.useRankingIndex === false
    ? undefined
    : await getRankingIndexEntries(filter, rankingMode);

  if (!indexedRanking && filter.useRankingIndex !== false) {
    console.warn("Ranking index unavailable; using legacy ranking fallback", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      rankingMode,
    });
  }

  if (indexedRanking) {
    const offset = filter.offsetCount ?? 0;
    const limit = filter.limitCount ?? 50;
    const selectedEntries = indexedRanking.entries.slice(offset, offset + limit);
    if (selectedEntries.length === 0) return [];

    const products = await getProductsByIds(
      selectedEntries.map((entry) => entry.productId),
    );
    const entriesByProductId = new Map(
      selectedEntries.map((entry) => [entry.productId, entry]),
    );

    return products
      .filter(keepEligiblePrice)
      .filter((product) => matchesProductListFilter(product, filter))
      .map((product) => {
        const entry = entriesByProductId.get(product.productId);
        if (!entry) return product;
        return {
          ...product,
          rankingMetric: {
            mode: rankingMode,
            sourceDate: indexedRanking.sourceDate,
            salesCount: entry.salesCount,
            revenue: entry.revenue,
            rankingValue: entry.rankingValue,
            priceCurrent: entry.priceCurrent,
          },
        };
      });
  }

  const rankingType = filter.rankingType ?? rankingTypeForMode(rankingMode);
  if (!rankingType) {
    return (await getPopularProducts(filter)).filter(keepEligiblePrice);
  }

  const rankingSnapshots = await getLatestRankingSnapshots(filter, rankingType);

  if (rankingSnapshots.length === 0) {
    const fallback = rankingMode === "dailyRevenue"
      ? await getEstimatedRevenueProducts(filter)
      : await getPopularProducts(filter);
    return fallback.filter(keepEligiblePrice);
  }

  const rankingReadLimit = Math.max(
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 50) * 8,
    300,
  );

  const itemSnapshots = await Promise.all(
    rankingSnapshots.map((rankingSnapshot) => {
      const itemLimit = Math.min(
        rankingReadLimit,
        Math.max(rankingSnapshot.itemCount, 1),
      );
      return db
        .collection(RANKING_SNAPSHOTS_COLLECTION)
        .doc(rankingSnapshot.snapshotId)
        .collection("items")
        .orderBy("rank", "asc")
        .limit(itemLimit)
        .get();
    }),
  );
  const productIds = [
    ...new Set(
      itemSnapshots.flatMap((itemDocs) =>
        itemDocs.docs.map((doc) => (doc.data() as RankingSnapshotItem).productId),
      ),
    ),
  ];

  if (productIds.length === 0) {
    const fallback = rankingMode === "dailyRevenue"
      ? await getEstimatedRevenueProducts(filter)
      : await getPopularProducts(filter);
    return fallback.filter(keepEligiblePrice);
  }

  const products = (await getProductsByIds(productIds)).filter(keepEligiblePrice);
  const rankedProducts = rankingMode === "dailyRevenue"
    ? sortProductsByEstimatedRevenue(products)
    : sortProductsBySales(products);

  return postFilterProducts(rankedProducts, filter);
}


async function getLegacyRankingTotalCount(
  filter: ProductListFilter,
  rankingMode: ProductRankingMode,
): Promise<number | undefined> {
  const indexed = await getRankingIndexEntries(filter, rankingMode);
  return indexed?.entries.length;
}

function toRankingListComparable(product: ProductCardItem): Record<string, unknown> {
  return {
    ...toNewListComparable(product),
    rankingMetric: product.rankingMetric
      ? {
          mode: product.rankingMetric.mode,
          sourceDate: product.rankingMetric.sourceDate,
          salesCount: product.rankingMetric.salesCount,
          revenue: product.rankingMetric.revenue,
          rankingValue: product.rankingMetric.rankingValue,
          priceCurrent: product.rankingMetric.priceCurrent,
        }
      : undefined,
  };
}

function logRankingListComparison(
  filter: ProductListFilter,
  rankingMode: ProductRankingMode,
  legacyProducts: Product[],
  legacyTotalCount: number | undefined,
  next: Awaited<ReturnType<typeof getRankingListViewPage>>,
): void {
  if (!next) {
    console.warn("Ranking-list compare skipped because the new view is unavailable", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      rankingMode,
      offsetCount: filter.offsetCount ?? 0,
      limitCount: filter.limitCount ?? 50,
    });
    return;
  }

  const legacyIds = legacyProducts.map((product) => product.productId);
  const nextIds = next.products.map((product) => product.productId);
  const idOrderMatches = JSON.stringify(legacyIds) === JSON.stringify(nextIds);
  const cardMismatches: Array<{ productId: string; legacy: unknown; next: unknown }> = [];
  for (let index = 0; index < Math.min(legacyProducts.length, next.products.length); index += 1) {
    const legacy = toRankingListComparable(legacyProducts[index]);
    const current = toRankingListComparable(next.products[index]);
    if (JSON.stringify(legacy) !== JSON.stringify(current)) {
      cardMismatches.push({
        productId: legacyProducts[index].productId,
        legacy,
        next: current,
      });
      if (cardMismatches.length >= 3) break;
    }
  }

  const totalCountMatches =
    legacyTotalCount === undefined || legacyTotalCount === next.totalCount;
  const matches = idOrderMatches && cardMismatches.length === 0 && totalCountMatches;
  const payload = {
    matches,
    segmentId: next.segmentId,
    listId: next.listId,
    versionId: next.versionId,
    sourceRankingVersionId: next.sourceRankingVersionId,
    sourceDate: next.sourceDate,
    usedPreviousVersion: next.usedPreviousVersion,
    firestoreReadEstimate: next.firestoreReadEstimate,
    blockIds: next.blockIds,
    rankingMode,
    offsetCount: filter.offsetCount ?? 0,
    limitCount: filter.limitCount ?? 50,
    legacyCount: legacyProducts.length,
    nextCount: next.products.length,
    legacyTotalCount,
    nextTotalCount: next.totalCount,
    idOrderMatches,
    firstLegacyIds: legacyIds.slice(0, 5),
    firstNextIds: nextIds.slice(0, 5),
    cardMismatches,
  };
  if (matches) {
    console.info("Ranking-list compare matched", payload);
  } else {
    console.error("Ranking-list compare mismatch", payload);
  }
}

export async function getRankingPageProducts(
  filter: ProductListFilter & {
    rankingType?: RankingType;
    rankingMode?: ProductRankingMode;
    excludeFreeProducts?: boolean;
  },
): Promise<ProductCardItem[]> {
  const mode = getListViewMode();
  const rankingMode = filter.rankingMode ?? "dailyRevenue";
  if (mode === "off") return getLatestRankingProducts(filter);

  if (mode === "compare") {
    const [legacyProducts, next] = await Promise.all([
      getLatestRankingProducts(filter),
      getRankingListViewPage(filter, rankingMode).catch((error) => {
        console.error("Failed to read ranking-list view in compare mode", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }),
    ]);
    const legacyTotalCount = await getLegacyRankingTotalCount(filter, rankingMode);
    logRankingListComparison(
      filter,
      rankingMode,
      legacyProducts,
      legacyTotalCount,
      next,
    );
    return legacyProducts;
  }

  const next = await getRankingListViewPage(filter, rankingMode).catch((error) => {
    console.error("Failed to read ranking-list view", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });
  if (next) {
    if (process.env.LIST_VIEW_DEBUG === "true") {
      console.info("Ranking-list view used", {
        mode,
        segmentId: next.segmentId,
        listId: next.listId,
        versionId: next.versionId,
        sourceRankingVersionId: next.sourceRankingVersionId,
        sourceDate: next.sourceDate,
        usedPreviousVersion: next.usedPreviousVersion,
        blockIds: next.blockIds,
        firestoreReadEstimate: next.firestoreReadEstimate,
        itemCount: next.products.length,
        totalCount: next.totalCount,
      });
    }
    return next.products;
  }

  if (mode === "prefer") {
    console.warn("Ranking-list view unavailable; using the existing ranking path", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      rankingMode,
    });
    return getLatestRankingProducts(filter);
  }

  console.error("Ranking-list view is required but unavailable", {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    contentType: filter.contentType,
    workType: filter.workType,
    rankingMode,
  });
  return [];
}


type WeeklyProductCandidate = {
  product: Product;
  weeklySalesCount: number;
};

async function getLatestRankingProductsByRank(
  filter: ProductListFilter & { rankingType: RankingType; readLimit?: number },
): Promise<Product[]> {
  const db = getAdminDb();
  const rankingSnapshots = await getLatestRankingSnapshots(filter, filter.rankingType);

  if (rankingSnapshots.length === 0) {
    return [];
  }

  const itemSnapshots = await Promise.all(
    rankingSnapshots.map((rankingSnapshot) => {
      const itemLimit = Math.min(
        filter.readLimit ?? 120,
        Math.max(rankingSnapshot.itemCount, 1),
      );
      return db
        .collection(RANKING_SNAPSHOTS_COLLECTION)
        .doc(rankingSnapshot.snapshotId)
        .collection("items")
        .orderBy("rank", "asc")
        .limit(itemLimit)
        .get();
    }),
  );
  const productIds = [
    ...new Set(
      itemSnapshots.flatMap((itemDocs) =>
        itemDocs.docs.map((doc) => (doc.data() as RankingSnapshotItem).productId),
      ),
    ),
  ];
  const products = await getProductsByIds(productIds);

  return products.filter((product) => matchesProductListFilter(product, filter));
}

function getMetricSalesCount(metric: ProductDailyMetric): number | undefined {
  if (isFiniteNumber(metric.dailySalesCount)) return Math.max(metric.dailySalesCount, 0);
  if (isFiniteNumber(metric.periodSalesCount)) return Math.max(metric.periodSalesCount, 0);
  return undefined;
}

async function getRecentSalesCount(productId: string, startDateKey: string): Promise<number> {
  const snapshot = await getAdminDb()
    .collection(PRODUCTS_COLLECTION)
    .doc(productId)
    .collection("dailyMetrics")
    .where("date", ">=", startDateKey)
    .get();

  return snapshot.docs.reduce((sum, doc) => {
    const sales = getMetricSalesCount(doc.data() as ProductDailyMetric);
    return sum + (sales ?? 0);
  }, 0);
}

function buildWeeklySellerSummaries(candidates: WeeklyProductCandidate[]): SellerSummary[] {
  const groups = new Map<string, WeeklyProductCandidate[]>();

  for (const candidate of candidates) {
    const key = getSellerKey(candidate.product);
    if (!key) continue;
    const current = groups.get(key) ?? [];
    current.push(candidate);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([sellerKey, sellerProducts]) => {
    const sortedByWeeklySales = [...sellerProducts].sort((a, b) => b.weeklySalesCount - a.weeklySalesCount);
    const sortedByRelease = [...sellerProducts].sort((a, b) => compareDateDesc(a.product.releaseDate, b.product.releaseDate));
    const topProduct = sortedByWeeklySales[0]?.product;
    const latestProduct = sortedByRelease[0]?.product ?? topProduct;
    const totalSalesCount = sellerProducts.reduce((sum, item) => sum + item.weeklySalesCount, 0);
    const estimatedRevenue = sellerProducts.reduce(
      (sum, item) => sum + item.weeklySalesCount * (item.product.priceCurrent ?? 0),
      0,
    );
    const tagCount = new Map<string, number>();

    for (const item of sellerProducts) {
      for (const tag of (item.product.genres ?? []).filter(Boolean)) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
    }

    const tags = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
      .slice(0, 18)
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
      firstReleaseDate: [...sellerProducts]
        .sort((a, b) => (a.product.releaseDate ?? "").localeCompare(b.product.releaseDate ?? ""))[0]
        ?.product.releaseDate,
      latestReleaseDate: latestProduct?.releaseDate,
      newestProductTitle: latestProduct?.title,
      topProduct,
      latestProduct,
      products: sortedByWeeklySales.map((item) => item.product),
      tags,
    } satisfies SellerSummary;
  });
}

function selectRandomWeeklyCircleHighlights(
  topCandidates: WeeklyProductCandidate[],
  limitCount: number,
): SellerSummary[] {
  const randomizedKeys = new Set<string>();

  for (const product of shuffleProducts(topCandidates.map((item) => item.product))) {
    const key = getSellerKey(product);
    if (!key || randomizedKeys.has(key)) continue;
    randomizedKeys.add(key);
    if (randomizedKeys.size >= limitCount) break;
  }

  const keyOrder = new Map([...randomizedKeys].map((key, index) => [key, index]));

  return buildWeeklySellerSummaries(
    topCandidates.filter((candidate) => {
      const key = getSellerKey(candidate.product);
      return key ? randomizedKeys.has(key) : false;
    }),
  ).sort((a, b) => (keyOrder.get(a.sellerKey) ?? 9999) - (keyOrder.get(b.sellerKey) ?? 9999));
}

export async function getHomeRandomWeeklyCircleHighlights(
  filter: ProductListFilter & { limitCount?: number; rankingReadLimit?: number; topCircleLimit?: number; lookbackDays?: number },
): Promise<SellerSummary[]> {
  const lookbackDays = Math.max(filter.lookbackDays ?? 7, 1);
  const startDateKey = toJstDateKey(addDays(new Date(), -(lookbackDays - 1)));
  const weeklyRankingProducts = await getLatestRankingProductsByRank({
    ...filter,
    rankingType: "weekly",
    readLimit: filter.rankingReadLimit ?? 120,
  });

  if (weeklyRankingProducts.length === 0) {
    return [];
  }

  const candidates = await Promise.all(
    weeklyRankingProducts.map(async (product) => ({
      product,
      weeklySalesCount: await getRecentSalesCount(product.productId, startDateKey),
    })),
  );
  const topCandidates = candidates
    .filter((candidate) => getSellerKey(candidate.product))
    .sort((a, b) => b.weeklySalesCount - a.weeklySalesCount)
    .slice(0, filter.topCircleLimit ?? 30);
  return selectRandomWeeklyCircleHighlights(topCandidates, filter.limitCount ?? 10);
}



function buildGenreId(label: string, product: Product, index: number): string {
  const existing = product.genreIds?.[index];
  if (existing) return existing;
  return `dlsite:${label}`;
}

function sortGenreRankingItems(
  items: GenreRankingItem[],
  rankingMode: ProductRankingMode,
  sortMode: GenreSortMode = "sales",
): GenreRankingItem[] {
  return [...items]
    .sort((a, b) => {
      if (sortMode === "productCount") {
        const countDiff = b.productCount - a.productCount;
        if (countDiff !== 0) return countDiff;
      } else if (sortMode === "revenue") {
        const revenueDiff = b.estimatedRevenue - a.estimatedRevenue;
        if (revenueDiff !== 0) return revenueDiff;
      } else {
        const salesDiff = b.totalSalesCount - a.totalSalesCount;
        if (salesDiff !== 0) return salesDiff;
      }

      const salesDiff = b.totalSalesCount - a.totalSalesCount;
      if (salesDiff !== 0) return salesDiff;
      const revenueDiff = b.estimatedRevenue - a.estimatedRevenue;
      if (revenueDiff !== 0) return revenueDiff;
      const countDiff = b.productCount - a.productCount;
      if (countDiff !== 0) return countDiff;
      return a.name.localeCompare(b.name, "ja");
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildGenreRankingItems(products: Product[], rankingMode: ProductRankingMode, sortMode: GenreSortMode): GenreRankingItem[] {
  const groups = new Map<string, GenreRankingItem>();
  for (const product of products) {
    const genres = (product.genres ?? []).filter(Boolean);
    genres.forEach((name, index) => {
      const genreId = buildGenreId(name, product, index);
      const key = genreId || name;
      const current = groups.get(key) ?? {
        rank: 0,
        name,
        genreId,
        productCount: 0,
        totalSalesCount: 0,
        estimatedRevenue: 0,
        topProducts: [],
      } satisfies GenreRankingItem;
      current.productCount += 1;
      current.totalSalesCount += product.salesCount ?? 0;
      current.estimatedRevenue += getEstimatedRevenueValue(product);
      current.topProducts = sortProductsBySales([...(current.topProducts as Product[]), product]).slice(0, 3);
      groups.set(key, current);
    });
  }
  return sortGenreRankingItems(Array.from(groups.values()), rankingMode, sortMode);
}

export async function getGenreRankingItems(
  filter: ProductListFilter & { rankingMode?: ProductRankingMode; sortMode?: GenreSortMode; maxProducts?: number },
): Promise<GenreRankingItem[]> {
  const rankingMode = filter.rankingMode ?? "daily";
  const sortMode = filter.sortMode ?? "sales";
  const indexed = await getGenreIndexEntries(filter);
  if (!indexed) {
    console.warn("Genre index unavailable; using legacy genre fallback", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      workType: filter.workType,
      rankingMode,
      sortMode,
    });
  }
  if (indexed) {
    const period = rankingMode === "weekly"
      ? "weekly"
      : rankingMode === "monthly"
        ? "monthly"
        : rankingMode === "cumulative"
          ? "cumulative"
          : "daily";
    const items = indexed.entries.map((entry) => {
      const metrics = entry[period];
      return {
        rank: 0,
        name: entry.name,
        genreId: entry.genreId,
        productCount: metrics.productCount,
        totalSalesCount: metrics.salesCount,
        estimatedRevenue: metrics.revenue,
        topProducts: entry.topProducts[period],
      } satisfies GenreRankingItem;
    });
    const sorted = sortGenreRankingItems(items, rankingMode, sortMode);
    const offset = filter.offsetCount ?? 0;
    return sorted.slice(offset, offset + (filter.limitCount ?? 30));
  }

  const maxProducts = filter.maxProducts ?? Math.max((filter.offsetCount ?? 0) + (filter.limitCount ?? 30) * 12, 500);
  const products = await getLatestRankingProducts({
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    workType: filter.workType,
    contentType: filter.contentType,
    rankingMode,
    limitCount: maxProducts,
    offsetCount: 0,
    useRankingIndex: false,
    excludeFreeProducts: false,
  });
  return buildGenreRankingItems(products, rankingMode, sortMode).slice(
    filter.offsetCount ?? 0,
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 30),
  );
}

function getSellerKey(product: Product): string | undefined {
  return product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim() || undefined;
}

function normalizeSellerSearchText(value?: string): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
}

function matchesSellerSummaryQuery(summary: SellerSummary, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  return [summary.sellerName, summary.sellerKey, summary.sellerId].some((value) =>
    normalizeSellerSearchText(value).includes(normalizedQuery),
  );
}

function compareDateDesc(a?: string, b?: string): number {
  return (b ?? "").localeCompare(a ?? "");
}

async function getProductsForSellerAggregation(
  filter: ProductListFilter & { maxProducts?: number },
): Promise<Product[]> {
  const db = getAdminDb();

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .limit(filter.maxProducts ?? 1500)
    .get();

  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
  return shouldPostFilter(filter) ? products.filter((product) => matchesProductListFilter(product, filter)) : products;
}

function buildSellerSummaries(products: Product[]): SellerSummary[] {
  const groups = new Map<string, Product[]>();

  for (const product of products) {
    const key = getSellerKey(product);
    if (!key) continue;
    const current = groups.get(key) ?? [];
    current.push(product);
    groups.set(key, current);
  }

  return Array.from(groups.entries()).map(([sellerKey, sellerProducts]) => {
    const sortedBySales = [...sellerProducts].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0));
    const sortedByRelease = [...sellerProducts].sort((a, b) => compareDateDesc(a.releaseDate, b.releaseDate));
    const topProduct = sortedBySales[0];
    const latestProduct = sortedByRelease[0] ?? topProduct;
    const totalSalesCount = sellerProducts.reduce((sum, product) => sum + (product.salesCount ?? 0), 0);
    const estimatedRevenue = sellerProducts.reduce(
      (sum, product) => sum + ((product.salesCount ?? 0) * (product.priceCurrent ?? 0)),
      0,
    );
    const tagCount = new Map<string, number>();

    for (const product of sellerProducts) {
      for (const tag of (product.genres ?? []).filter(Boolean)) {
        tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);
      }
    }

    const tags = Array.from(tagCount.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"))
      .slice(0, 18)
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
      firstReleaseDate: [...sellerProducts].sort((a, b) => (a.releaseDate ?? "").localeCompare(b.releaseDate ?? ""))[0]?.releaseDate,
      latestReleaseDate: latestProduct?.releaseDate,
      newestProductTitle: latestProduct?.title,
      topProduct,
      latestProduct,
      products: sortedBySales,
      tags,
    } satisfies SellerSummary;
  });
}

function buildSellerStatsScopeId(filter: ProductListFilter): string {
  const baseId = `${filter.platform}_${filter.audience}_${filter.category}`;
  return filter.contentType ? `${baseId}_${filter.contentType}` : baseId;
}

function toSellerSummaryFromStats(data: SellerStatsDocument): SellerSummary {
  return {
    sellerKey: data.sellerKey,
    sellerId: data.sellerId,
    sellerName: data.sellerName,
    sellerUrl: data.sellerUrl,
    sellerType: data.sellerType,
    platform: data.platform,
    audience: data.audience,
    category: data.category,
    productCount: normalizeNumber(data.productCount),
    totalSalesCount: normalizeNumber(data.totalSalesCount),
    averageSalesCount: normalizeNumber(data.averageSalesCount),
    estimatedRevenue: normalizeNumber(data.estimatedRevenue),
    averagePrice: typeof data.averagePrice === "number" ? data.averagePrice : undefined,
    firstReleaseDate: data.firstReleaseDate,
    latestReleaseDate: data.latestReleaseDate,
    newestProductTitle: data.newestProductTitle,
    topProduct: data.topProduct,
    latestProduct: data.latestProduct,
    tags: Array.isArray(data.tags) ? data.tags : [],
  };
}

async function getSellerSummariesFromStats(
  filter: ProductListFilter & { maxProducts?: number; sortMode?: SellerSortMode },
): Promise<SellerSummary[] | undefined> {
  const db = getAdminDb();
  const statId = buildSellerStatsScopeId(filter);
  const siteStatsSnapshot = await db.collection(SITE_STATS_COLLECTION).doc(statId).get();
  const siteStats = siteStatsSnapshot.data() as SiteStatsDocument | undefined;

  if (!siteStatsSnapshot.exists || !siteStats?.sellerStatsGeneratedAt) {
    return undefined;
  }

  const normalizedSellerQuery = normalizeSellerSearchText(filter.sellerQuery);
  const offset = filter.offsetCount ?? 0;
  const limit = filter.limitCount ?? 30;

  const sortMode = filter.sortMode ?? "totalSales";
  if (normalizedSellerQuery || sortMode !== "totalSales") {
    const snapshot = await db
      .collection(SELLERS_COLLECTION)
      .where("statId", "==", statId)
      .get();
    const summaries = snapshot.docs
      .map((doc) => toSellerSummaryFromStats(doc.data() as SellerStatsDocument))
      .filter((summary) => matchesSellerSummaryQuery(summary, normalizedSellerQuery))
      .sort(compareSellerSummaries(sortMode));

    return summaries.slice(offset, offset + limit);
  }

  const snapshot = await db
    .collection(SELLERS_COLLECTION)
    .where("statId", "==", statId)
    .orderBy("totalSalesCount", "desc")
    .orderBy("productCount", "desc")
    .orderBy(FieldPath.documentId())
    .offset(offset)
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) =>
    toSellerSummaryFromStats(doc.data() as SellerStatsDocument),
  );
}


function sellerScopeForFilter(filter: ProductListFilter): "all" | "tl" | "bl" {
  return filter.contentType ?? "all";
}

function compareSellerSummaries(sortMode: SellerSortMode): (left: SellerSummary, right: SellerSummary) => number {
  if (sortMode === "estimatedRevenue") {
    return (left, right) => right.estimatedRevenue - left.estimatedRevenue ||
      right.totalSalesCount - left.totalSalesCount || left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "productCount") {
    return (left, right) => right.productCount - left.productCount ||
      right.totalSalesCount - left.totalSalesCount || left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "latestRelease") {
    return (left, right) => (right.latestReleaseDate ?? "").localeCompare(left.latestReleaseDate ?? "") ||
      right.totalSalesCount - left.totalSalesCount || left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "sellerName") {
    return (left, right) => left.sellerName.localeCompare(right.sellerName, "ja") || left.sellerKey.localeCompare(right.sellerKey);
  }
  return (left, right) => right.totalSalesCount - left.totalSalesCount ||
    right.productCount - left.productCount || left.sellerKey.localeCompare(right.sellerKey);
}

function toSellerSummaryFromIndex(item: SellerIndexItem): SellerSummary {
  const { contentScope: _contentScope, normalizedSellerName: _normalizedSellerName, productIdsByReleaseDate: _productIds, ...summary } = item;
  return summary;
}

export async function getSellerSummaries(
  filter: ProductListFilter & { maxProducts?: number; sortMode?: SellerSortMode },
): Promise<SellerSummary[]> {
  const sortMode = filter.sortMode ?? "totalSales";
  const indexedItems = await getSellerIndexItems(filter);
  if (!indexedItems) {
    console.warn("Seller index unavailable; using legacy seller fallback", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      sortMode,
      hasSellerQuery: Boolean(filter.sellerQuery?.trim()),
    });
  }
  if (indexedItems) {
    const normalizedSellerQuery = normalizeSellerSearchText(filter.sellerQuery);
    const summaries = indexedItems
      .filter((item) => item.contentScope === sellerScopeForFilter(filter))
      .map(toSellerSummaryFromIndex)
      .filter((summary) => matchesSellerSummaryQuery(summary, normalizedSellerQuery))
      .sort(compareSellerSummaries(sortMode));
    const offset = filter.offsetCount ?? 0;
    return summaries.slice(offset, offset + (filter.limitCount ?? 30));
  }

  const aggregatedSummaries = await getSellerSummariesFromStats(filter);
  if (aggregatedSummaries !== undefined) {
    return aggregatedSummaries;
  }

  const products = await getProductsForSellerAggregation(filter);
  const normalizedSellerQuery = normalizeSellerSearchText(filter.sellerQuery);
  const summaries = buildSellerSummaries(products)
    .filter((summary) => matchesSellerSummaryQuery(summary, normalizedSellerQuery))
    .sort(compareSellerSummaries(sortMode));

  return summaries.slice(
    filter.offsetCount ?? 0,
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 30),
  );
}

function getSellerCardImageForComparison(
  seller: SellerSummary | SellerCardItem,
): string {
  if ("cardImageUrl" in seller) return seller.cardImageUrl;
  return (
    seller.topProduct?.mainImageUrl ||
    seller.topProduct?.images?.[0]?.url ||
    seller.topProduct?.thumbnailUrl ||
    seller.latestProduct?.mainImageUrl ||
    seller.latestProduct?.thumbnailUrl ||
    "/no-image.svg"
  );
}

function toSellerListComparable(
  seller: SellerSummary | SellerCardItem,
): Record<string, unknown> {
  return {
    sellerKey: seller.sellerKey,
    sellerId: seller.sellerId,
    sellerName: seller.sellerName,
    platform: seller.platform,
    audience: seller.audience,
    category: seller.category,
    productCount: seller.productCount,
    totalSalesCount: seller.totalSalesCount,
    averageSalesCount: seller.averageSalesCount,
    estimatedRevenue: seller.estimatedRevenue,
    averagePrice: seller.averagePrice,
    firstReleaseDate: seller.firstReleaseDate,
    latestReleaseDate: seller.latestReleaseDate,
    newestProductTitle: seller.newestProductTitle,
    cardImageUrl: getSellerCardImageForComparison(seller),
    tags: seller.tags.slice(0, 8),
  };
}

async function getLegacySellerTotalCount(
  filter: ProductListFilter & { sortMode?: SellerSortMode },
): Promise<number | undefined> {
  const indexedItems = await getSellerIndexItems(filter);
  if (!indexedItems) return undefined;
  const normalizedSellerQuery = normalizeSellerSearchText(filter.sellerQuery);
  return indexedItems
    .filter((item) => item.contentScope === sellerScopeForFilter(filter))
    .map(toSellerSummaryFromIndex)
    .filter((summary) =>
      matchesSellerSummaryQuery(summary, normalizedSellerQuery),
    ).length;
}

function logSellerListComparison(
  filter: ProductListFilter & { sortMode?: SellerSortMode },
  legacySellers: SellerSummary[],
  legacyTotalCount: number | undefined,
  next: Awaited<ReturnType<typeof getSellerListViewPage>>,
): void {
  if (!next) {
    console.warn("Seller-list compare skipped because the new view is unavailable", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      sortMode: filter.sortMode ?? "totalSales",
      offsetCount: filter.offsetCount ?? 0,
      limitCount: filter.limitCount ?? 30,
    });
    return;
  }
  const legacyKeys = legacySellers.map((seller) => seller.sellerKey);
  const nextKeys = next.sellers.map((seller) => seller.sellerKey);
  const keyOrderMatches =
    JSON.stringify(legacyKeys) === JSON.stringify(nextKeys);
  const cardMismatches: Array<{ sellerKey: string; legacy: unknown; next: unknown }> = [];
  for (
    let index = 0;
    index < Math.min(legacySellers.length, next.sellers.length);
    index += 1
  ) {
    const legacy = toSellerListComparable(legacySellers[index]);
    const current = toSellerListComparable(next.sellers[index]);
    if (JSON.stringify(legacy) !== JSON.stringify(current)) {
      cardMismatches.push({
        sellerKey: legacySellers[index].sellerKey,
        legacy,
        next: current,
      });
      if (cardMismatches.length >= 3) break;
    }
  }
  const totalCountMatches =
    legacyTotalCount === undefined || legacyTotalCount === next.totalCount;
  const matches =
    keyOrderMatches && cardMismatches.length === 0 && totalCountMatches;
  const payload = {
    matches,
    segmentId: next.segmentId,
    listId: next.listId,
    versionId: next.versionId,
    sourceSellerVersionId: next.sourceSellerVersionId,
    usedPreviousVersion: next.usedPreviousVersion,
    firestoreReadEstimate: next.firestoreReadEstimate,
    blockIds: next.blockIds,
    offsetCount: filter.offsetCount ?? 0,
    limitCount: filter.limitCount ?? 30,
    legacyCount: legacySellers.length,
    nextCount: next.sellers.length,
    legacyTotalCount,
    nextTotalCount: next.totalCount,
    keyOrderMatches,
    firstLegacyKeys: legacyKeys.slice(0, 5),
    firstNextKeys: nextKeys.slice(0, 5),
    cardMismatches,
  };
  if (matches) {
    console.info("Seller-list compare matched", payload);
  } else {
    console.error("Seller-list compare mismatch", payload);
  }
}

export async function getSellerPageSummaries(
  filter: ProductListFilter & { maxProducts?: number; sortMode?: SellerSortMode },
): Promise<Array<SellerSummary | SellerCardItem>> {
  // Arbitrary name search is intentionally kept on the existing seller index in Phase 3.
  if (filter.sellerQuery?.trim()) return getSellerSummaries(filter);

  const mode = getListViewMode();
  const sortMode = filter.sortMode ?? "totalSales";
  if (mode === "off") return getSellerSummaries(filter);

  if (mode === "compare") {
    const [legacySellers, next] = await Promise.all([
      getSellerSummaries(filter),
      getSellerListViewPage(filter, sortMode).catch((error) => {
        console.error("Failed to read seller-list view in compare mode", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }),
    ]);
    const legacyTotalCount = await getLegacySellerTotalCount(filter);
    logSellerListComparison(filter, legacySellers, legacyTotalCount, next);
    return legacySellers;
  }

  const next = await getSellerListViewPage(filter, sortMode).catch((error) => {
    console.error("Failed to read seller-list view", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });
  if (next) {
    if (process.env.LIST_VIEW_DEBUG === "true") {
      console.info("Seller-list view used", {
        mode,
        segmentId: next.segmentId,
        listId: next.listId,
        versionId: next.versionId,
        sourceSellerVersionId: next.sourceSellerVersionId,
        usedPreviousVersion: next.usedPreviousVersion,
        blockIds: next.blockIds,
        firestoreReadEstimate: next.firestoreReadEstimate,
        itemCount: next.sellers.length,
        totalCount: next.totalCount,
      });
    }
    return next.sellers;
  }

  if (mode === "prefer") {
    console.warn("Seller-list view unavailable; using the existing seller path", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
      sortMode,
    });
    return getSellerSummaries(filter);
  }

  console.error("Seller-list view is required but unavailable", {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    contentType: filter.contentType,
    sortMode,
  });
  return [];
}

export async function getSellerSummaryByKey(
  filter: ProductListFilter & { sellerKey: string; maxProducts?: number },
): Promise<SellerSummary | null> {
  const decodedKey = decodeURIComponent(filter.sellerKey).trim();
  const indexedItems = await getSellerIndexItems(filter);
  if (indexedItems) {
    const item = indexedItems.find((candidate) =>
      candidate.contentScope === sellerScopeForFilter(filter) &&
      (candidate.sellerKey === decodedKey || candidate.sellerName === decodedKey || candidate.sellerId === decodedKey),
    );
    if (item) {
      const products = await getProductsByIds(item.productIdsByReleaseDate);
      return { ...toSellerSummaryFromIndex(item), products };
    }
  }

  const products = await getProductsBySellerKey(filter);
  const summaries = buildSellerSummaries(products);
  return summaries.find((summary) => summary.sellerKey === decodedKey || summary.sellerName === decodedKey) ?? summaries[0] ?? null;
}


function buildSiteStatsId(filter: ProductListFilter): string {
  const baseId = `${filter.platform}_${filter.audience}_${filter.category}`;
  return filter.contentType ? `${baseId}_${filter.contentType}` : baseId;
}

type HomeDashboardProduct = Product | ProductCardItem;

type HomeDashboardData = {
  stats: HomeDashboardStats;
  circleHighlights: SellerSummary[];
  rankingProducts: HomeDashboardProduct[];
};

function emptyHomeDashboardData(): HomeDashboardData {
  return {
    stats: {
      productCount: 0,
      todayUpdatedCount: 0,
      saleCount: 0,
      topGenre: undefined,
      popularGenres: [],
      popularCategories: [],
    },
    circleHighlights: [],
    rankingProducts: [],
  };
}

function normalizeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeGenreSummary(value: unknown): GenreSummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const genre = value as Partial<GenreSummary>;
  if (!genre.name || !genre.genreId) return undefined;

  return {
    name: genre.name,
    genreId: genre.genreId,
    productCount: normalizeNumber(genre.productCount),
    totalSalesCount: normalizeNumber(genre.totalSalesCount),
  };
}



function normalizeProductCategorySummary(value: unknown): ProductCategorySummary | undefined {
  if (!value || typeof value !== "object") return undefined;
  const category = value as Partial<ProductCategorySummary>;
  if (!category.name || !category.categoryId || !category.kind || !category.value) return undefined;
  if (category.kind !== "contentType" && category.kind !== "workType") return undefined;

  return {
    name: category.name,
    categoryId: category.categoryId,
    kind: category.kind,
    value: category.value,
    productCount: normalizeNumber(category.productCount),
    totalSalesCount: normalizeNumber(category.totalSalesCount),
  };
}

function getHomeDailyRankingProductIds(
  data: SiteStatsDocument,
  workType: ProductWorkType | "all",
): string[] | undefined {
  if (data.homeDailyRankingStrategy !== "dailyRevenue_v1") {
    return undefined;
  }

  const rankingProductIds = data.homeDailyRankingProductIds as
    | HomeDailyRankingProductIds
    | undefined;
  if (!rankingProductIds || !(workType in rankingProductIds)) {
    return undefined;
  }

  const ids = rankingProductIds[workType];
  if (!Array.isArray(ids)) return [];

  return [...new Set(ids.filter((id): id is string =>
    typeof id === "string" && id.length > 0,
  ))];
}

function normalizeSiteStats(data: SiteStatsDocument): { stats: HomeDashboardStats; circleHighlights: SellerSummary[] } {
  const popularGenres = Array.isArray(data.popularGenres)
    ? data.popularGenres.map((genre) => normalizeGenreSummary(genre)).filter((genre): genre is GenreSummary => Boolean(genre))
    : [];
  const popularCategories = Array.isArray(data.popularCategories)
    ? data.popularCategories
        .map((category) => normalizeProductCategorySummary(category))
        .filter((category): category is ProductCategorySummary => Boolean(category))
    : [];

  return {
    stats: {
      productCount: normalizeNumber(data.productCount),
      todayUpdatedCount: normalizeNumber(data.todayUpdatedCount),
      saleCount: normalizeNumber(data.saleCount),
      topGenre: normalizeGenreSummary(data.topGenre) ?? popularGenres[0],
      popularGenres,
      popularCategories,
    },
    circleHighlights: Array.isArray(data.circleHighlights) ? data.circleHighlights : [],
  };
}

export async function getHomeDashboardData(
  filter: ProductListFilter,
): Promise<HomeDashboardData> {
  const db = getAdminDb();
  const statId = buildSiteStatsId(filter);
  const snapshot = await db.collection(SITE_STATS_COLLECTION).doc(statId).get();

  if (!snapshot.exists) {
    return {
      ...emptyHomeDashboardData(),
      rankingProducts: await getLatestRankingProducts({
        ...filter,
        limitCount: filter.limitCount ?? 10,
      }),
    };
  }

  const siteStats = {
    ...(snapshot.data() as SiteStatsDocument),
    statId: snapshot.id,
  };
  const normalized = normalizeSiteStats(siteStats);
  const rankingWorkType = filter.workType ?? "all";
  const cachedProductIds = getHomeDailyRankingProductIds(
    siteStats,
    rankingWorkType,
  );

  if (cachedProductIds === undefined) {
    return {
      ...normalized,
      rankingProducts: await getLatestRankingProducts({
        ...filter,
        limitCount: filter.limitCount ?? 10,
      }),
    };
  }

  const cachedProducts = (await getProductsByIds(cachedProductIds)).filter(
    (product) => (product.priceCurrent ?? 0) > 0,
  );
  return {
    ...normalized,
    rankingProducts: postFilterProducts(cachedProducts, {
      ...filter,
      offsetCount: 0,
      limitCount: filter.limitCount ?? 10,
    }),
  };
}

export type HomeDashboardPageData = HomeDashboardData & {
  newProducts: HomeDashboardProduct[];
  recentProducts: HomeDashboardProduct[];
  saleProducts: HomeDashboardProduct[];
};

function isHomeDashboardViewDocument(value: unknown): value is HomeDashboardViewDocument {
  if (!value || typeof value !== "object") return false;
  const document = value as Partial<HomeDashboardViewDocument>;
  return document.schemaVersion === 1 &&
    document.strategy === "homeDashboard_v1" &&
    Boolean(document.newCandidateProductIdsByWorkType) &&
    Array.isArray(document.recentCandidateProductIds) &&
    Array.isArray(document.saleCandidateProductIds) &&
    Array.isArray(document.weeklyCircleCandidates);
}

function uniqueStringIds(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))]
    : [];
}

function productsForIds(
  ids: string[],
  productsById: Map<string, Product>,
  filter?: ProductListFilter,
): Product[] {
  const products = ids
    .map((id) => productsById.get(id))
    .filter((product): product is Product => Boolean(product));
  return filter ? products.filter((product) => matchesProductListFilter(product, filter)) : products;
}

async function getHomeDashboardPageDataFallback(
  filter: ProductListFilter,
  rankingWorkType: ProductWorkType | undefined,
  newWorkType: ProductWorkType | undefined,
): Promise<HomeDashboardPageData> {
  const [newProducts, recentProducts, saleProducts, homeData, weeklyCircleHighlights] = await Promise.all([
    getHomeRandomNewProducts({ ...filter, limitCount: 10, workType: newWorkType }),
    getHomeRandomRecentAddedProducts({ ...filter, limitCount: 5 }),
    getHomeRandomSaleProducts({ ...filter, limitCount: 10 }),
    getHomeDashboardData({ ...filter, limitCount: 10, workType: rankingWorkType }),
    getHomeRandomWeeklyCircleHighlights({ ...filter, limitCount: 10 }),
  ]);

  return {
    ...homeData,
    newProducts,
    recentProducts,
    saleProducts,
    circleHighlights: weeklyCircleHighlights.length ? weeklyCircleHighlights : homeData.circleHighlights,
  };
}

async function getLegacyHomeDashboardPageData(
  filter: ProductListFilter & {
    rankingWorkType?: ProductWorkType;
    newWorkType?: ProductWorkType;
  },
): Promise<HomeDashboardPageData> {
  const db = getAdminDb();
  const statId = buildSiteStatsId(filter);
  const statRef = db.collection(SITE_STATS_COLLECTION).doc(statId);
  const [statsSnapshot, homeViewSnapshot] = await Promise.all([
    statRef.get(),
    statRef.collection("views").doc("home").get(),
  ]);

  if (!statsSnapshot.exists) {
    console.warn("Home dashboard cache fallback: siteStats is missing", { statId });
    return getHomeDashboardPageDataFallback(
      filter,
      filter.rankingWorkType,
      filter.newWorkType,
    );
  }

  if (
    !homeViewSnapshot.exists ||
    !isHomeDashboardViewDocument(homeViewSnapshot.data())
  ) {
    console.warn("Home dashboard cache fallback: home view is unavailable", {
      statId,
      homeViewExists: homeViewSnapshot.exists,
    });
    return getHomeDashboardPageDataFallback(
      filter,
      filter.rankingWorkType,
      filter.newWorkType,
    );
  }

  const siteStats = {
    ...(statsSnapshot.data() as SiteStatsDocument),
    statId: statsSnapshot.id,
  };
  const normalized = normalizeSiteStats(siteStats);
  const homeView = homeViewSnapshot.data() as HomeDashboardViewDocument;
  const rankingWorkType = filter.rankingWorkType ?? "all";
  const newWorkType = filter.newWorkType ?? "all";
  const cachedRankingIds = getHomeDailyRankingProductIds(
    siteStats,
    rankingWorkType,
  );
  const hasNewCandidates = Object.prototype.hasOwnProperty.call(
    homeView.newCandidateProductIdsByWorkType,
    newWorkType,
  );

  const rankingIds = cachedRankingIds?.slice(0, 10) ?? [];
  const newIds = hasNewCandidates
    ? shuffleValues(
        uniqueStringIds(
          homeView.newCandidateProductIdsByWorkType[newWorkType],
        ),
      ).slice(0, 10)
    : [];
  const recentIds = shuffleValues(
    uniqueStringIds(homeView.recentCandidateProductIds),
  ).slice(0, 5);
  const saleIds = shuffleValues(
    uniqueStringIds(homeView.saleCandidateProductIds),
  ).slice(0, 10);
  const requestedIds = [
    ...new Set([
      ...rankingIds,
      ...newIds,
      ...recentIds,
      ...saleIds,
    ]),
  ];

  const [requestedProducts, fallbackRankingProducts, fallbackNewProducts] =
    await Promise.all([
      getProductsByIds(requestedIds),
      cachedRankingIds === undefined
        ? getLatestRankingProducts({
            ...filter,
            limitCount: 10,
            workType: filter.rankingWorkType,
          })
        : Promise.resolve(undefined),
      hasNewCandidates
        ? Promise.resolve(undefined)
        : getHomeRandomNewProducts({
            ...filter,
            limitCount: 10,
            workType: filter.newWorkType,
          }),
    ]);

  if (cachedRankingIds === undefined) {
    console.warn("Home dashboard section fallback: ranking cache is unavailable", {
      statId,
      rankingWorkType,
      strategy: siteStats.homeDailyRankingStrategy,
    });
  }
  if (!hasNewCandidates) {
    console.warn("Home dashboard section fallback: new-product cache is unavailable", {
      statId,
      newWorkType,
    });
  }

  const productsById = new Map(
    requestedProducts.map((product) => [product.productId, product]),
  );
  const commonFilter: ProductListFilter = {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    contentType: filter.contentType,
  };
  const weeklyCircleCandidates = homeView.weeklyCircleCandidates.filter(
    (candidate): candidate is WeeklyProductCandidate =>
      Boolean(candidate?.product?.productId) &&
      typeof candidate.weeklySalesCount === "number" &&
      Number.isFinite(candidate.weeklySalesCount),
  );
  const cachedCircleHighlights = selectRandomWeeklyCircleHighlights(
    weeklyCircleCandidates,
    10,
  );

  return {
    ...normalized,
    rankingProducts:
      fallbackRankingProducts ??
      productsForIds(rankingIds, productsById, {
        ...commonFilter,
        workType: filter.rankingWorkType,
      }).filter((product) => (product.priceCurrent ?? 0) > 0),
    newProducts:
      fallbackNewProducts ??
      productsForIds(newIds, productsById, {
        ...commonFilter,
        workType: filter.newWorkType,
      }),
    recentProducts: productsForIds(recentIds, productsById, commonFilter),
    saleProducts: productsForIds(saleIds, productsById, commonFilter),
    circleHighlights: cachedCircleHighlights.length
      ? cachedCircleHighlights
      : normalized.circleHighlights,
  };
}


function homeProductIds(products: HomeDashboardProduct[]): string[] {
  return products.map((product) => product.productId);
}

function homeProductIdsMatch(
  left: HomeDashboardProduct[],
  right: HomeDashboardProduct[],
): boolean {
  return JSON.stringify(homeProductIds(left)) === JSON.stringify(homeProductIds(right));
}

function isSubsetOfCandidateProducts(
  selected: HomeDashboardProduct[],
  candidates: ProductCardItem[],
): boolean {
  const candidateIds = new Set(candidates.map((product) => product.productId));
  return selected.every((product) => candidateIds.has(product.productId));
}

function toHomeDashboardPageDataFromListView(
  next: Awaited<ReturnType<typeof getHomeDashboardListView>>,
): HomeDashboardPageData | undefined {
  if (!next) return undefined;
  const cachedCircleHighlights = selectRandomWeeklyCircleHighlights(
    next.common.weeklyCircleCandidates as WeeklyProductCandidate[],
    10,
  );
  return {
    stats: next.common.stats,
    rankingProducts: next.rankingProducts.slice(0, 10),
    newProducts: shuffleValues(next.newCandidateProducts).slice(0, 10),
    recentProducts: shuffleValues(next.common.recentCandidateProducts).slice(0, 5),
    saleProducts: shuffleValues(next.common.saleCandidateProducts).slice(0, 10),
    circleHighlights: cachedCircleHighlights.length
      ? cachedCircleHighlights
      : next.common.fallbackCircleHighlights,
  };
}

async function compareHomeDashboardListView(
  filter: ProductListFilter & {
    rankingWorkType?: ProductWorkType;
    newWorkType?: ProductWorkType;
  },
  legacy: HomeDashboardPageData,
  next: NonNullable<Awaited<ReturnType<typeof getHomeDashboardListView>>>,
): Promise<void> {
  const statId = buildSiteStatsId(filter);
  const statRef = getAdminDb().collection(SITE_STATS_COLLECTION).doc(statId);
  const [statsSnapshot, homeViewSnapshot] = await Promise.all([
    statRef.get(),
    statRef.collection("views").doc("home").get(),
  ]);
  const sourceHomeView = homeViewSnapshot.exists &&
    isHomeDashboardViewDocument(homeViewSnapshot.data())
      ? (homeViewSnapshot.data() as HomeDashboardViewDocument)
      : undefined;
  const sourceCircleHighlights = statsSnapshot.exists &&
    Array.isArray(statsSnapshot.data()?.circleHighlights)
      ? (statsSnapshot.data()?.circleHighlights as SellerSummary[])
      : [];
  const newWorkType = filter.newWorkType ?? "all";
  const nextNewIds = next.newCandidateProducts.map((product) => product.productId);
  const sourceNewIds = sourceHomeView
    ? uniqueStringIds(sourceHomeView.newCandidateProductIdsByWorkType[newWorkType])
    : [];
  const nextNewSet = new Set(nextNewIds);
  const filteredSourceNewIds = sourceNewIds.filter((id) => nextNewSet.has(id));
  const recentIds = next.common.recentCandidateProducts.map((product) => product.productId);
  const saleIds = next.common.saleCandidateProducts.map((product) => product.productId);
  const sourceRecentIds = sourceHomeView
    ? uniqueStringIds(sourceHomeView.recentCandidateProductIds).filter((id) =>
        new Set(recentIds).has(id),
      )
    : [];
  const sourceSaleIds = sourceHomeView
    ? uniqueStringIds(sourceHomeView.saleCandidateProductIds).filter((id) =>
        new Set(saleIds).has(id),
      )
    : [];
  const sourceWeekly = sourceHomeView?.weeklyCircleCandidates.map((candidate) => ({
    productId: candidate.product.productId,
    weeklySalesCount: candidate.weeklySalesCount,
  })) ?? [];
  const nextWeekly = next.common.weeklyCircleCandidates.map((candidate) => ({
    productId: candidate.product.productId,
    weeklySalesCount: candidate.weeklySalesCount,
  }));
  const statsMatch = JSON.stringify(legacy.stats) === JSON.stringify(next.common.stats);
  const rankingMatch = homeProductIdsMatch(legacy.rankingProducts, next.rankingProducts.slice(0, 10));
  const candidateSourcesMatch = Boolean(sourceHomeView) &&
    JSON.stringify(filteredSourceNewIds) === JSON.stringify(nextNewIds) &&
    JSON.stringify(sourceRecentIds) === JSON.stringify(recentIds) &&
    JSON.stringify(sourceSaleIds) === JSON.stringify(saleIds) &&
    JSON.stringify(sourceWeekly) === JSON.stringify(nextWeekly);
  const selectedProductsAreCandidates =
    isSubsetOfCandidateProducts(legacy.newProducts, next.newCandidateProducts) &&
    isSubsetOfCandidateProducts(legacy.recentProducts, next.common.recentCandidateProducts) &&
    isSubsetOfCandidateProducts(legacy.saleProducts, next.common.saleCandidateProducts);
  const fallbackCircleKeysMatch = JSON.stringify(
    next.common.fallbackCircleHighlights.map((circle) => circle.sellerKey),
  ) === JSON.stringify(
    sourceCircleHighlights.map((circle) => circle.sellerKey),
  );
  const matches =
    statsMatch &&
    rankingMatch &&
    candidateSourcesMatch &&
    selectedProductsAreCandidates &&
    fallbackCircleKeysMatch;
  const payload = {
    matches,
    segmentId: next.segmentId,
    contentScope: next.contentScope,
    versionId: next.versionId,
    sourceStatId: next.sourceStatId,
    sourceRankingVersionId: next.sourceRankingVersionId,
    usedPreviousVersion: next.usedPreviousVersion,
    sectionIds: next.sectionIds,
    firestoreReadEstimate: next.firestoreReadEstimate,
    statsMatch,
    rankingMatch,
    candidateSourcesMatch,
    selectedProductsAreCandidates,
    fallbackCircleKeysMatch,
    legacyRankingIds: homeProductIds(legacy.rankingProducts),
    nextRankingIds: homeProductIds(next.rankingProducts.slice(0, 10)),
  };
  if (matches) {
    console.info("Home-dashboard compare matched", payload);
  } else {
    console.error("Home-dashboard compare mismatch", payload);
  }
}

export async function getHomeDashboardPageData(
  filter: ProductListFilter & {
    rankingWorkType?: ProductWorkType;
    newWorkType?: ProductWorkType;
  },
): Promise<HomeDashboardPageData> {
  const mode = getListViewMode();
  if (mode === "off") return getLegacyHomeDashboardPageData(filter);

  if (mode === "compare") {
    const [legacy, next] = await Promise.all([
      getLegacyHomeDashboardPageData(filter),
      getHomeDashboardListView(filter).catch((error) => {
        console.error("Failed to read home-dashboard list view in compare mode", {
          error: error instanceof Error ? error.message : String(error),
        });
        return undefined;
      }),
    ]);
    if (next) {
      await compareHomeDashboardListView(filter, legacy, next);
    } else {
      console.warn("Home-dashboard compare skipped because the new view is unavailable", {
        platform: filter.platform,
        audience: filter.audience,
        category: filter.category,
        contentType: filter.contentType,
        rankingWorkType: filter.rankingWorkType ?? "all",
        newWorkType: filter.newWorkType ?? "all",
      });
    }
    return legacy;
  }

  const next = await getHomeDashboardListView(filter).catch((error) => {
    console.error("Failed to read home-dashboard list view", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  });
  const page = toHomeDashboardPageDataFromListView(next);
  if (page && next) {
    if (process.env.LIST_VIEW_DEBUG === "true") {
      console.info("Home-dashboard list view used", {
        mode,
        segmentId: next.segmentId,
        contentScope: next.contentScope,
        versionId: next.versionId,
        sourceStatId: next.sourceStatId,
        sourceRankingVersionId: next.sourceRankingVersionId,
        usedPreviousVersion: next.usedPreviousVersion,
        sectionIds: next.sectionIds,
        firestoreReadEstimate: next.firestoreReadEstimate,
        rankingCount: page.rankingProducts.length,
        newCount: page.newProducts.length,
        recentCount: page.recentProducts.length,
        saleCount: page.saleProducts.length,
        circleCount: page.circleHighlights.length,
      });
    }
    return page;
  }

  if (mode === "prefer") {
    console.warn("Home-dashboard list view unavailable; using the existing home path", {
      platform: filter.platform,
      audience: filter.audience,
      category: filter.category,
      contentType: filter.contentType,
    });
    return getLegacyHomeDashboardPageData(filter);
  }

  console.error("Home-dashboard list view is required but unavailable", {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
    contentType: filter.contentType,
  });
  return {
    ...emptyHomeDashboardData(),
    newProducts: [],
    recentProducts: [],
    saleProducts: [],
  };
}

export async function getHomeDashboardStats(
  filter: ProductListFilter,
): Promise<HomeDashboardStats> {
  const { stats } = await getHomeDashboardData(filter);
  return stats;
}


export type SearchProductsFilter = ProductListFilter & {
  keyword: string;
  searchTarget?: SearchTarget;
  searchToken?: string;
};

export type SearchProductsResult = {
  products: Product[];
  totalCount: number;
};

type SearchProductCandidate = SearchIndexItem;
const DIRECT_SEARCH_SEPARATOR_PATTERN = /[\s　/_\-‐‑‒–—―・,，.．。:：;；!！?？()[\]（）【】「」『』〈〉《》<>+＋=＝~〜～|｜]+/g;

function normalizeDirectSearchText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

function compactDirectSearchText(value: string | undefined): string {
  return normalizeDirectSearchText(value).replace(DIRECT_SEARCH_SEPARATOR_PATTERN, "").trim();
}

function splitDirectSearchTerms(value: string): string[] {
  return normalizeDirectSearchText(value)
    .split(DIRECT_SEARCH_SEPARATOR_PATTERN)
    .map((term) => term.trim())
    .filter(Boolean);
}

function getCandidateTextValues(candidate: SearchProductCandidate, searchTarget: SearchTarget = "all"): string[] {
  if (searchTarget === "title") {
    return [candidate.title].filter((value): value is string => Boolean(value));
  }

  if (searchTarget === "seller") {
    return [candidate.seller?.sellerName].filter((value): value is string => Boolean(value));
  }

  if (searchTarget === "genre") {
    return [
      candidate.workType,
      candidate.workTypeLabel,
      candidate.contentType,
      ...(candidate.contentTypes ?? []),
      ...(candidate.contentTypeIds ?? []),
      ...(candidate.genres ?? []),
      ...(candidate.tags ?? []),
      ...(candidate.genreIds ?? []),
      ...(candidate.tagIds ?? []),
    ].filter((value): value is string => Boolean(value));
  }

  return [
    candidate.sourceProductId,
    candidate.productId,
    candidate.title,
    candidate.seller?.sellerName,
    candidate.workType,
    candidate.workTypeLabel,
    ...(candidate.genres ?? []),
    ...(candidate.tags ?? []),
    ...(candidate.genreIds ?? []),
    ...(candidate.tagIds ?? []),
  ].filter((value): value is string => Boolean(value));
}

function candidateMatchesKeyword(candidate: SearchProductCandidate, keyword: string, searchTarget: SearchTarget = "all"): boolean {
  const terms = splitDirectSearchTerms(keyword);
  if (terms.length === 0) return false;

  const values = getCandidateTextValues(candidate, searchTarget);
  const normalizedValues = values.map((value) => normalizeDirectSearchText(value));
  const compactedValues = values.map((value) => compactDirectSearchText(value));

  return terms.every((term) => {
    const normalizedTerm = normalizeDirectSearchText(term);
    const compactedTerm = compactDirectSearchText(term);

    return normalizedValues.some((value) => value.includes(normalizedTerm)) ||
      compactedValues.some((value) => value.includes(compactedTerm));
  });
}

function candidateHasContentType(candidate: SearchProductCandidate, contentType: string): boolean {
  const normalized = normalizeStoredContentType(contentType);
  if (!normalized) return false;

  const scalar = normalizeStoredContentType(candidate.contentType);
  if (scalar === normalized) return true;

  const ids = (candidate.contentTypeIds ?? []).map((id) => normalizeStoredContentType(id));
  if (ids.includes(normalized)) return true;

  const labels = (candidate.contentTypes ?? []).map((label) => normalizeStoredContentType(label));
  return labels.includes(normalized);
}

function candidateMatchesSearchFilter(candidate: SearchProductCandidate, filter: SearchProductsFilter): boolean {
  if (filter.workType && normalizeStoredWorkType(candidate as Product) !== filter.workType) return false;
  if (filter.contentType && !candidateHasContentType(candidate, filter.contentType)) return false;
  return candidateMatchesKeyword(candidate, filter.keyword, filter.searchTarget);
}

function getSearchCandidateScore(candidate: SearchProductCandidate, keyword: string, searchTarget: SearchTarget = "all"): number {
  const normalizedKeyword = normalizeDirectSearchText(keyword);
  const compactedKeyword = compactDirectSearchText(keyword);
  const title = normalizeDirectSearchText(candidate.title);
  const titleCompact = compactDirectSearchText(candidate.title);
  const sellerName = normalizeDirectSearchText(candidate.seller?.sellerName);
  const sellerCompact = compactDirectSearchText(candidate.seller?.sellerName);
  const genres = (candidate.genres ?? []).map((genre) => normalizeDirectSearchText(genre));
  const genreCompacts = (candidate.genres ?? []).map((genre) => compactDirectSearchText(genre));
  const tags = (candidate.tags ?? []).map((tag) => normalizeDirectSearchText(tag));
  const tagCompacts = (candidate.tags ?? []).map((tag) => compactDirectSearchText(tag));
  const sourceProductId = normalizeDirectSearchText(candidate.sourceProductId);

  let score = 0;
  const useAll = searchTarget === "all";

  if (useAll && sourceProductId === normalizedKeyword) score += 20000;

  if (useAll || searchTarget === "title") {
    if (title === normalizedKeyword || titleCompact === compactedKeyword) score += 12000;
    if (title.includes(normalizedKeyword) || titleCompact.includes(compactedKeyword)) score += 8000;
  }

  if (useAll || searchTarget === "seller") {
    if (sellerName === normalizedKeyword || sellerCompact === compactedKeyword) score += 7000;
    if (sellerName.includes(normalizedKeyword) || sellerCompact.includes(compactedKeyword)) score += 5000;
  }

  if (useAll || searchTarget === "genre") {
    if (genres.some((genre) => genre === normalizedKeyword) || genreCompacts.some((genre) => genre === compactedKeyword)) score += 4000;
    if (genres.some((genre) => genre.includes(normalizedKeyword)) || genreCompacts.some((genre) => genre.includes(compactedKeyword))) score += 3000;
    if (tags.some((tag) => tag.includes(normalizedKeyword)) || tagCompacts.some((tag) => tag.includes(compactedKeyword))) score += 1500;
  }

  score += Math.min(candidate.salesCount ?? 0, 100000) / 100;
  score += (candidate.ratingAverage ?? candidate.rating ?? 0) * 10;

  return score;
}

function sortSearchCandidates(candidates: SearchProductCandidate[], keyword: string, searchTarget: SearchTarget = "all"): SearchProductCandidate[] {
  return [...candidates].sort((a, b) => {
    const scoreDiff = getSearchCandidateScore(b, keyword, searchTarget) - getSearchCandidateScore(a, keyword, searchTarget);
    if (scoreDiff !== 0) return scoreDiff;

    const salesDiff = (b.salesCount ?? 0) - (a.salesCount ?? 0);
    if (salesDiff !== 0) return salesDiff;

    const releaseDiff = (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
    if (releaseDiff !== 0) return releaseDiff;

    return (a.title ?? "").localeCompare(b.title ?? "", "ja");
  });
}

async function getSearchProductCandidates(filter: SearchProductsFilter): Promise<SearchProductCandidate[]> {
  const indexedCandidates = await getSearchIndexCandidates(filter);
  if (indexedCandidates) return indexedCandidates;

  console.warn("Search index unavailable; using products full-scan fallback", {
    platform: filter.platform,
    audience: filter.audience,
    category: filter.category,
  });

  const snapshot = await getAdminDb()
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .select(
      "productId",
      "sourceProductId",
      "title",
      "seller",
      "workType",
      "workTypeLabel",
      "contentType",
      "contentTypes",
      "contentTypeIds",
      "genres",
      "tags",
      "genreIds",
      "tagIds",
      "salesCount",
      "rating",
      "ratingAverage",
      "releaseDate",
    )
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as SearchProductCandidate;
    return {
      ...data,
      productId: data.productId ?? doc.id,
    };
  });
}

export async function searchProductsWithTotal(filter: SearchProductsFilter): Promise<SearchProductsResult> {
  const candidates = await getSearchProductCandidates(filter);
  const matchedCandidates = sortSearchCandidates(
    candidates.filter((candidate) => candidateMatchesSearchFilter(candidate, filter)),
    filter.keyword,
    filter.searchTarget,
  );

  const offset = filter.offsetCount ?? 0;
  const limit = filter.limitCount ?? 30;
  const pageProductIds = matchedCandidates.slice(offset, offset + limit).map((candidate) => candidate.productId);
  const products = await getProductsByIds(pageProductIds);

  return {
    products,
    totalCount: matchedCandidates.length,
  };
}

export async function countSearchProducts(filter: SearchProductsFilter): Promise<number> {
  const candidates = await getSearchProductCandidates(filter);
  return candidates.filter((candidate) => candidateMatchesSearchFilter(candidate, filter)).length;
}

export async function searchProducts(filter: SearchProductsFilter): Promise<Product[]> {
  const result = await searchProductsWithTotal(filter);
  return result.products;
}
