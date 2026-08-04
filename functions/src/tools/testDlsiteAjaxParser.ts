import assert from "node:assert/strict";
import { parseDlsiteAjaxInfoForTesting } from "../adapters/dlsite/dlsiteFemaleDoujinAdapter";
import { normalizeProduct } from "../normalizers/normalizeProduct";

const sourceProductId = "RJ01504617";

const payload = {
  [sourceProductId]: {
    dl_count: 28937,
    dl_count_total: 30510,
    dl_count_items: [
      {
        workno: "RJ01504617",
        edition_id: 43980,
        edition_type: "language",
        display_order: 1,
        label: "日本語",
        lang: "JPN",
        dl_count: "28937",
        display_label: "日本語",
      },
      {
        workno: "RJ01571645",
        edition_id: 43980,
        edition_type: "language",
        display_order: 3,
        label: "英語",
        lang: "ENG",
        dl_count: 22,
        display_label: "英語",
      },
      {
        workno: "RJ01529893",
        edition_id: 43980,
        edition_type: "language",
        display_order: 5,
        label: "簡体中文",
        lang: "CHI_HANS",
        dl_count: 254,
        display_label: "簡体中文",
      },
      {
        workno: "RJ01533479",
        edition_id: 43980,
        edition_type: "language",
        display_order: 7,
        label: "繁体中文",
        lang: "CHI_HANT",
        dl_count: 346,
        display_label: "繁体中文",
      },
      {
        workno: "RJ01514060",
        edition_id: 43980,
        edition_type: "language",
        display_order: 9,
        label: "韓国語",
        lang: "KO_KR",
        dl_count: 951,
        display_label: "韓国語",
      },
    ],
    price: 880,
    official_price: 1100,
    discount_rate: 20,
    rate_average: 5,
    rate_average_2dp: 4.9,
    rate_count: 894,
    rate_count_detail: [
      { review_point: 1, count: 3, ratio: 0 },
      { review_point: 2, count: 0, ratio: 0 },
      { review_point: 3, count: 15, ratio: 1 },
      { review_point: 4, count: 50, ratio: 5 },
      { review_point: 5, count: 826, ratio: 92 },
    ],
    review_count: 20,
    rank: [
      { term: "day", category: "all", rank: 1, rank_date: "2026-05-12" },
      { term: "week", category: "all", rank: 3, rank_date: "2026-05-15" },
      { term: "month", category: "all", rank: 5, rank_date: "2025-12-22" },
      { term: "total", category: "all", rank: 290, rank_date: "2026-07-26" },
      { term: "day", category: "comic", rank: 1, rank_date: "2026-05-12" },
      { term: "week", category: "comic", rank: 3, rank_date: "2026-05-15" },
      { term: "month", category: "comic", rank: 5, rank_date: "2025-12-22" },
    ],
    regist_date: "2025-11-24 00:00:00",
  },
};

const parsed = parseDlsiteAjaxInfoForTesting(payload, sourceProductId);
assert.equal(parsed.status, "success");
assert.equal(parsed.salesCount, 28937);
assert.equal(parsed.totalSalesCount, 30510);
assert.equal(parsed.currentEditionSalesCount, 28937);
assert.equal(parsed.salesEditionGroupId, "dlsite-edition-43980");
assert.equal(parsed.salesEditions?.length, 5);
assert.equal(parsed.salesEditions?.at(-1)?.salesCount, 951);
assert.equal(parsed.priceCurrent, 880);
assert.equal(parsed.priceOriginal, 1100);
assert.equal(parsed.discountRate, 20);
assert.equal(parsed.rating, 4.9);
assert.equal(parsed.reviewCount, 894);
assert.equal(parsed.ratingCount, 894);
assert.equal(parsed.textReviewCount, 20);
assert.equal(
  parsed.ratingBreakdown?.reduce((sum, item) => sum + item.count, 0),
  894,
);
assert.equal(parsed.sourceRankings?.length, 7);
assert.equal(parsed.sourceRankings?.find((item) => item.term === "total")?.rank, 290);
assert.equal(parsed.releaseDate, "2025-11-24");

const noTranslations = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000001: {
      dl_count: "123",
      dl_count_items: [],
      rate_count: 0,
      rate_count_detail: [],
      rank: [],
    },
  },
  "RJ00000001",
);
assert.equal(noTranslations.status, "success");
assert.equal(noTranslations.salesCount, 123);
assert.equal(noTranslations.totalSalesCount, 123);
assert.equal(noTranslations.currentEditionSalesCount, 123);
assert.deepEqual(noTranslations.salesEditions, []);
assert.equal(noTranslations.salesEditionGroupId, null);
assert.deepEqual(noTranslations.ratingBreakdown, []);
assert.deepEqual(noTranslations.sourceRankings, []);

const invalidZeroTotal = parseDlsiteAjaxInfoForTesting(
  {
    RJ01672243: {
      dl_count: 8974,
      dl_count_total: 0,
      dl_count_items: [],
    },
  },
  "RJ01672243",
);
assert.equal(invalidZeroTotal.salesCount, 8974);
assert.equal(invalidZeroTotal.totalSalesCount, 8974);

const genuineZeroTotal = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000007: {
      dl_count: 0,
      dl_count_total: 0,
      dl_count_items: [],
    },
  },
  "RJ00000007",
);
assert.equal(genuineZeroTotal.salesCount, 0);
assert.equal(genuineZeroTotal.totalSalesCount, 0);

const directTotalBelowEditionSum = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000008: {
      dl_count: 10,
      dl_count_total: 12,
      dl_count_items: [
        { workno: "RJ00000008", edition_id: 3, dl_count: 10 },
        { workno: "RJ00000009", edition_id: 3, dl_count: 5 },
      ],
    },
  },
  "RJ00000008",
);
assert.equal(directTotalBelowEditionSum.salesCount, 10);
assert.equal(directTotalBelowEditionSum.totalSalesCount, 15);

const missingDirectTotal = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000010: {
      dl_count: 10,
      dl_count_items: [
        { workno: "RJ00000010", edition_id: 4, dl_count: 10 },
        { workno: "RJ00000011", edition_id: 4, dl_count: 5 },
      ],
    },
  },
  "RJ00000010",
);
assert.equal(missingDirectTotal.salesCount, 10);
assert.equal(missingDirectTotal.totalSalesCount, 15);


const currentCountFromItems = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000003: {
      dl_count_total: 15,
      dl_count_items: [
        { workno: "RJ00000003", edition_id: 1, dl_count: 10 },
        { workno: "RJ00000004", edition_id: 1, dl_count: 5 },
      ],
    },
  },
  "RJ00000003",
);
assert.equal(currentCountFromItems.status, "success");
assert.equal(currentCountFromItems.salesCount, 10);
assert.equal(currentCountFromItems.totalSalesCount, 15);
assert.equal(currentCountFromItems.currentEditionSalesCount, 10);


const noDiscount = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000005: {
      dl_count: 2,
      price: 1100,
      official_price: 1100,
      is_discount: false,
    },
  },
  "RJ00000005",
);
assert.equal(noDiscount.discountRate, 0);
assert.deepEqual(noDiscount.sourceRankings, []);
assert.deepEqual(noDiscount.ratingBreakdown, []);

const incompleteEditions = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000006: {
      dl_count: 10,
      dl_count_total: 15,
      dl_count_items: [
        { workno: "RJ00000006", edition_id: 2, dl_count: 10 },
        { workno: "invalid", edition_id: 2, dl_count: 5 },
      ],
    },
  },
  "RJ00000006",
);
assert.equal(incompleteEditions.salesCount, 10);
assert.equal(incompleteEditions.totalSalesCount, 15);
assert.equal(incompleteEditions.salesEditions, undefined);
assert.equal(incompleteEditions.salesEditionGroupId, undefined);

const incompleteEditionsWithZeroTotal = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000012: {
      dl_count: 10,
      dl_count_total: 0,
      dl_count_items: [
        { workno: "RJ00000012", edition_id: 5, dl_count: 10 },
        { workno: "invalid", edition_id: 5, dl_count: 5 },
      ],
    },
  },
  "RJ00000012",
);
assert.equal(incompleteEditionsWithZeroTotal.salesCount, 10);
assert.equal(incompleteEditionsWithZeroTotal.totalSalesCount, 10);
assert.equal(incompleteEditionsWithZeroTotal.salesEditions, undefined);

const normalized = normalizeProduct(
  {
    sourceProductId,
    title: "test",
    salesCount: parsed.salesCount,
    totalSalesCount: parsed.totalSalesCount,
    currentEditionSalesCount: parsed.currentEditionSalesCount,
  },
  {
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    rankingType: "daily",
  },
);
assert.equal(normalized.salesCount, 28937);
assert.equal(normalized.totalSalesCount, 30510);
assert.equal(normalized.currentEditionSalesCount, 28937);
assert.equal(normalized.isDiscounted, undefined);
assert.equal(normalized.isOnSale, undefined);

const missing = parseDlsiteAjaxInfoForTesting(payload, "RJ99999999");
assert.equal(missing.status, "unavailable");

const invalidBreakdown = parseDlsiteAjaxInfoForTesting(
  {
    RJ00000002: {
      dl_count: 5,
      dl_count_total: 5,
      rate_count: 10,
      rate_count_detail: [{ review_point: 5, count: 9 }],
    },
  },
  "RJ00000002",
);
assert.equal(invalidBreakdown.status, "success");
assert.equal(invalidBreakdown.salesCount, 5);
assert.equal(invalidBreakdown.totalSalesCount, 5);
assert.equal(invalidBreakdown.ratingCount, 10);
assert.deepEqual(invalidBreakdown.ratingBreakdown, []);

console.log("DLsite Ajax parser tests passed");
