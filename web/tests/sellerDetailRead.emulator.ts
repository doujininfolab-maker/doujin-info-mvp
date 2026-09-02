import assert from "node:assert/strict";
import {
  getAggregateTrendPointsForProducts,
  getSellerSummaryByKey,
} from "../lib/firebase/products";
import { getAdminDb } from "../lib/firebase/admin";
import { buildSellerStatsDocumentId } from "../lib/firebase/sellerDetailRead";
import type {
  Product,
  ProductContentType,
  ProductListFilter,
  SellerStatsDocument,
  SellerSummary,
} from "../lib/types";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GCLOUD_PROJECT ?? "";

assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/, "Firestore Emulator is required");
assert.notEqual(projectId, "doujin-info-prod", "Production project is forbidden");

type Sample = {
  contentType?: ProductContentType;
  data: SellerStatsDocument;
};

function summaryComparable(summary: SellerSummary): Record<string, unknown> {
  const { products: _products, ...summaryWithoutProducts } = summary;
  return {
    summary: JSON.parse(JSON.stringify(summaryWithoutProducts)) as unknown,
    productIds: (summary.products ?? [])
      .map((product) => product.productId)
      .sort(),
  };
}

function productIds(products: Product[] | undefined): string[] {
  return (products ?? []).map((product) => product.productId).sort();
}

async function loadSamples(): Promise<Sample[]> {
  const db = getAdminDb();
  const scopes: Array<{ statId: string; contentType?: ProductContentType }> = [
    { statId: "dlsite_female_doujin" },
    { statId: "dlsite_female_doujin_tl", contentType: "tl" },
    { statId: "dlsite_female_doujin_bl", contentType: "bl" },
  ];
  const samples: Sample[] = [];

  for (const scope of scopes) {
    const [snapshot, largestSnapshot] = await Promise.all([
      db
      .collection("sellers")
      .where("statId", "==", scope.statId)
      .limit(2)
      .get(),
      db
        .collection("sellers")
        .where("statId", "==", scope.statId)
        .orderBy("productCount", "desc")
        .limit(1)
        .get(),
    ]);
    const documents = new Map(
      [...snapshot.docs, ...largestSnapshot.docs].map((doc) => [doc.id, doc]),
    );
    for (const doc of documents.values()) {
      samples.push({
        contentType: scope.contentType,
        data: doc.data() as SellerStatsDocument,
      });
    }
  }

  assert.ok(samples.length >= 3, "Expected seller aggregates in the emulator snapshot");
  return samples;
}

async function main(): Promise<void> {
  const db = getAdminDb();
  const samples = await loadSamples();
  const indexRoot = await db.collection("sellerIndexes").doc("dlsite_female_doujin").get();
  const indexChunkCount = Array.isArray(indexRoot.data()?.chunkIds)
    ? indexRoot.data()?.chunkIds.length as number
    : 0;
  assert.ok(indexChunkCount > 0, "Expected a production-like seller index in the emulator");

  const heapBefore = process.memoryUsage().heapUsed;
  const comparisons: Array<Record<string, unknown>> = [];

  for (const sample of samples) {
    const filter: ProductListFilter & { sellerKey: string } = {
      platform: sample.data.platform,
      audience: sample.data.audience,
      category: sample.data.category,
      contentType: sample.contentType,
      sellerKey: sample.data.sellerKey,
    };

    process.env.SELLER_DETAIL_READ_MODE = "stats";
    const statsSummary = await getSellerSummaryByKey(filter);
    assert.ok(statsSummary, `Stats summary missing for ${sample.data.sellerKey}`);
    const heapAfterStats = process.memoryUsage().heapUsed;

    process.env.SELLER_DETAIL_READ_MODE = "legacy";
    const legacySummary = await getSellerSummaryByKey(filter);
    assert.ok(legacySummary, `Legacy summary missing for ${sample.data.sellerKey}`);
    const heapAfterLegacy = process.memoryUsage().heapUsed;

    assert.deepEqual(
      summaryComparable(statsSummary),
      summaryComparable(legacySummary),
      `Summary mismatch for ${sample.data.sellerKey}/${sample.contentType ?? "all"}`,
    );

    const statsTrend = await getAggregateTrendPointsForProducts(statsSummary.products ?? [], 365);
    const legacyTrend = await getAggregateTrendPointsForProducts(legacySummary.products ?? [], 365);
    assert.deepEqual(
      statsTrend,
      legacyTrend,
      `365-day trend mismatch for ${sample.data.sellerKey}/${sample.contentType ?? "all"}`,
    );

    const allScopeStats = sample.contentType
      ? await db.collection("sellers").doc(buildSellerStatsDocumentId(
          `${sample.data.platform}_${sample.data.audience}_${sample.data.category}`,
          sample.data.sellerKey,
        )).get()
      : undefined;
    const queriedProductCount = sample.contentType
      ? Number(allScopeStats?.data()?.productCount ?? statsSummary.products?.length ?? 0)
      : statsSummary.products?.length ?? 0;

    comparisons.push({
      sellerKey: sample.data.sellerKey,
      scope: sample.contentType ?? "all",
      productCount: statsSummary.products?.length ?? 0,
      trendPointCount: statsTrend.length,
      statsReadEstimate: 1 + queriedProductCount,
      legacyReadEstimate: 2 + indexChunkCount + (legacySummary.products?.length ?? 0),
      heapDeltaAfterStatsBytes: heapAfterStats - heapBefore,
      heapDeltaAfterLegacyBytes: heapAfterLegacy - heapBefore,
    });
  }

  // A name-based legacy URL cannot derive the aggregate document id. Confirm
  // the bounded product-query fallback still resolves it without the index.
  const nameSample = samples.find((sample) => sample.data.sellerName !== sample.data.sellerKey) ?? samples[0];
  process.env.SELLER_DETAIL_READ_MODE = "stats";
  const byName = await getSellerSummaryByKey({
    platform: nameSample.data.platform,
    audience: nameSample.data.audience,
    category: nameSample.data.category,
    contentType: nameSample.contentType,
    sellerKey: encodeURIComponent(nameSample.data.sellerName),
  });
  assert.ok(byName, "Name-based seller fallback did not resolve");
  assert.equal(byName.sellerKey, nameSample.data.sellerKey);
  assert.deepEqual(productIds(byName.products), productIds(
    comparisons.length > 0
      ? (await getSellerSummaryByKey({
          platform: nameSample.data.platform,
          audience: nameSample.data.audience,
          category: nameSample.data.category,
          contentType: nameSample.contentType,
          sellerKey: nameSample.data.sellerKey,
        }))?.products
      : undefined,
  ));

  process.env.SELLER_DETAIL_READ_MODE = "stats";
  const missing = await getSellerSummaryByKey({
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    sellerKey: "__missing_seller_for_local_test__",
  });
  assert.equal(missing, null);

  console.log(JSON.stringify({
    emulatorHost,
    projectId,
    indexChunkCount,
    comparedSamples: comparisons.length,
    comparisons,
    nameFallbackSellerKey: byName.sellerKey,
    missingSellerResult: missing,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
