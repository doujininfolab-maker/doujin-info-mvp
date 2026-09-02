import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { Timestamp } from "firebase-admin/firestore";
import {
  COMPACT_SEARCH_INDEX_MAX_COMPRESSED_BYTES,
  COMPACT_SEARCH_INDEX_MAX_ITEMS_PER_BLOCK,
  COMPACT_SEARCH_INDEX_MAX_UNCOMPRESSED_BYTES,
  buildCompactSearchIndexBlocks,
  buildCompactSearchIndexRows,
  compactSearchIndexRowToItem,
} from "../batch/rebuildCompactSearchIndex";
import {
  buildSearchIndexItems,
  toSearchIndexItem,
} from "../batch/rebuildSearchIndex";
import type { Product } from "../types";

function product(index: number): Product {
  const suffix = String(index).padStart(6, "0");
  return {
    productId: `RJ${suffix}`,
    sourceProductId: `RJ${suffix}`,
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    affiliateProvider: "dlsite",
    title: `作品　${suffix} Mixed CASE`,
    seller: {
      sellerId: `RG${index % 700}`,
      sellerName: `サークル ${index % 700}`,
    },
    priceCurrent: index % 17 === 0 ? undefined : 770 + (index % 5) * 110,
    priceOriginal: 1_650,
    discountRate: index % 4 === 0 ? 30 : 0,
    isDiscounted: index % 4 === 0,
    currency: "JPY",
    salesCount: index * 3,
    rating: index % 6,
    ratingAverage: 4.1 + (index % 8) / 10,
    releaseDate: `2026${String((index % 12) + 1).padStart(2, "0")}${String((index % 28) + 1).padStart(2, "0")}`,
    isAdult: true,
    workType: index % 2 === 0 ? "comic" : "voice",
    workTypeLabel: index % 2 === 0 ? "マンガ" : "ボイス",
    contentTypes: index % 3 === 0 ? ["tl", "bl"] : ["tl"],
    contentTypeIds: index % 3 === 0 ? ["tl", "bl"] : ["tl"],
    images: [],
    sourceUrl: `https://example.invalid/product/${suffix}`,
    genres: [`ジャンル${index % 30}`],
    tags: [`タグ${index % 50}`, `共通${index % 7}`],
    genreIds: [`G${index % 30}`],
    tagIds: [`T${index % 50}`],
    isActive: true,
    fetchStatus: "success",
  };
}

function run(): void {
  const special = product(17);
  assert.deepEqual(
    compactSearchIndexRowToItem(buildCompactSearchIndexRows([special])[0]),
    toSearchIndexItem(special),
    "compact conversion must preserve every legacy search field",
  );

  const products = Array.from({ length: 15_500 }, (_, index) => product(index));
  const legacy = buildSearchIndexItems(products);
  const rows = buildCompactSearchIndexRows(products);
  assert.equal(rows.length, legacy.length);
  assert.deepEqual(
    rows.map(compactSearchIndexRowToItem),
    legacy,
    "all compact rows must reconstruct the exact legacy candidate dataset",
  );

  const blocks = buildCompactSearchIndexBlocks(
    "dlsite_female_doujin",
    "test-version",
    rows,
    Timestamp.fromMillis(1_000),
  );
  assert.ok(blocks.length > 0);
  assert.equal(
    blocks.reduce((sum, block) => sum + block.descriptor.itemCount, 0),
    rows.length,
  );
  for (const block of blocks) {
    assert.ok(block.descriptor.itemCount <= COMPACT_SEARCH_INDEX_MAX_ITEMS_PER_BLOCK);
    assert.ok(block.descriptor.compressedBytes <= COMPACT_SEARCH_INDEX_MAX_COMPRESSED_BYTES);
    assert.ok(block.descriptor.uncompressedBytes <= COMPACT_SEARCH_INDEX_MAX_UNCOMPRESSED_BYTES);
    const decoded = JSON.parse(
      gunzipSync(block.document.payload as Buffer).toString("utf8"),
    );
    assert.equal(decoded.length, block.descriptor.itemCount);
  }

  const legacyBytes = Buffer.byteLength(JSON.stringify(legacy), "utf8");
  const compactBytes = blocks.reduce(
    (sum, block) => sum + block.descriptor.compressedBytes,
    0,
  );
  assert.ok(compactBytes < legacyBytes, "compact payload must be smaller than legacy JSON");
  console.log(JSON.stringify({
    products: products.length,
    blocks: blocks.length,
    legacyBytes,
    compactBytes,
    storageReductionPercent: Number(((1 - compactBytes / legacyBytes) * 100).toFixed(2)),
  }, null, 2));
}

run();
