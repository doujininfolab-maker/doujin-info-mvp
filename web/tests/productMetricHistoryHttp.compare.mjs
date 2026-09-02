import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const legacyOrigin = process.env.LEGACY_ORIGIN ?? "http://127.0.0.1:3102";
const yearOrigin = process.env.YEAR_ORIGIN ?? "http://127.0.0.1:3103";
const productIds = (process.env.PRODUCT_IDS ?? [
  "dlsite_doujin_RJ01672243",
  "dlsite_doujin_RJ01581684",
  "dlsite_doujin_RJ379476",
].join(","))
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const periods = [7, 30, 90, 365];

function hash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const comparisons = [];

for (const productId of productIds) {
  for (const days of periods) {
    const path = `/api/trends/product/${encodeURIComponent(productId)}?days=${days}`;
    const [legacyResponse, yearResponse] = await Promise.all([
      fetch(`${legacyOrigin}${path}`),
      fetch(`${yearOrigin}${path}`),
    ]);
    const [legacyJson, yearJson] = await Promise.all([
      legacyResponse.json(),
      yearResponse.json(),
    ]);

    assert.equal(legacyResponse.status, 200, `${productId}/${days}: legacy status`);
    assert.equal(yearResponse.status, 200, `${productId}/${days}: year status`);
    assert.deepEqual(yearJson, legacyJson, `${productId}/${days}: trend mismatch`);

    comparisons.push({
      productId,
      days,
      points: yearJson.points?.length ?? 0,
      responseHash: hash(yearJson),
      legacyReadUpperBound: days,
      yearReadUpperBound: days === 365 ? 2 : 1,
    });
  }
}

console.log(JSON.stringify({ legacyOrigin, yearOrigin, comparisons }, null, 2));
