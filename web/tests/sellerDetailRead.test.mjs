import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSellerStatsDocumentId,
  buildSellerStatsScopeId,
  getSellerDetailReadMode,
  matchesSellerStatsDocument,
} from "../lib/firebase/sellerDetailRead.ts";

const filter = {
  platform: "dlsite",
  audience: "female",
  category: "doujin",
};

test("defaults safely to the legacy path", () => {
  assert.equal(getSellerDetailReadMode(undefined), "legacy");
  assert.equal(getSellerDetailReadMode("unknown"), "legacy");
  assert.equal(getSellerDetailReadMode(" stats "), "stats");
});

test("builds the same deterministic seller id as the aggregation batch", () => {
  const statId = buildSellerStatsScopeId(filter);
  assert.equal(statId, "dlsite_female_doujin");
  assert.equal(
    buildSellerStatsDocumentId(statId, "RG42523"),
    "dlsite_female_doujin_ac410330e88c1230c75dbb5232676969",
  );
  assert.equal(
    buildSellerStatsScopeId({ ...filter, contentType: "tl" }),
    "dlsite_female_doujin_tl",
  );
});

test("accepts only an active aggregate from the requested scope and seller", () => {
  const data = {
    sellerStatsId: "unused",
    statId: "dlsite_female_doujin",
    sellerKey: "RG42523",
    sellerId: "RG42523",
    sellerName: "test seller",
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    contentScope: "all",
    productCount: 4,
    totalSalesCount: 10,
    averageSalesCount: 3,
    estimatedRevenue: 1_000,
    tags: [],
    isActive: true,
  };

  assert.equal(matchesSellerStatsDocument(data, filter, "RG42523"), true);
  assert.equal(matchesSellerStatsDocument({ ...data, statId: "wrong" }, filter, "RG42523"), false);
  assert.equal(matchesSellerStatsDocument({ ...data, contentScope: "tl" }, filter, "RG42523"), false);
  assert.equal(matchesSellerStatsDocument({ ...data, isActive: false }, filter, "RG42523"), false);
  assert.equal(matchesSellerStatsDocument(data, filter, "different"), false);
});
