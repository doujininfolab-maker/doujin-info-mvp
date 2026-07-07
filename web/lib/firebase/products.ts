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
  ProductDailyMetric,
  ProductTrendPoint,
  RankingSnapshot,
  RankingSnapshotItem,
  RankingType,
  SellerSummary,
  SiteStatsDocument,
} from "../types";
import type { SearchTarget } from "../searchTarget";

const PRODUCTS_COLLECTION = "products";
const RANKING_SNAPSHOTS_COLLECTION = "rankingSnapshots";
const SITE_STATS_COLLECTION = "siteStats";

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

function shuffleProducts(products: Product[]): Product[] {
  const shuffled = [...products];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
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

export async function getProductTrendPoints(productId: string, days = 365): Promise<ProductTrendPoint[]> {
  const startDateKey = toJstDateKey(addDays(new Date(), -(Math.max(days, 1) - 1)));
  const snapshot = await getAdminDb()
    .collection(PRODUCTS_COLLECTION)
    .doc(productId)
    .collection("dailyMetrics")
    .where("date", ">=", startDateKey)
    .orderBy("date", "asc")
    .get();

  return snapshot.docs.flatMap((doc) => {
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


type WeeklyProductCandidate = {
  product: Product;
  weeklySalesCount: number;
};

async function getLatestRankingProductsByRank(
  filter: ProductListFilter & { rankingType: RankingType; readLimit?: number },
): Promise<Product[]> {
  const db = getAdminDb();
  const snapshotDocs = await db
    .collection(RANKING_SNAPSHOTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("rankingType", "==", filter.rankingType)
    .orderBy("date", "desc")
    .limit(1)
    .get();

  if (snapshotDocs.empty) {
    return [];
  }

  const rankingSnapshot = {
    ...(snapshotDocs.docs[0].data() as RankingSnapshot),
    snapshotId: snapshotDocs.docs[0].id,
  };

  const itemDocs = await db
    .collection(RANKING_SNAPSHOTS_COLLECTION)
    .doc(rankingSnapshot.snapshotId)
    .collection("items")
    .orderBy("rank", "asc")
    .limit(filter.readLimit ?? 120)
    .get();

  const productIds = itemDocs.docs.map((doc) => (doc.data() as RankingSnapshotItem).productId);
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
  const randomizedKeys = new Set<string>();
  const randomizedCandidates: WeeklyProductCandidate[] = [];

  for (const candidate of shuffleProducts(topCandidates.map((item) => item.product))) {
    const key = getSellerKey(candidate);
    if (!key || randomizedKeys.has(key)) continue;
    randomizedKeys.add(key);
    randomizedCandidates.push(topCandidates.find((item) => item.product.productId === candidate.productId)!);
    if (randomizedCandidates.length >= (filter.limitCount ?? 10)) break;
  }

  const keyOrder = new Map([...randomizedKeys].map((key, index) => [key, index]));

  return buildWeeklySellerSummaries(
    topCandidates.filter((candidate) => {
      const key = getSellerKey(candidate.product);
      return key ? randomizedKeys.has(key) : false;
    }),
  ).sort((a, b) => (keyOrder.get(a.sellerKey) ?? 9999) - (keyOrder.get(b.sellerKey) ?? 9999));
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

export async function getSellerSummaries(
  filter: ProductListFilter & { maxProducts?: number },
): Promise<SellerSummary[]> {
  const products = await getProductsForSellerAggregation(filter);
  const normalizedSellerQuery = normalizeSellerSearchText(filter.sellerQuery);
  const summaries = buildSellerSummaries(products)
    .filter((summary) => matchesSellerSummaryQuery(summary, normalizedSellerQuery))
    .sort(
      (a, b) => b.totalSalesCount - a.totalSalesCount || b.productCount - a.productCount,
    );

  return summaries.slice(
    filter.offsetCount ?? 0,
    (filter.offsetCount ?? 0) + (filter.limitCount ?? 30),
  );
}

export async function getSellerSummaryByKey(
  filter: ProductListFilter & { sellerKey: string; maxProducts?: number },
): Promise<SellerSummary | null> {
  const products = await getProductsBySellerKey(filter);
  const summaries = buildSellerSummaries(products);
  const decodedKey = decodeURIComponent(filter.sellerKey).trim();

  return summaries.find((summary) => summary.sellerKey === decodedKey || summary.sellerName === decodedKey) ?? summaries[0] ?? null;
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


export type SearchProductsFilter = ProductListFilter & {
  keyword: string;
  searchTarget?: SearchTarget;
  searchToken?: string;
};

export type SearchProductsResult = {
  products: Product[];
  totalCount: number;
};

type SearchProductCandidate = {
  productId: string;
  sourceProductId?: string;
  title?: string;
  seller?: {
    sellerName?: string;
  };
  workType?: string;
  workTypeLabel?: string;
  contentType?: string;
  contentTypes?: string[];
  contentTypeIds?: string[];
  genres?: string[];
  tags?: string[];
  genreIds?: string[];
  tagIds?: string[];
  salesCount?: number;
  rating?: number;
  ratingAverage?: number;
  releaseDate?: string;
};

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
