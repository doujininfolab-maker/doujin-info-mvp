import assert from "node:assert/strict";

const legacyOrigin = process.env.LEGACY_ORIGIN ?? "http://127.0.0.1:3102";
const compactOrigin = process.env.COMPACT_ORIGIN ?? "http://127.0.0.1:3103";

function functionalText(html) {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/LOADING データを読み込んでいます。\s*/g, "")
    .trim();
  const starts = ["新着作品", "セール作品"]
    .map((marker) => text.indexOf(marker))
    .filter((index) => index >= 0);
  if (starts.length) text = text.slice(Math.min(...starts));
  const footer = text.indexOf("女性向け同人作品の情報を、データで分かりやすく。");
  return (footer >= 0 ? text.slice(0, footer) : text).trim();
}

function productLinks(html) {
  return [...html.matchAll(/href="\/work\/([^"?]+)/g)].map((match) => match[1]);
}

const paths = [
  ["new-default", "/dlsite/female/doujin/new"],
  ["new-bl-page2", "/dlsite/female/doujin/new?contentType=bl&page=2&limit=30"],
  ["new-comic", "/dlsite/female/doujin/new?workType=comic&limit=50"],
  ["sale-default", "/dlsite/female/doujin/sale"],
  ["sale-rate", "/dlsite/female/doujin/sale?sort=discountRate&discountRate=30"],
  ["sale-bl", "/dlsite/female/doujin/sale?contentType=bl&workType=voice&limit=50"],
];

const results = [];
for (const [name, path] of paths) {
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
  assert.equal(functionalText(compactHtml), functionalText(legacyHtml), `${name}: visible text mismatch`);
  const legacyIds = productLinks(legacyHtml);
  const compactIds = productLinks(compactHtml);
  assert.deepEqual(compactIds, legacyIds, `${name}: product order mismatch`);
  results.push({ name, status: 200, equal: true, productLinks: legacyIds.length });
}

console.log(JSON.stringify({ legacyOrigin, compactOrigin, results }, null, 2));
