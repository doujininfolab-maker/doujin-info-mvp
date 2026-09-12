import assert from "node:assert/strict";

const urls = [
  "/dlsite/female/doujin/genre/dlsite%3Atest",
  "/dlsite/female/doujin/genre/dlsite%3Atest?contentType=tl&limit=50&page=2",
  "/dlsite/female/doujin/genre/dlsite%3Atest?contentType=bl&workType=voice&limit=200",
  "/dlsite/female/doujin/genre/dlsite%3Asmall",
  "/dlsite/female/doujin/genre/unknown",
  "/work/dlsite_doujin_INITIAL",
  "/dlsite/female/doujin/circle/RG0",
  "/dlsite/female/doujin/new",
  "/dlsite/female/doujin/ranking",
  "/dlsite/female/doujin/sale",
  "/search?q=%E6%A4%9C%E8%A8%BC",
  "/api/trends/product/dlsite_doujin_INITIAL?days=365",
];
const cards = (html) => html.match(/<article class="productCard[\s\S]*?<\/article>/g) ?? [];
for (const path of urls) {
  const responses = await Promise.all([3155, 3156].map(async (port) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, `${port} ${path}`);
    return response.text();
  }));
  assert.deepEqual(cards(responses[0]), cards(responses[1]), path);
  if (path.startsWith("/api/")) assert.deepEqual(JSON.parse(responses[0]), JSON.parse(responses[1]));
  console.log(JSON.stringify({ path, status: 200, cards: cards(responses[0]).length, parity: true }));
}
const text = await (await fetch("http://127.0.0.1:3155/robots.txt")).text();
assert.match(text, /User-Agent: Meta-ExternalAgent\nUser-Agent: Amazonbot\nDisallow: \//i);
assert.match(text, /User-Agent: \*\nAllow: \/\nDisallow: \/api\/\nDisallow: \/search/i);
assert.doesNotMatch(text, /facebookexternalhit|Amzn-SearchBot|Googlebot/i);
console.log("HTTP comparison and robots output passed.");
