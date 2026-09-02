import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const statsOrigin = process.env.STATS_ORIGIN ?? "http://127.0.0.1:3002";
const legacyOrigin = process.env.LEGACY_ORIGIN ?? "http://127.0.0.1:3003";

function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productLinks(html) {
  return [...html.matchAll(/href="\/work\/([^"?]+)/g)].map((match) => match[1]);
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

const pageCases = [
  ["all", "/dlsite/female/doujin/circle/RG65338"],
  ["tl", "/dlsite/female/doujin/circle/RG65338?contentType=tl"],
  ["bl-large", "/dlsite/female/doujin/circle/RG35081?contentType=bl"],
];
const apiCases = [
  ["30", "/api/trends/seller/dlsite/female/doujin/RG65338?days=30"],
  ["365", "/api/trends/seller/dlsite/female/doujin/RG65338?days=365"],
  ["365-bl", "/api/trends/seller/dlsite/female/doujin/RG35081?days=365&contentType=bl"],
];

const pages = [];
for (const [name, path] of pageCases) {
  const [statsResponse, legacyResponse] = await Promise.all([
    fetch(`${statsOrigin}${path}`),
    fetch(`${legacyOrigin}${path}`),
  ]);
  const [statsHtml, legacyHtml] = await Promise.all([
    statsResponse.text(),
    legacyResponse.text(),
  ]);
  const statsVisibleText = visibleText(statsHtml);
  const legacyVisibleText = visibleText(legacyHtml);
  const statsProductLinks = productLinks(statsHtml);
  const legacyProductLinks = productLinks(legacyHtml);

  assert.equal(statsResponse.status, 200, `${name}: stats page status`);
  assert.equal(legacyResponse.status, 200, `${name}: legacy page status`);
  assert.equal(statsVisibleText, legacyVisibleText, `${name}: visible text mismatch`);
  assert.deepEqual(statsProductLinks, legacyProductLinks, `${name}: product order mismatch`);

  pages.push({
    name,
    visibleTextEqual: true,
    productOrderEqual: true,
    productLinks: statsProductLinks.length,
    visibleHash: hash(statsVisibleText),
  });
}

const apis = [];
for (const [name, path] of apiCases) {
  const [statsResponse, legacyResponse] = await Promise.all([
    fetch(`${statsOrigin}${path}`),
    fetch(`${legacyOrigin}${path}`),
  ]);
  const [statsJson, legacyJson] = await Promise.all([
    statsResponse.json(),
    legacyResponse.json(),
  ]);

  assert.equal(statsResponse.status, 200, `${name}: stats API status`);
  assert.equal(legacyResponse.status, 200, `${name}: legacy API status`);
  assert.deepEqual(statsJson, legacyJson, `${name}: API response mismatch`);

  apis.push({
    name,
    equal: true,
    points: statsJson.points?.length ?? 0,
  });
}

console.log(JSON.stringify({ statsOrigin, legacyOrigin, pages, apis }, null, 2));
