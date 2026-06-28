import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { db } from "../firebaseAdmin";
import { buildRankItemId, buildRankingKey, buildSnapshotId, nowTimestamp, toYyyyMMdd } from "../util";
import { buildDummyProducts, buildDummySellers, buildDummyTaxonomies } from "./dummyProducts";
import type { RankingSnapshot, RankingSnapshotItem } from "../types";

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST != null;
}

function isSeedAllowed(key: string | undefined): boolean {
  if (isEmulator()) return true;
  const expected = process.env.SEED_KEY;
  return Boolean(expected && key && expected === key);
}

export const seedDummyProducts = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
  },
  async (req, res): Promise<void> => {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    if (!isSeedAllowed(key)) {
      res.status(403).json({ ok: false, message: "invalid seed key" });
      return;
    }

    const products = buildDummyProducts();
    const taxonomies = buildDummyTaxonomies(products);
    const sellers = buildDummySellers(products);
    const date = toYyyyMMdd();
    const target = {
      platform: "dlsite" as const,
      audience: "female" as const,
      category: "doujin" as const,
      rankingType: "daily" as const,
    };
    const rankingKey = buildRankingKey(target);
    const snapshotId = buildSnapshotId(date, rankingKey);
    const capturedAt = nowTimestamp();

    const batch = db.batch();

    for (const product of products) {
      const productRef = db.collection("products").doc(product.productId);
      batch.set(productRef, product, { merge: true });
      batch.set(
        productRef.collection("dailyMetrics").doc(date),
        {
          date,
          platform: product.platform,
          audience: product.audience,
          category: product.category,
          priceCurrent: product.priceCurrent,
          priceOriginal: product.priceOriginal,
          discountRate: product.discountRate,
          isDiscounted: product.isDiscounted,
          salesCount: product.salesCount,
          wishlistCount: product.wishlistCount,
          rating: product.rating,
          ratingAverage: product.ratingAverage,
          reviewCount: product.reviewCount,
          fetchedAt: capturedAt,
        },
        { merge: true },
      );
    }

    for (const taxonomy of taxonomies) {
      batch.set(db.collection("taxonomies").doc(taxonomy.taxonomyId), taxonomy, { merge: true });
    }

    for (const seller of sellers) {
      batch.set(db.collection("sellers").doc(seller.sellerId), seller, { merge: true });
    }

    const rankingSnapshot: RankingSnapshot = {
      snapshotId,
      platform: target.platform,
      audience: target.audience,
      category: target.category,
      rankingType: target.rankingType,
      rankingKey,
      date,
      sourceUrl: "https://www.dlsite.com/girls/ranking/day",
      capturedAt,
      fetchedAt: capturedAt,
      itemCount: products.length,
      status: "success",
    };

    const snapshotRef = db.collection("rankingSnapshots").doc(snapshotId);
    batch.set(snapshotRef, rankingSnapshot, { merge: true });

    products.forEach((product, index) => {
      const rank = index + 1;
      const item: RankingSnapshotItem = {
        snapshotId,
        platform: target.platform,
        audience: target.audience,
        category: target.category,
        rankingType: target.rankingType,
        rankingKey,
        rank,
        productId: product.productId,
        sourceProductId: product.sourceProductId,
        capturedAt,
      };
      batch.set(snapshotRef.collection("items").doc(buildRankItemId(rank, product.productId)), item, { merge: true });
    });

    await batch.commit();

    logger.info("dummy products seeded", {
      productCount: products.length,
      taxonomyCount: taxonomies.length,
      sellerCount: sellers.length,
      snapshotId,
    });

    res.json({
      ok: true,
      productCount: products.length,
      taxonomyCount: taxonomies.length,
      sellerCount: sellers.length,
      snapshotId,
      date,
    });
  },
);
