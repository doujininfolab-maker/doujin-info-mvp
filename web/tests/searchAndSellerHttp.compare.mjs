import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const legacyOrigin = process.env.LEGACY_ORIGIN ?? "http://127.0.0.1:3102";
const compactOrigin = process.env.COMPACT_ORIGIN ?? "http://127.0.0.1:3103";
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/, "Firestore Emulator is required");
assert.notEqual(process.env.GCLOUD_PROJECT, "doujin-info-prod", "Production project is forbidden");

if (getApps().length === 0) initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = getFirestore();

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function functionalPageText(html) {
  let text = visibleText(html)
    .replace(/LOADING データを読み込んでいます。\s*/g, "");
  const markers = ["検索結果", "♧ サークル一覧"];
  const start = Math.min(
    ...markers.map((marker) => text.indexOf(marker)).filter((index) => index >= 0),
  );
  if (Number.isFinite(start)) text = text.slice(start);
  const footer = text.indexOf("女性向け同人作品の情報を、データで分かりやすく。");
  if (footer >= 0) text = text.slice(0, footer);
  return text.trim();
}

function links(html, pattern) {
  return [...html.matchAll(pattern)].map((match) => decodeURIComponent(match[1]));
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function comparePage(name, path, linkPattern, requireResults = true) {
  const [legacyResponse, compactResponse] = await Promise.all([
    fetch(`${legacyOrigin}${path}`),
    fetch(`${compactOrigin}${path}`),
  ]);
  const [legacyHtml, compactHtml] = await Promise.all([
    legacyResponse.text(),
    compactResponse.text(),
  ]);
  assert.equal(legacyResponse.status, 200, `${name}: legacy status`);
  assert.equal(compactResponse.status, 200, `${name}: compact status`);
  const legacyVisible = functionalPageText(legacyHtml);
  const compactVisible = functionalPageText(compactHtml);
  const legacyLinks = links(legacyHtml, linkPattern);
  const compactLinks = links(compactHtml, linkPattern);
  assert.equal(compactVisible, legacyVisible, `${name}: visible text mismatch`);
  assert.deepEqual(compactLinks, legacyLinks, `${name}: item order mismatch`);
  if (requireResults) assert.ok(legacyLinks.length > 0, `${name}: expected a non-empty result`);
  return {
    name,
    status: 200,
    visibleTextEqual: true,
    orderEqual: true,
    resultLinks: legacyLinks.length,
    visibleHash: hash(legacyVisible),
  };
}

const sampleSnapshot = await db
  .collection("products")
  .where("platform", "==", "dlsite")
  .where("audience", "==", "female")
  .where("category", "==", "doujin")
  .where("isActive", "==", true)
  .limit(100)
  .get();
const sample = sampleSnapshot.docs
  .map((document) => ({ id: document.id, ...document.data() }))
  .find((product) => product.title && product.seller?.sellerName && product.genres?.[0]);
assert.ok(sample, "A product with title, seller, and genre is required");
console.log("HTTP parity sample", {
  documentId: sample.id,
  productId: sample.productId,
  sourceProductId: sample.sourceProductId,
  title: sample.title,
  sellerName: sample.seller.sellerName,
  genre: sample.genres[0],
});

const q = (value) => encodeURIComponent(value);
const contentType = (sample.contentTypeIds ?? []).some((value) =>
  String(value).toLowerCase().includes("bl"),
) ? "bl" : "tl";
const cases = [
  ["product-id", `/search?q=${q(sample.productId ?? sample.id)}&contentType=${contentType}`],
  ["title", `/search?q=${q(sample.title)}&searchTarget=title&contentType=${contentType}`],
  ["seller", `/search?q=${q(sample.seller.sellerName)}&searchTarget=seller&contentType=${contentType}`],
  ["genre", `/search?q=${q(sample.genres[0])}&searchTarget=genre&contentType=${contentType}`],
  ["content-filter", `/search?q=${q(sample.title)}&searchTarget=title&contentType=${contentType}`],
  ["pagination", "/search?q=RJ&limit=30&page=2"],
];

const search = [];
for (const [name, path] of cases) {
  search.push(await comparePage(name, path, /href="\/work\/([^"?]+)/g));
}

const sellerName = sample.seller.sellerName;
const sellerSearch = [
  await comparePage(
    "seller-name-search",
    `/dlsite/female/doujin/circle?q=${q(sellerName)}&sort=totalSales&contentType=${contentType}`,
    /href="\/dlsite\/female\/doujin\/circle\/([^"?]+)/g,
  ),
  await comparePage(
    "seller-name-search-bl",
    `/dlsite/female/doujin/circle?q=${q(sellerName)}&sort=sellerName&contentType=bl`,
    /href="\/dlsite\/female\/doujin\/circle\/([^"?]+)/g,
    false,
  ),
];

const segmentId = "dlsite_female_doujin";
const [legacySearchRoot, compactSearchRoot, sellerIndexRoot] = await Promise.all([
  db.collection("searchIndexes").doc(segmentId).get(),
  db.collection("compactSearchIndexes").doc(segmentId).get(),
  db.collection("sellerIndexes").doc(segmentId).get(),
]);
const sellerListRoot = db
  .collection("sellerListViews")
  .doc(segmentId)
  .collection("sellerListViewLists");
const [sellerTotalSalesList, sellerNameBlList] = await Promise.all([
  sellerListRoot.doc(`${contentType}_totalSales`).get(),
  sellerListRoot.doc("bl_sellerName").get(),
]);
const count = (value) => Array.isArray(value) ? value.length : 0;
const sellerLegacyReads = 2 + count(sellerIndexRoot.data()?.chunkIds);

console.log(JSON.stringify({
  emulatorHost,
  sampleProductId: sample.id,
  search,
  sellerSearch,
  firstLoadReadEstimate: {
    legacySearch: 2 + count(legacySearchRoot.data()?.chunkIds),
    compactSearch: 2 + Number(compactSearchRoot.data()?.blockCount ?? 0),
    legacySellerNameSearch: sellerLegacyReads,
    sellerListNameSearch: {
      requestedScope: 1 + Number(sellerTotalSalesList.data()?.blockCount ?? 0),
      blSellerNameSort: 1 + Number(sellerNameBlList.data()?.blockCount ?? 0),
    },
    warmCache: 0,
  },
}, null, 2));
