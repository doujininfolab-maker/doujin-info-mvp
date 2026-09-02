import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import type { Product } from "../types";
import {
  buildSellerVisibilityKey,
  materializeProductVisibility,
  type ContentVisibilityRuntimeSnapshot,
} from "../visibility/contentVisibility";

function runtime(params: {
  revision?: number;
  hiddenProductIds?: string[];
  hiddenSellerProductIds?: string[];
  hiddenSellerKeys?: string[];
} = {}): ContentVisibilityRuntimeSnapshot {
  return {
    schemaVersion: 1,
    revision: params.revision ?? 0,
    hiddenProductIds: new Set(params.hiddenProductIds ?? []),
    hiddenSellerProductIds: new Set(params.hiddenSellerProductIds ?? []),
    hiddenSellerKeys: new Set(params.hiddenSellerKeys ?? []),
  };
}

const product = {
  productId: "dlsite_doujin_RJTEST001",
  sourceProductId: "RJTEST001",
  platform: "dlsite",
  audience: "female",
  category: "doujin",
  affiliateProvider: "dlsite",
  title: "test",
  seller: { sellerId: "RGTEST001", sellerName: "test circle", sellerType: "circle" },
  currency: "JPY",
  isAdult: false,
  images: [],
  sourceUrl: "https://example.invalid/RJTEST001",
  genres: [],
  tags: [],
  genreIds: [],
  tagIds: [],
  isActive: true,
  fetchStatus: "success",
} satisfies Product;

const evaluatedAt = Timestamp.fromMillis(1_788_278_400_000);

const existing = materializeProductVisibility(product, runtime(), evaluatedAt);
assert.equal(existing.isActive, true, "controlなしでは既存公開状態を維持する");
assert.equal(existing.sourceIsActive, true);
assert.deepEqual(existing.visibility?.blockers, []);

const productHidden = materializeProductVisibility(product, runtime({
  revision: 1,
  hiddenProductIds: [product.productId],
}), evaluatedAt);
assert.equal(productHidden.isActive, false);
assert.deepEqual(productHidden.visibility?.blockers, ["product"]);

const sellerHidden = materializeProductVisibility(product, runtime({
  revision: 2,
  hiddenSellerKeys: [buildSellerVisibilityKey("dlsite", "RGTEST001")],
}), evaluatedAt);
assert.equal(sellerHidden.isActive, false);
assert.deepEqual(sellerHidden.visibility?.blockers, ["seller"]);

const staleDerivedHidden = materializeProductVisibility(product, runtime({
  revision: 3,
  hiddenSellerProductIds: [product.productId],
}), evaluatedAt);
assert.equal(staleDerivedHidden.isActive, false);
assert.deepEqual(staleDerivedHidden.visibility?.blockers, ["seller"]);

const sourceHidden = materializeProductVisibility({
  ...product,
  sourceIsActive: false,
  isActive: false,
}, runtime(), evaluatedAt);
assert.equal(sourceHidden.isActive, false);
assert.deepEqual(sourceHidden.visibility?.blockers, ["source"]);

const overlap = materializeProductVisibility(product, runtime({
  revision: 4,
  hiddenProductIds: [product.productId],
  hiddenSellerKeys: [buildSellerVisibilityKey("dlsite", "RGTEST001")],
}), evaluatedAt);
assert.equal(overlap.isActive, false);
assert.deepEqual(overlap.visibility?.blockers, ["product", "seller"]);

const sellerRestoredButProductHidden = materializeProductVisibility(
  overlap,
  runtime({ revision: 5, hiddenProductIds: [product.productId] }),
  evaluatedAt,
);
assert.equal(sellerRestoredButProductHidden.isActive, false);
assert.deepEqual(sellerRestoredButProductHidden.visibility?.blockers, ["product"]);

console.log("Content visibility unit tests passed");
