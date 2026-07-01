import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import type {
  Product,
  ProductListFilter,
  ProductRankingMode,
  HomeDashboardStats,
  GenreSummary,
  GenreRankingItem,
  ProductCategorySummary,
  RankingSnapshot,
  RankingSnapshotItem,
  RankingType,
  SellerSummary,
  SiteStatsDocument,
} from "../types";

const PRODUCTS_COLLECTION = "products";
const RANKING_SNAPSHOTS_COLLECTION = "rankingSnapshots";
const SITE_STATS_COLLECTION = "siteStats";

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

function rankingTypeForMode(mode?: ProductRankingMode): RankingType | undefined {
  if (mode === "weekly") return "weekly";
  if (mode === "monthly") return "monthly";
  if (mode === "cumulative") return undefined;
  return "daily";
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

export async function getNewProducts(
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
    .orderBy("releaseDate", "desc");

  if (!needsPostFilter) {
    query = query.offset(filter.offsetCount ?? 0);
  }

  const snapshot = await query.limit(queryLimitForFilter(filter, filter.limitCount ?? 24)).get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));

  return needsPostFilter ? postFilterProducts(products, filter) : products;
}

export async function getSaleProducts(
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
    .where("isDiscounted", "==", true)
    .orderBy("discountRate", "desc");

  if (!needsPostFilter) {
    query = query.offset(filter.offsetCount ?? 0);
  }

  const snapshot = await query.limit(queryLimitForFilter(filter, filter.limitCount ?? 24)).get();
  const products = snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));

  return needsPostFilter ? postFilterProducts(products, filter) : products;
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

export async function getProductsBySameSeller(
  filter: ProductListFilter & { sellerId?: string; sellerName?: string; excludeProductId?: string },
): Promise<Product[]> {
  const db = getAdminDb();
  const sellerId = filter.sellerId?.trim();
  const sellerName = filter.sellerName?.trim();

  if (!sellerId && !sellerName) {
    return [];
  }

  let query: FirebaseFirestore.Query<FirebaseFirestore.DocumentData> = db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true);

  query = sellerId
    ? query.where("seller.sellerId", "==", sellerId)
    : query.where("seller.sellerName", "==", sellerName);

  const snapshot = await query
    .limit(queryLimitForFilter(filter, Math.max((filter.limitCount ?? 6) * 8, 50)))
    .get();

  return snapshot.docs
    .map((doc) => toProduct(doc.id, doc.data()))
    .filter((product) => product.productId !== filter.excludeProductId)
    .filter((product) => matchesProductListFilter(product, filter))
    .sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0))
    .slice(0, filter.limitCount ?? 6);
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
  filter: ProductListFilter & { rankingType?: RankingType; rankingMode?: ProductRankingMode },
): Promise<Product[]> {
  const db = getAdminDb();

  const rankingMode = filter.rankingMode ?? "dailyRevenue";
  const rankingType = filter.rankingType ?? rankingTypeForMode(rankingMode);

  if (!rankingType) {
    return getPopularProducts(filter);
  }

  const snapshotDocs = await db
    .collection(RANKING_SNAPSHOTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("rankingType", "==", rankingType)
    .orderBy("date", "desc")
    .limit(1)
    .get();

  if (snapshotDocs.empty) {
    return rankingMode === "dailyRevenue" ? getEstimatedRevenueProducts(filter) : getPopularProducts(filter);
  }

  const rankingSnapshotDoc = snapshotDocs.docs[0];

  const rankingSnapshot = {
    ...(rankingSnapshotDoc.data() as RankingSnapshot),
    snapshotId: rankingSnapshotDoc.id,
  };

  const rankingReadLimit = Math.max(
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 50) * 8,
    300,
  );

  const itemDocs = await db
    .collection(RANKING_SNAPSHOTS_COLLECTION)
    .doc(rankingSnapshot.snapshotId)
    .collection("items")
    .orderBy("rank", "asc")
    .limit(rankingReadLimit)
    .get();

  const items = itemDocs.docs.map(
    (doc) => doc.data() as RankingSnapshotItem,
  );

  const productIds = items.map((item) => item.productId);

  if (productIds.length === 0) {
    return rankingMode === "dailyRevenue" ? getEstimatedRevenueProducts(filter) : getPopularProducts(filter);
  }

  const products = await getProductsByIds(productIds);
  // 日間売上だけ、商品価格×販売数の推定売上順に並べ替える。
  // 日間/週間/月間/累計は、一覧右端の表示と合わせて販売本数順にする。
  const rankedProducts = rankingMode === "dailyRevenue" ? sortProductsByEstimatedRevenue(products) : sortProductsBySales(products);

  return postFilterProducts(rankedProducts, filter);
}


function buildGenreId(label: string, product: Product, index: number): string {
  const existing = product.genreIds?.[index];
  if (existing) return existing;
  return `dlsite:${label}`;
}

function sortGenreRankingItems(items: GenreRankingItem[], rankingMode: ProductRankingMode): GenreRankingItem[] {
  return [...items]
    .sort((a, b) => {
      if (rankingMode === "dailyRevenue") {
        const revenueDiff = b.estimatedRevenue - a.estimatedRevenue;
        if (revenueDiff !== 0) return revenueDiff;
      }

      const salesDiff = b.totalSalesCount - a.totalSalesCount;
      if (salesDiff !== 0) return salesDiff;

      const countDiff = b.productCount - a.productCount;
      if (countDiff !== 0) return countDiff;

      return a.name.localeCompare(b.name, "ja");
    })
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function buildGenreRankingItems(products: Product[], rankingMode: ProductRankingMode): GenreRankingItem[] {
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
      current.topProducts = sortProductsBySales([...current.topProducts, product]).slice(0, 3);
      groups.set(key, current);
    });
  }

  return sortGenreRankingItems(Array.from(groups.values()), rankingMode);
}

export async function getGenreRankingItems(
  filter: ProductListFilter & { rankingMode?: ProductRankingMode; maxProducts?: number },
): Promise<GenreRankingItem[]> {
  const rankingMode = filter.rankingMode ?? "daily";
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
  });

  return buildGenreRankingItems(products, rankingMode).slice(
    filter.offsetCount ?? 0,
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 30),
  );
}

function getSellerKey(product: Product): string | undefined {
  return product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim() || undefined;
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

function normalizeSellerSearchText(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function sellerMatchesQuery(seller: SellerSummary, query?: string): boolean {
  const normalizedQuery = normalizeSellerSearchText(query ?? "");
  if (!normalizedQuery) return true;

  const searchTargets = [seller.sellerName, seller.sellerKey, seller.sellerId].filter(Boolean);
  return searchTargets.some((value) => normalizeSellerSearchText(String(value)).includes(normalizedQuery));
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

export async function getSellerSummaries(
  filter: ProductListFilter & { maxProducts?: number },
): Promise<SellerSummary[]> {
  const products = await getProductsForSellerAggregation(filter);
  const summaries = buildSellerSummaries(products)
    .filter((seller) => sellerMatchesQuery(seller, filter.sellerQuery))
    .sort((a, b) => b.totalSalesCount - a.totalSalesCount || b.productCount - a.productCount);

  return summaries.slice(
    filter.offsetCount ?? 0,
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 30),
  );
}

export async function getSellerSummaryByKey(
  filter: ProductListFilter & { sellerKey: string; maxProducts?: number },
): Promise<SellerSummary | null> {
  const products = await getProductsForSellerAggregation(filter);
  const summaries = buildSellerSummaries(products);
  const decodedKey = decodeURIComponent(filter.sellerKey).trim();

  return summaries.find((summary) => summary.sellerKey === decodedKey || summary.sellerName === decodedKey) ?? null;
}


function buildSiteStatsId(filter: ProductListFilter): string {
  const baseId = `${filter.platform}_${filter.audience}_${filter.category}`;
  return filter.contentType ? `${baseId}_${filter.contentType}` : baseId;
}

function emptyHomeDashboardData(): { stats: HomeDashboardStats; circleHighlights: SellerSummary[] } {
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
): Promise<{ stats: HomeDashboardStats; circleHighlights: SellerSummary[] }> {
  const db = getAdminDb();
  const statId = buildSiteStatsId(filter);
  const snapshot = await db.collection(SITE_STATS_COLLECTION).doc(statId).get();

  if (!snapshot.exists) {
    return emptyHomeDashboardData();
  }

  return normalizeSiteStats({ ...(snapshot.data() as SiteStatsDocument), statId: snapshot.id });
}

export async function getHomeDashboardStats(
  filter: ProductListFilter,
): Promise<HomeDashboardStats> {
  const { stats } = await getHomeDashboardData(filter);
  return stats;
}
