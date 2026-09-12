import assert from "node:assert/strict";
import { Query } from "firebase-admin/firestore";
import { getAdminDb } from "../lib/firebase/admin";
import { getProductsByGenre, getProductTrendPointsFromSnapshots, getProductTrendPoints } from "../lib/firebase/products";
import { getGenreDetailCandidates, clearGenreDetailCache } from "../lib/firebase/genreDetailView";
import { clearContentVisibilityRuntimeCache } from "../lib/firebase/contentVisibility";
import type { Product, ProductListFilter } from "../lib/types";
import robots from "../app/robots";

assert.equal(process.env.FIRESTORE_EMULATOR_HOST, "127.0.0.1:8188");
assert.equal(process.env.GCLOUD_PROJECT, "demo-cost-review");
const db = getAdminDb();
const base = { platform: "dlsite", audience: "female", category: "doujin", genreId: "dlsite:test" } as const;
let reads = 0;
let duringBlockRead: (() => Promise<void>) | undefined;
const originalGetAll = db.getAll.bind(db);
db.getAll = (async (...args: Parameters<typeof db.getAll>) => {
  const docs = await originalGetAll(...args); reads += docs.length;
  if (duringBlockRead && docs.some((doc) => doc.ref.path.includes("/blocks/"))) {
    const action = duringBlockRead; duringBlockRead = undefined; await action();
  }
  return docs;
}) as typeof db.getAll;
const queryGet = Query.prototype.get;
Query.prototype.get = async function (...args: Parameters<typeof queryGet>) {
  const snapshot = await queryGet.apply(this, args);
  reads += Math.max(1, snapshot.size) + ((this as unknown as { _queryOptions: { offset?: number } })._queryOptions.offset ?? 0);
  return snapshot;
};
const cardFields = ["productId", "sourceProductId", "platform", "audience", "category", "title", "seller", "priceCurrent", "priceOriginal", "discountRate", "isDiscounted", "salesCount", "rating", "ratingAverage", "releaseDate", "workType", "workTypeLabel", "contentTypes", "contentTypeIds", "mainImageUrl", "thumbnailUrl", "images", "genres", "genreIds", "tags", "isActive", "sourceUrl", "affiliateUrl"];
const comparable = (products: Product[]) => products.map((p) => Object.fromEntries(cardFields.filter((f) => (p as unknown as Record<string, unknown>)[f] !== undefined).map((f) => [f, (p as unknown as Record<string, unknown>)[f]])));
async function measured(filter: ProductListFilter & { genreId: string }, mode: string) {
  process.env.GENRE_DETAIL_READ_MODE = mode; reads = 0;
  const start = performance.now(); const result = await getProductsByGenre(filter);
  return { result, reads, ms: performance.now() - start };
}
async function run() {
  let cases = 0;
  for (const genreId of ["dlsite:test", "dlsite:small", "unknown"]) {
    for (const contentType of [undefined, "tl", "bl"] as const) for (const workType of [undefined, "comic", "voice", "game"] as const) {
      for (const limitCount of [30, 50, 100, 200]) for (const page of [0, 1, 3]) {
        const filter = { ...base, genreId, contentType, workType, limitCount, offsetCount: limitCount * page };
        const legacy = await measured(filter, "legacy");
        const packed = await measured(filter, "prefer");
        assert.deepEqual(comparable(packed.result), comparable(legacy.result), JSON.stringify(filter));
        cases += 1;
      }
    }
  }
  const filter = { ...base, contentType: "tl", limitCount: 30 } as const;
  clearGenreDetailCache();
  const legacy = await measured(filter, "legacy");
  const cold = await measured(filter, "prefer");
  const warm = await measured(filter, "prefer");
  assert.ok(cold.reads < legacy.reads / 10, JSON.stringify({ legacy: legacy.reads, cold: cold.reads }));
  const timings: { legacy: number[]; packed: number[] } = { legacy: [], packed: [] };
  for (let i = 0; i < 15; i++) {
    timings.legacy.push((await measured(filter, "legacy")).ms);
    timings.packed.push((await measured(filter, "prefer")).ms);
  }
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const source = db.doc("genreDetailControl/source");
  const state = (await source.get()).data()!;
  await source.update({ writers: { test: true } });
  assert.equal(await getGenreDetailCandidates(base, 0, 300), undefined);
  const fallback = await measured(filter, "prefer");
  assert.deepEqual(comparable(fallback.result), comparable(legacy.result));
  await source.set(state);
  const root = (await db.doc("genreDetailViews/dlsite_female_doujin").get()).data()!;
  const genres = await db.collection(`genreDetailViews/dlsite_female_doujin/versions/${root.activeVersion}/genres`).where("genreId", "==", base.genreId).get();
  const blockRef = genres.docs[0].ref.collection("blocks").doc("0");
  const block = (await blockRef.get()).data()!;
  await blockRef.update({ payload: Buffer.from("corrupt") }); clearGenreDetailCache();
  assert.equal(await getGenreDetailCandidates(base, 0, 300), undefined);
  assert.deepEqual(comparable((await measured(filter, "prefer")).result), comparable(legacy.result));
  await blockRef.set(block); clearGenreDetailCache();
  duringBlockRead = () => source.update({ revision: state.revision + 1 }).then(() => undefined);
  assert.equal(await getGenreDetailCandidates(base, 0, 300), undefined, "mutation during block fetch invalidates the read");
  await source.set(state); clearGenreDetailCache();
  // Visibility updates invalidate the aggregate before the source mutation.
  await source.update({ revision: state.revision + 1 });
  const hidden = db.doc("products/dlsite_doujin_TEST0000");
  await hidden.update({ isActive: false }); clearContentVisibilityRuntimeCache();
  const hiddenResult = await measured({ ...base, limitCount: 30 }, "prefer");
  assert.ok(!hiddenResult.result.some((p) => p.productId === hidden.id));
  await hidden.update({ isActive: true }); await source.set(state);
  for (const path of ["genreDetailControl/source", "genreDetailViews/dlsite_female_doujin", `${blockRef.path}`, "products/dlsite_doujin_INITIAL/metricYears/2026"]) {
    const response = await fetch(`http://127.0.0.1:8188/v1/projects/demo-cost-review/databases/(default)/documents/${path}`);
    assert.equal(response.status, 403, `anonymous read must be denied: ${path}`);
  }
  const initial = (await db.doc("products/dlsite_doujin_INITIAL").get()).data() as Product;
  const snapshotPoints = getProductTrendPointsFromSnapshots(initial);
  assert.equal(snapshotPoints.find((p) => p.date === "2026-09-01")?.sales, 120);
  assert.equal(snapshotPoints.find((p) => p.date === "2026-09-02")?.sales, 80);
  process.env.METRIC_HISTORY_READ_MODE = "year";
  const historyPoints = await getProductTrendPoints(initial.productId, 365);
  assert.equal(historyPoints.find((p) => p.date === "2026-09-01")?.sales, 120);
  const rules = robots().rules;
  assert.ok(Array.isArray(rules));
  assert.deepEqual(rules[0], { userAgent: "*", allow: "/", disallow: ["/api/", "/search"] });
  assert.deepEqual(rules[1], { userAgent: ["Meta-ExternalAgent", "Amazonbot"], disallow: "/" });
  console.log(JSON.stringify({ status: "passed", parityCases: cases, reads: { legacy: legacy.reads, cold: cold.reads, warm: warm.reads }, medianMs: { legacy: median(timings.legacy), packed: median(timings.packed) }, fallback: "dirty/corrupt/visibility passed", firstDayChart: 120 }));
}
run().then(() => db.terminate()).catch((error) => { console.error(error); process.exitCode = 1; });
