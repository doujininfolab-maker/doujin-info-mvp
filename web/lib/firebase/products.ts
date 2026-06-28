import { FieldPath } from "firebase-admin/firestore";
import { getAdminDb } from "./admin";
import type {
  Product,
  ProductListFilter,
  RankingSnapshot,
  RankingSnapshotItem,
  RankingType,
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
    .limit(filter.limitCount ?? 24)
    .get();

  return snapshot.docs.map((doc) => toProduct(doc.id, doc.data()));
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