import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import type {
  Product,
  ProductListFilter,
  RankingSnapshot,
  RankingSnapshotItem,
  RankingType,
  SellerSummary,
} from "../types";

const PRODUCTS_COLLECTION = "products";
const RANKING_SNAPSHOTS_COLLECTION = "rankingSnapshots";

function toProduct(id: string, data: FirebaseFirestore.DocumentData): Product {
  return {
    ...(data as Product),
    productId: (data as Product).productId ?? id,
  };
}

export async function getPopularProducts(
  filter: ProductListFilter,
): Promise<Product[]> {
  const db = getAdminDb();

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .orderBy("salesCount", "desc")
    .offset(filter.offsetCount ?? 0)
    .limit(filter.limitCount ?? 24)
    .get();

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
}

export async function getNewProducts(
  filter: ProductListFilter,
): Promise<Product[]> {
  const db = getAdminDb();

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .orderBy("releaseDate", "desc")
    .offset(filter.offsetCount ?? 0)
    .limit(filter.limitCount ?? 24)
    .get();

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
}

export async function getSaleProducts(
  filter: ProductListFilter,
): Promise<Product[]> {
  const db = getAdminDb();

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where("isDiscounted", "==", true)
    .orderBy("discountRate", "desc")
    .offset(filter.offsetCount ?? 0)
    .limit(filter.limitCount ?? 24)
    .get();

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
}

export async function getProductsByGenre(
  filter: ProductListFilter & { genreId: string },
): Promise<Product[]> {
  const db = getAdminDb();

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where("platform", "==", filter.platform)
    .where("audience", "==", filter.audience)
    .where("category", "==", filter.category)
    .where("isActive", "==", true)
    .where("genreIds", "array-contains", filter.genreId)
    .orderBy("salesCount", "desc")
    .offset(filter.offsetCount ?? 0)
    .limit(filter.limitCount ?? 24)
    .get();

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
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

  const snapshot = await query.limit((filter.limitCount ?? 6) + 4).get();

  return snapshot.docs
    .map((doc) => toProduct(doc.id, doc.data()))
    .filter((product) => product.productId !== filter.excludeProductId)
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
  filter: ProductListFilter & { rankingType?: RankingType },
): Promise<Product[]> {
  const db = getAdminDb();

  const rankingType = filter.rankingType ?? "daily";

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
    return getPopularProducts(filter);
  }

  const rankingSnapshotDoc = snapshotDocs.docs[0];

  const rankingSnapshot = {
    ...(rankingSnapshotDoc.data() as RankingSnapshot),
    snapshotId: rankingSnapshotDoc.id,
  };

  const itemDocs = await db
    .collection(RANKING_SNAPSHOTS_COLLECTION)
    .doc(rankingSnapshot.snapshotId)
    .collection("items")
    .orderBy("rank", "asc")
    .offset(filter.offsetCount ?? 0)
    .limit(filter.limitCount ?? 50)
    .get();

  const items = itemDocs.docs.map(
    (doc) => doc.data() as RankingSnapshotItem,
  );

  const productIds = items.map((item) => item.productId);

  if (productIds.length === 0) {
    return getPopularProducts(filter);
  }

  return getProductsByIds(productIds);
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

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
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
  const summaries = buildSellerSummaries(products).sort(
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
  const products = await getProductsForSellerAggregation(filter);
  const summaries = buildSellerSummaries(products);
  const decodedKey = decodeURIComponent(filter.sellerKey).trim();

  return summaries.find((summary) => summary.sellerKey === decodedKey || summary.sellerName === decodedKey) ?? null;
}
