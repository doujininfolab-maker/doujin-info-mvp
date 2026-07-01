import type { ProductContentType, ProductImage, ProductRatingBreakdown, ProductWorkType, RawProductDetail, RankingType } from "../../types";
import type { RankingFetchOptions, RankingFetchResult, SourceAdapter } from "../types";
import { BlockedAccessError } from "../types";
import { normalizeProduct } from "../../normalizers/normalizeProduct";

const target = {
  platform: "dlsite" as const,
  audience: "female" as const,
  category: "doujin" as const,
  rankingType: "daily" as const,
};

const DLSITE_GIRLS_BASE_URL = "https://www.dlsite.com/girls";
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const USER_AGENT =
  "doujin-info-mvp/0.1 (+https://doujin-info-mvp.web.app; low-frequency public-page fetcher)";

const sourceProductIdHints = new Map<string, Set<RankingType>>();

const listUrls: Partial<Record<RankingType, string[]>> = {
  daily: [`${DLSITE_GIRLS_BASE_URL}/ranking/day`],
  // DLsiteの一覧URLはフロア/カテゴリ構成変更で404になりやすいため、
  // doujin絞り込みURLが使えない場合は女性向け全体の新着/セールにフォールバックする。
  new: [
    `${DLSITE_GIRLS_BASE_URL}/works/=/work_type_category/doujin/order/release_d`,
    `${DLSITE_GIRLS_BASE_URL}/works/=/work_type/doujin/order/release_d`,
    `${DLSITE_GIRLS_BASE_URL}/works/=/category/doujin/order/release_d`,
    `${DLSITE_GIRLS_BASE_URL}/works/=/order/release_d`,
  ],
  sale: [
    `${DLSITE_GIRLS_BASE_URL}/works/=/work_type_category/doujin/options_and_or/and/options%5B0%5D/discount/order/trend`,
    `${DLSITE_GIRLS_BASE_URL}/works/=/options_and_or/and/options%5B0%5D/discount/order/trend`,
    `${DLSITE_GIRLS_BASE_URL}/works/=/order/trend/options_and_or/and/options%5B0%5D/discount`,
  ],
};

function getListLimit(options?: RankingFetchOptions): number {
  const rawLimit = options?.listLimit ?? Number(process.env.DLSITE_LIST_LIMIT ?? DEFAULT_LIST_LIMIT);
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIST_LIMIT);
}

function buildSourceUrl(sourceProductId: string): string {
  return `${DLSITE_GIRLS_BASE_URL}/work/=/product_id/${sourceProductId}.html`;
}

function buildAbsoluteUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = decodeHtml(url.trim());
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("/")) return `https://www.dlsite.com${trimmed}`;
  return new URL(trimmed, DLSITE_GIRLS_BASE_URL).toString();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function stripTags(html: string): string {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function cleanText(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const cleaned = stripTags(value).replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function toNumber(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const normalized = decodeHtml(value).replace(/[^0-9.]/g, "");
  if (!normalized) return undefined;
  const num = Number(normalized);
  return Number.isFinite(num) ? num : undefined;
}

function uniq(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => cleanText(value)).filter((value): value is string => Boolean(value)))];
}

function normalizeReleaseDate(value: string | undefined): string | undefined {
  const match = value?.match(/(\d{4})[/.年-](\d{1,2})[/.月-](\d{1,2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function matchFirst(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeHtml(match[1]);
  }
  return undefined;
}

function findMetaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return matchFirst(html, [
    new RegExp(`<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`, "i"),
  ]);
}

function extractProductIds(html: string): string[] {
  const ids = new Set<string>();
  const patterns = [
    /product_id\/(RJ\d{6,10})\.html/gi,
    /product_id[=/](RJ\d{6,10})/gi,
    /\b(RJ\d{6,10})\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      ids.add(match[1].toUpperCase());
    }
  }

  return [...ids];
}


function extractAnchorTexts(html: string, hrefPattern: RegExp, limit: number): string[] {
  const values: string[] = [];
  const anchorPattern = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const href = decodeHtml(match[2] ?? "");
    hrefPattern.lastIndex = 0;
    if (!hrefPattern.test(href)) continue;

    const text = cleanText(match[3]);
    if (text) values.push(text);
    if (values.length >= limit) break;
  }

  return uniq(values).slice(0, limit);
}

function isDlsiteGenreNoise(value: string): boolean {
  return (
    /^\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{2}\s*まで$/.test(value) ||
    /^(R18|全年齢|マンガ|漫画|コミック|JPEG|JPG|PNG|PDF|ZIP|MP3|WAV|動画|ゲーム|音声|ドラマCD|乙女向け|女性向け|男性向け|成人向け)$/i.test(value)
  );
}


type NormalizedWorkType = {
  workType: ProductWorkType;
  workTypeLabel: string;
};

const DLSITE_WORK_TYPE_CODE_MAP: Record<string, NormalizedWorkType> = {
  MNG: { workType: "comic", workTypeLabel: "マンガ" },
  COM: { workType: "comic", workTypeLabel: "マンガ" },
  ICG: { workType: "cg", workTypeLabel: "CG" },
  CG: { workType: "cg", workTypeLabel: "CG" },
  MOV: { workType: "movie", workTypeLabel: "動画" },
  AVI: { workType: "movie", workTypeLabel: "動画" },
  SND: { workType: "voice", workTypeLabel: "音声" },
  SOU: { workType: "voice", workTypeLabel: "音声" },
  MUS: { workType: "voice", workTypeLabel: "音声" },
  GAM: { workType: "game", workTypeLabel: "ゲーム" },
  RPG: { workType: "game", workTypeLabel: "ゲーム" },
  ADV: { workType: "game", workTypeLabel: "ゲーム" },
  ACT: { workType: "game", workTypeLabel: "ゲーム" },
  STG: { workType: "game", workTypeLabel: "ゲーム" },
  SLN: { workType: "game", workTypeLabel: "ゲーム" },
  TBL: { workType: "game", workTypeLabel: "ゲーム" },
  PZL: { workType: "game", workTypeLabel: "ゲーム" },
  QIZ: { workType: "game", workTypeLabel: "ゲーム" },
};

function normalizeWorkTypeFromText(value: string | undefined): NormalizedWorkType | undefined {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return undefined;

  if (/マンガ|漫画|コミック|manga|comic/.test(text)) return { workType: "comic", workTypeLabel: "マンガ" };
  if (/cg|イラスト|illust|画像/.test(text)) return { workType: "cg", workTypeLabel: "CG" };
  if (/動画|ムービー|movie|video|アニメーション/.test(text)) return { workType: "movie", workTypeLabel: "動画" };
  if (/ゲーム|game|rpg|ロールプレイング|アドベンチャー|シミュレーション|アクション|シューティング|パズル|クイズ/.test(text)) {
    return { workType: "game", workTypeLabel: "ゲーム" };
  }
  if (/音声|asmr|ボイス|voice|ドラマcd|ボイスドラマ|サウンド|sound|音楽/.test(text)) return { workType: "voice", workTypeLabel: "音声" };
  return undefined;
}

function normalizeWorkTypeFromCode(value: string | undefined): NormalizedWorkType | undefined {
  const code = value?.trim().toUpperCase();
  if (!code) return undefined;
  return DLSITE_WORK_TYPE_CODE_MAP[code];
}

function extractDlsiteWorkType(html: string, text: string): NormalizedWorkType {
  // DLsiteの商品詳細では以下のように作品形式が出る。
  //   <div class="work_genre" id="category_type">
  //     <a href=".../works/type/=/work_type/MNG/...">
  //       <span class="icon MNG" title="マンガ">マンガ</span>
  //     </a>
  //   </div>
  const categoryTypeBlock = matchFirst(html, [
    /<div\b[^>]*id=["']category_type["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div\b[^>]*class=["'][^"']*\bwork_genre\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]);

  if (categoryTypeBlock) {
    const codeFromHref = matchFirst(categoryTypeBlock, [/work_type\/([A-Za-z0-9_]+)/i]);
    const byHref = normalizeWorkTypeFromCode(codeFromHref);
    if (byHref) return byHref;

    const codeFromClass = matchFirst(categoryTypeBlock, [/class=["'][^"']*\bicon\s+([A-Za-z0-9_]+)\b[^"']*["']/i]);
    const byClass = normalizeWorkTypeFromCode(codeFromClass);
    if (byClass) return byClass;

    const title = matchFirst(categoryTypeBlock, [/title=["']([^"']+)["']/i]);
    const byTitle = normalizeWorkTypeFromText(title);
    if (byTitle) return byTitle;

    const byText = normalizeWorkTypeFromText(categoryTypeBlock);
    if (byText) return byText;
  }

  const rowPattern = /<tr[^>]*>\s*<t[hd][^>]*>\s*(?:作品形式|作品タイプ|形式)\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/i;
  const byRow = normalizeWorkTypeFromText(matchFirst(html, [rowPattern]));
  if (byRow) return byRow;

  const byFullText = normalizeWorkTypeFromText(text);
  return byFullText ?? { workType: "other", workTypeLabel: "その他" };
}



type NormalizedContentType = {
  contentType: ProductContentType;
  contentTypeLabel: string;
};

const DLSITE_CONTENT_TYPE_CODE_MAP: Record<string, NormalizedContentType> = {
  OTM: { contentType: "tl", contentTypeLabel: "TL" },
  TL: { contentType: "tl", contentTypeLabel: "TL" },
  TL1: { contentType: "tl", contentTypeLabel: "TL" },
  TLG: { contentType: "tl", contentTypeLabel: "TL" },
  BL: { contentType: "bl", contentTypeLabel: "BL" },
  BL1: { contentType: "bl", contentTypeLabel: "BL" },
  BLG: { contentType: "bl", contentTypeLabel: "BL" },
};

function normalizeContentTypeFromCode(value: string | undefined): NormalizedContentType | undefined {
  const code = value?.trim().toUpperCase();
  if (!code) return undefined;
  return DLSITE_CONTENT_TYPE_CODE_MAP[code];
}

function normalizeContentTypeFromText(value: string | undefined): NormalizedContentType | undefined {
  const text = cleanText(value);
  if (!text) return undefined;

  if (/ボーイズラブ|ＢＬ|BL/i.test(text)) return { contentType: "bl", contentTypeLabel: "BL" };
  if (/乙女向け|ティーンズラブ|ＴＬ|TL/i.test(text)) return { contentType: "tl", contentTypeLabel: "TL" };
  return undefined;
}

function pushNormalizedContentType(
  map: Map<ProductContentType, NormalizedContentType>,
  item: NormalizedContentType | undefined,
): void {
  if (!item) return;
  map.set(item.contentType, item);
}

function extractDlsiteContentTypes(html: string): NormalizedContentType[] {
  const found = new Map<ProductContentType, NormalizedContentType>();

  // DLsiteの商品詳細では以下のようにTL/BL系のカテゴリが出る。
  //   <a href=".../coupling_option/OTM/from/icon.work">
  //     <span class="icon OTM" title="乙女向け">乙女向け</span>
  //   </a>
  //   <a href=".../coupling_option/BL1/from/icon.work">
  //     <span class="icon BL1" title="ボーイズラブ">ボーイズラブ</span>
  //   </a>
  const anchorPattern = /<a\b([^>]*href=["']([^"']*coupling_option\/([^\/"']+)[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const codeFromHref = match[3];
    const body = match[4] ?? "";
    const codeFromClass = matchFirst(body, [/class=["'][^"']*\bicon\s+([A-Za-z0-9_]+)\b[^"']*["']/i]);
    const title = matchFirst(body, [/title=["']([^"']+)["']/i]) ?? matchFirst(attributes, [/title=["']([^"']+)["']/i]);

    pushNormalizedContentType(found, normalizeContentTypeFromCode(codeFromHref));
    pushNormalizedContentType(found, normalizeContentTypeFromCode(codeFromClass));
    pushNormalizedContentType(found, normalizeContentTypeFromText(title));
    pushNormalizedContentType(found, normalizeContentTypeFromText(body));
  }

  if (found.size === 0) {
    const rowPattern = /<tr[^>]*>\s*<t[hd][^>]*>\s*(?:その他|カテゴリ|対象)\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    for (const match of html.matchAll(rowPattern)) {
      pushNormalizedContentType(found, normalizeContentTypeFromText(match[1]));
    }
  }

  return Array.from(found.values());
}

function extractDlsiteMainGenres(html: string): string[] {
  const values: string[] = [];
  const mainGenrePattern = /<div\b[^>]*class=["'][^"']*\bmain_genre\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

  for (const match of html.matchAll(mainGenrePattern)) {
    values.push(...extractAnchorTexts(match[1] ?? "", /\/genre\/\d+\//i, 30));
  }

  // DLsiteのテンプレート差分に備え、テーブル行の「ジャンル」欄もフォールバックで見る。
  if (values.length === 0) {
    const rowPattern = /<tr[^>]*>\s*<t[hd][^>]*>\s*(?:ジャンル|作品ジャンル)\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    for (const match of html.matchAll(rowPattern)) {
      values.push(...extractAnchorTexts(match[1] ?? "", /\/genre\/\d+\//i, 30));
    }
  }

  return uniq(values)
    .filter((value) => !isDlsiteGenreNoise(value))
    .slice(0, 20);
}

function extractSeller(html: string): { sellerId?: string; sellerName?: string; sellerUrl?: string } {
  const makerMatch = html.match(/<a\b([^>]*href=["']([^"']*maker_id\/(RG\d+)[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/i);
  if (!makerMatch) return {};

  return {
    sellerId: makerMatch[3],
    sellerName: cleanText(makerMatch[4]),
    sellerUrl: buildAbsoluteUrl(makerMatch[2]),
  };
}

function normalizeImageUrlForKey(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}

function decodeJsEscapedUrl(value: string): string {
  return decodeHtml(value)
    .replace(/\\\//g, "/")
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\u003a/gi, ":")
    .replace(/\\u002d/gi, "-")
    .replace(/\\u005f/gi, "_")
    .replace(/\\/g, "");
}

function imageSortScore(url: string): number {
  const normalized = normalizeImageUrlForKey(url);
  const sampleMatch = normalized.match(/(?:_img_)?(?:smp|sam|sample)_?(\d+)/i);

  if (/_img_main|_main\.|work_main/i.test(normalized)) {
    return 0;
  }

  if (sampleMatch?.[1]) {
    return 100 + Number(sampleMatch[1]);
  }

  if (/smp|sam|sample/i.test(normalized)) {
    return 200;
  }

  return 500;
}

function canonicalImageKey(url: string, sourceProductId: string): string {
  const normalized = normalizeImageUrlForKey(url);
  const escapedId = sourceProductId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`${escapedId}_img_(main|smp_?\\d+|sam_?\\d+|sample_?\\d+)`, "i"));

  if (match?.[1]) {
    return `${sourceProductId}_img_${match[1].replace(/_/g, "").toLowerCase()}`;
  }

  return normalized.replace(/_\d+x\d+\.(?:jpg|jpeg|png|webp)$/i, "").toLowerCase();
}

function isLikelyWorkImage(url: string, sourceProductId: string): boolean {
  const normalized = normalizeImageUrlForKey(url);
  const lower = normalized.toLowerCase();

  if (!lower.includes(sourceProductId.toLowerCase())) {
    return false;
  }

  if (!/\.(?:jpg|jpeg|png|webp)$/i.test(normalized)) {
    return false;
  }

  if (/logo|banner|bnr|button|icon|sprite|common|campaign|affiliate|favicon/i.test(normalized)) {
    return false;
  }

  return true;
}

function pushImageCandidate(candidates: string[], rawValue: string | undefined | null): void {
  if (!rawValue) return;

  const normalizedValue = decodeJsEscapedUrl(rawValue.trim());
  if (!normalizedValue) return;

  // srcset は "url 1x, url 2x" の形式になるため、URL部分だけを候補にする。
  const parts = normalizedValue
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);

  for (const part of parts) {
    const url = buildAbsoluteUrl(part);
    if (url) candidates.push(url);
  }
}

type DlsiteAjaxInfo = {
  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  salesCount?: number;
  rating?: number;
  reviewCount?: number;
  ratingBreakdown?: ProductRatingBreakdown[];
  releaseDate?: string;
};

function buildDisplayImageUrl(url: string): string {
  const normalized = normalizeImageUrlForKey(decodeJsEscapedUrl(url));
  const absolute = buildAbsoluteUrl(normalized) ?? normalized;

  // DLsiteのサムネイルは以下のような resize URL になっている。
  //   /resize/images2/work/doujin/RJ01638000/RJ01637636_img_smp1_100x100.webp
  // 画面のメイン表示には、同じファイル名の原寸寄りURLを使う。
  return absolute
    .replace("/resize/", "/modpub/")
    .replace(/_(?:\d+x\d+|[wh]\d+)\.(?:jpg|jpeg|png|webp)$/i, ".jpg")
    .replace(/\.webp$/i, ".jpg");
}

function buildThumbnailImageUrl(url: string): string {
  // DLsite の resize/webp サムネイルはブラウザ表示で壊れることがあるため、
  // サイト側では表示確認済みの modpub/jpg URL をサムネイルにも使う。
  // 取得時に追加リクエストは行わないので、v6 のように遅くならない。
  return buildDisplayImageUrl(url);
}

function extractImageUrlsFromHtml(html: string, sourceProductId: string): Array<{ displayUrl: string; thumbnailUrl: string }> {
  const rawCandidates: string[] = [];
  const escapedId = sourceProductId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const normalizedHtml = decodeJsEscapedUrl(html);

  const ogImage = findMetaContent(html, "og:image");
  pushImageCandidate(rawCandidates, ogImage);

  // DLsiteの作品画像は、メイン画像だけでなく、サムネイル部の
  // src / srcset / data-src / href に入っていることが多い。
  // 例:
  //   //img.dlsite.jp/resize/images2/work/doujin/RJ01638000/RJ01637636_img_smp1_100x100.webp
  const attrPattern = /\b(?:src|data-src|data-original|data-lazy|data-srcset|srcset|href)=(['"])([\s\S]*?)\1/gi;
  for (const match of normalizedHtml.matchAll(attrPattern)) {
    pushImageCandidate(rawCandidates, match[2]);
  }

  const absoluteUrlPattern = new RegExp(
    String.raw`(?:https?:)?//[^"'<>\s\)\]]*${escapedId}[^"'<>\s\)\]]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s\)\]]*)?`,
    "gi",
  );
  for (const match of normalizedHtml.matchAll(absoluteUrlPattern)) {
    pushImageCandidate(rawCandidates, match[0]);
  }

  const relativeUrlPattern = new RegExp(
    String.raw`/(?:resize|modpub)/images2/work/[^"'<>\s\)\]]*${escapedId}[^"'<>\s\)\]]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s\)\]]*)?`,
    "gi",
  );
  for (const match of normalizedHtml.matchAll(relativeUrlPattern)) {
    pushImageCandidate(rawCandidates, match[0]);
  }

  return rawCandidates
    .map((rawUrl) => ({
      displayUrl: buildDisplayImageUrl(rawUrl),
      thumbnailUrl: buildThumbnailImageUrl(rawUrl),
    }))
    .filter(({ displayUrl, thumbnailUrl }) =>
      isLikelyWorkImage(displayUrl, sourceProductId) || isLikelyWorkImage(thumbnailUrl, sourceProductId),
    );
}

function mergeDlsiteAjaxInfo(base: DlsiteAjaxInfo, next: DlsiteAjaxInfo): DlsiteAjaxInfo {
  return {
    priceCurrent: base.priceCurrent ?? next.priceCurrent,
    priceOriginal: base.priceOriginal ?? next.priceOriginal,
    discountRate: base.discountRate ?? next.discountRate,
    salesCount: base.salesCount ?? next.salesCount,
    rating: base.rating ?? next.rating,
    reviewCount: base.reviewCount ?? next.reviewCount,
    ratingBreakdown: base.ratingBreakdown && base.ratingBreakdown.length > 0 ? base.ratingBreakdown : next.ratingBreakdown,
    releaseDate: base.releaseDate ?? next.releaseDate,
  };
}

function parseDlsiteAjaxInfo(parsed: unknown): DlsiteAjaxInfo {
  const values = flattenJsonValues(parsed);
  const info: DlsiteAjaxInfo = {};

  info.salesCount = firstNumberByKey(values, ["dl_count", "dlCount", "download_count", "downloadCount", "sales_count", "salesCount"]);
  info.rating = firstNumberByKey(values, ["rate_average_2dp", "rateAverage2dp", "rate_average", "rateAverage", "ratingValue"]);
  info.reviewCount = firstNumberByKey(values, ["rate_count", "rateCount", "rating_count", "ratingCount", "review_count", "reviewCount"]);
  info.priceCurrent = firstNumberByKey(values, ["price", "priceCurrent", "price_current", "work_price"]);
  info.priceOriginal = firstNumberByKey(values, ["official_price", "priceOriginal", "price_original", "regular_price", "base_price"]);
  info.discountRate = firstNumberByKey(values, ["discount_rate", "discountRate", "discount"]);
  info.releaseDate = normalizeReleaseDate(firstStringByKey(values, ["regist_date", "release_date", "releaseDate", "datePublished"]));
  info.ratingBreakdown = findRatingBreakdownInJson(parsed, info.rating);

  return info;
}

async function fetchProductInfoAjax(sourceProductId: string): Promise<DlsiteAjaxInfo> {
  const urls = [
    `${DLSITE_GIRLS_BASE_URL}/product/info/ajax?product_id=${sourceProductId}`,
    `${DLSITE_GIRLS_BASE_URL}/product/info/ajax?product_id[]=${sourceProductId}`,
  ];

  let merged: DlsiteAjaxInfo = {};

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "user-agent": USER_AGENT,
          accept: "application/json,text/javascript,*/*;q=0.8",
          "accept-language": "ja,en;q=0.8",
          referer: buildSourceUrl(sourceProductId),
        },
      });
      if (!response.ok) continue;

      const text = await response.text();
      const parsed = JSON.parse(text) as unknown;
      merged = mergeDlsiteAjaxInfo(merged, parseDlsiteAjaxInfo(parsed));

      // product_id と product_id[] で返る項目が微妙に違うことがある。
      // 評価内訳が取れた時点では十分だが、取れない場合は次のURLも試す。
      if (merged.ratingBreakdown && merged.ratingBreakdown.length > 0) {
        return merged;
      }
    } catch {
      // 公開ページHTMLのパース結果を優先して処理継続する。
    }
  }

  return merged;
}

function flattenJsonValues(value: unknown, prefix = ""): Map<string, unknown> {
  const result = new Map<string, unknown>();

  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      for (const [key, childValue] of flattenJsonValues(item, `${prefix}${index}.`)) {
        result.set(key, childValue);
      }
    });
    return result;
  }

  if (value && typeof value === "object") {
    for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
      result.set(key, childValue);
      for (const [childKey, grandChildValue] of flattenJsonValues(childValue, `${prefix}${key}.`)) {
        result.set(childKey, grandChildValue);
      }
    }
  }

  return result;
}

function firstNumberByKey(values: Map<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = values.get(key);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = toNumber(value);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function firstStringByKey(values: Map<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = values.get(key);
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

async function extractImages(html: string, sourceProductId: string): Promise<ProductImage[]> {
  // v6では smp1..smp16 を推測してHEAD確認していたが、
  // DLsite側へのリクエスト数が増えてFunctionが遅くなるため廃止。
  // v7ではページHTML内に実際に出ている main/smp サムネイルURLを直接拾い、
  // resize URL から表示用の modpub URLを機械的に作る。
  const pairs = extractImageUrlsFromHtml(html, sourceProductId);

  const byKey = new Map<string, { displayUrl: string; thumbnailUrl: string }>();
  const sortedPairs = pairs.sort((a, b) => imageSortScore(a.displayUrl) - imageSortScore(b.displayUrl));

  for (const pair of sortedPairs) {
    const key = canonicalImageKey(pair.displayUrl, sourceProductId);
    const existing = byKey.get(key);

    // 同じ画像の resize / modpub が混在する場合は、表示用はmodpub寄り、サムネは実在するresize寄りを残す。
    if (!existing) {
      byKey.set(key, pair);
      continue;
    }

    byKey.set(key, {
      displayUrl: existing.displayUrl.includes("/resize/") ? pair.displayUrl : existing.displayUrl,
      thumbnailUrl: pair.thumbnailUrl.includes("/resize/") ? pair.thumbnailUrl : existing.thumbnailUrl,
    });
  }

  const urls = [...byKey.values()]
    .sort((a, b) => imageSortScore(a.displayUrl) - imageSortScore(b.displayUrl))
    .slice(0, 16);

  return urls.map((image, index) => ({
    url: image.displayUrl,
    thumbnailUrl: image.thumbnailUrl,
    type: index === 0 ? "main" : "sample",
    displayOrder: index,
  }));
}

function extractJsonLikeNumber(html: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = matchFirst(html, [
      new RegExp(`["']${escaped}["']\\s*:\\s*["']?([0-9][0-9,.]*)`, "i"),
      new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*["']?([0-9][0-9,.]*)`, "i"),
      new RegExp(`data-${escaped.replace(/_/g, "-")}=["']([0-9][0-9,.]*)["']`, "i"),
    ]);
    const parsed = toNumber(value);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function extractRating(html: string, text: string): number | undefined {
  return (
    toNumber(matchFirst(html, [
      /itemprop=["']ratingValue["'][^>]+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]+itemprop=["']ratingValue["']/i,
      /data-(?:rating|rate|score)=["']([0-9.]+)["']/i,
    ])) ??
    extractJsonLikeNumber(html, [
      "rate_average_2dp",
      "rateAverage2dp",
      "rate_average",
      "rateAverage",
      "ratingValue",
      "rating_average",
      "average_rating",
      "work_rating",
    ]) ??
    toNumber(text.match(/評価\s*[:：]?\s*([0-9.]+)/)?.[1]) ??
    toNumber(text.match(/([0-9.]+)\s*\/\s*5/)?.[1])
  );
}

function extractEvaluationCount(html: string, text: string): number | undefined {
  return (
    extractJsonLikeNumber(html, [
      "ratingCount",
      "rating_count",
      "rateCount",
      "rate_count",
      "evaluationCount",
      "evaluation_count",
      "reviewCount",
      "review_count",
    ]) ??
    toNumber(matchFirst(html, [
      /itemprop=["']reviewCount["'][^>]+content=["']([^"']+)["']/i,
      /content=["']([^"']+)["'][^>]+itemprop=["']reviewCount["']/i,
    ])) ??
    toNumber(text.match(/評価\s*[:：]?\s*[0-9.]+[\s\S]{0,120}?\(([0-9,]+)\)/)?.[1]) ??
    toNumber(text.match(/評価数\s*[:：]?\s*([0-9,]+)/)?.[1]) ??
    toNumber(text.match(/評価(?:件数)?\s*[:：]?\s*([0-9,]+)\s*件/)?.[1]) ??
    toNumber(text.match(/([0-9,]+)\s*件の評価/)?.[1]) ??
    toNumber(text.match(/レビュー(?:数)?\s*[:：]?\s*([0-9,]+)/)?.[1]) ??
    toNumber(text.match(/([0-9,]+)\s*件のレビュー/)?.[1])
  );
}


function normalizeRatingBreakdown(
  counts: number[],
  rating?: number,
): ProductRatingBreakdown[] | undefined {
  if (counts.length < 5) return undefined;

  const firstFive = counts.slice(0, 5).map((count) => Math.max(0, Math.floor(count || 0)));
  if (firstFive.every((count) => count === 0)) return undefined;

  const ascending = firstFive.map((count, index) => ({ star: (index + 1) as 1 | 2 | 3 | 4 | 5, count }));
  const descending = firstFive.map((count, index) => ({ star: (5 - index) as 1 | 2 | 3 | 4 | 5, count }));

  if (rating !== undefined && rating > 0) {
    const score = (items: ProductRatingBreakdown[]) => {
      const total = items.reduce((sum, item) => sum + item.count, 0);
      if (total <= 0) return Number.MAX_SAFE_INTEGER;
      const average = items.reduce((sum, item) => sum + item.star * item.count, 0) / total;
      return Math.abs(average - rating);
    };

    return score(descending) < score(ascending) ? descending : ascending;
  }

  const averageAscending = ascending.reduce((sum, item) => sum + item.star * item.count, 0) / firstFive.reduce((sum, count) => sum + count, 0);
  const averageDescending = descending.reduce((sum, item) => sum + item.star * item.count, 0) / firstFive.reduce((sum, count) => sum + count, 0);
  return averageDescending >= averageAscending ? descending : ascending;
}

function normalizeExplicitRatingBreakdown(
  byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>>,
): ProductRatingBreakdown[] | undefined {
  const items = ([5, 4, 3, 2, 1] as const).map((star) => ({
    star,
    count: Math.max(0, Math.floor(byStar[star] ?? 0)),
  }));

  if (items.every((item) => item.count === 0)) return undefined;
  return items;
}

function setRatingBreakdownCount(
  byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>>,
  star: number | undefined,
  count: number | undefined,
): void {
  if (star !== 1 && star !== 2 && star !== 3 && star !== 4 && star !== 5) return;
  if (count === undefined || !Number.isFinite(count) || count < 0) return;
  byStar[star] = Math.max(0, Math.floor(count));
}

function findStarCountInObject(record: Record<string, unknown>): { star?: number; count?: number } {
  let star: number | undefined;
  let count: number | undefined;

  for (const [key, rawValue] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    const numberValue = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? toNumber(rawValue) : undefined;

    if (numberValue === undefined) continue;

    if (/^(?:star|stars|rate|rating|score|level|rank|評価|星)$/i.test(lowerKey)) {
      star = numberValue;
      continue;
    }

    if (/(?:count|num|total|件数|votes?|review|rate_count)$/i.test(lowerKey)) {
      count = numberValue;
    }
  }

  return { star, count };
}

function extractRatingBreakdownFromObject(
  value: unknown,
  rating?: number,
): ProductRatingBreakdown[] | undefined {
  if (!value || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};

    for (const item of value) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const { star, count } = findStarCountInObject(item as Record<string, unknown>);
      setRatingBreakdownCount(byStar, star, count);
    }

    const explicit = normalizeExplicitRatingBreakdown(byStar);
    if (explicit) return explicit;

    const counts = value
      .map((item) => (typeof item === "number" ? item : typeof item === "string" ? toNumber(item) : undefined))
      .filter((item): item is number => item !== undefined);
    return normalizeRatingBreakdown(counts, rating);
  }

  const record = value as Record<string, unknown>;
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    const starMatch =
      key.match(/(?:star|stars|rate|rating|score|評価|星)[_-]?([1-5])(?:[_-]?(?:count|num|total|件数))?$/i) ??
      key.match(/(?:count|num|total|件数)[_-]?([1-5])$/i) ??
      key.match(/^([1-5])$/);
    if (!starMatch?.[1]) continue;
    const count = typeof rawValue === "number" ? rawValue : typeof rawValue === "string" ? toNumber(rawValue) : undefined;
    setRatingBreakdownCount(byStar, Number(starMatch[1]), count);
  }

  return normalizeExplicitRatingBreakdown(byStar);
}

function findRatingBreakdownInJson(
  value: unknown,
  rating?: number,
  depth = 0,
): ProductRatingBreakdown[] | undefined {
  if (depth > 10 || !value || typeof value !== "object") return undefined;

  if (Array.isArray(value)) {
    const direct = extractRatingBreakdownFromObject(value, rating);
    if (direct) return direct;

    for (const item of value) {
      const found = findRatingBreakdownInJson(item, rating, depth + 1);
      if (found) return found;
    }
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = extractRatingBreakdownFromObject(record, rating);
  if (direct) return direct;

  for (const [key, childValue] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    if (
      /(?:rate|rating|review|evaluation|star|score)/.test(lowerKey) &&
      /(?:breakdown|detail|star|distribution|count|histogram|summary)/.test(lowerKey)
    ) {
      const found = extractRatingBreakdownFromObject(childValue, rating) ?? findRatingBreakdownInJson(childValue, rating, depth + 1);
      if (found) return found;
    }
  }

  for (const childValue of Object.values(record)) {
    const found = findRatingBreakdownInJson(childValue, rating, depth + 1);
    if (found) return found;
  }

  return undefined;
}

function extractRatingBreakdownFromText(text: string): ProductRatingBreakdown[] | undefined {
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};
  const normalizedText = decodeHtml(text).replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

  for (const star of [5, 4, 3, 2, 1] as const) {
    const patterns = [
      new RegExp(`星\\s*${star}\\s*つ?[\\s\\S]{0,120}?[（(]\\s*([0-9][0-9,]*)\\s*[)）]`, "i"),
      new RegExp(`星\\s*${star}\\s*つ?[\\s\\S]{0,60}?([0-9][0-9,]*)`, "i"),
      new RegExp(`${star}\\s*つ星[\\s\\S]{0,120}?[（(]\\s*([0-9][0-9,]*)\\s*[)）]`, "i"),
      new RegExp(`${star}\\s*つ星[\\s\\S]{0,60}?([0-9][0-9,]*)`, "i"),
      new RegExp(`★\\s*${star}[\\s\\S]{0,60}?([0-9][0-9,]*)`, "i"),
    ];

    for (const pattern of patterns) {
      const match = normalizedText.match(pattern);
      const count = toNumber(match?.[1]);
      if (count !== undefined) {
        byStar[star] = Math.max(0, Math.floor(count));
        break;
      }
    }
  }

  return normalizeExplicitRatingBreakdown(byStar);
}

function extractRatingBreakdownFromDlsiteRatingMap(html: string): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};

  // DLsiteのhover後DOMは概ね以下の形。
  //   <dt class="rating_map_label"><p>星5つ</p></dt> ... <dd>(403)</dd>
  // タグの入れ子が崩れていても拾えるよう、rating_map_label から次の count dd を短い範囲で探す。
  const labelPattern = /class=["'][^"']*\brating_map_label\b[^"']*["'][\s\S]{0,240}?星\s*([1-5])\s*つ?[\s\S]{0,900}?[（(]\s*([0-9][0-9,]*)\s*[)）]/gi;
  for (const match of normalizedHtml.matchAll(labelPattern)) {
    setRatingBreakdownCount(byStar, Number(match[1]), toNumber(match[2]));
  }

  const direct = normalizeExplicitRatingBreakdown(byStar);
  if (direct) return direct;

  // class名が削られた断片にも対応。星ラベルの直後、次の星ラベルまでの最後の括弧数字を件数とする。
  for (const star of [5, 4, 3, 2, 1] as const) {
    const startMatch = normalizedHtml.match(new RegExp(`星\\s*${star}\\s*つ?`, "i"));
    if (!startMatch || startMatch.index === undefined) continue;

    const startIndex = startMatch.index + startMatch[0].length;
    const nextStars = ([5, 4, 3, 2, 1] as const)
      .filter((nextStar) => nextStar !== star)
      .map((nextStar) => normalizedHtml.slice(startIndex).search(new RegExp(`星\\s*${nextStar}\\s*つ?`, "i")))
      .filter((index) => index >= 0);
    const endIndex = nextStars.length > 0 ? startIndex + Math.min(...nextStars) : Math.min(normalizedHtml.length, startIndex + 1200);
    const chunk = stripTags(normalizedHtml.slice(startIndex, endIndex));
    const parenNumbers = [...chunk.matchAll(/[（(]\s*([0-9][0-9,]*)\s*[)）]/g)]
      .map((match) => toNumber(match[1]))
      .filter((value): value is number => value !== undefined);

    if (parenNumbers.length > 0) {
      byStar[star] = Math.max(0, Math.floor(parenNumbers[parenNumbers.length - 1]));
    }
  }

  return normalizeExplicitRatingBreakdown(byStar);
}

function extractRatingBreakdownFromRatingRows(html: string): ProductRatingBreakdown[] | undefined {
  return extractRatingBreakdownFromDlsiteRatingMap(html);
}

function findClosingTagEnd(html: string, startIndex: number, tagName: string): number | undefined {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tagPattern = new RegExp(`</?${escapedTag}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = startIndex;
  let depth = 0;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html)) !== null) {
    const tag = match[0];
    if (tag.startsWith("</")) {
      depth -= 1;
      if (depth <= 0) return match.index + tag.length;
    } else if (!tag.endsWith("/>")) {
      depth += 1;
    }
  }

  return undefined;
}

function extractRatingBreakdownFromRatingPopup(html: string): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));
  const popupPattern = /<([a-z][a-z0-9]*)\b[^>]*(?:(?:class|id)=['"][^'"]*\brating_popup\b[^'"]*['"])[^>]*>/gi;

  for (const match of normalizedHtml.matchAll(popupPattern)) {
    const tagName = match[1];
    if (!tagName) continue;
    const startIndex = match.index ?? 0;
    const endIndex = findClosingTagEnd(normalizedHtml, startIndex, tagName) ?? Math.min(normalizedHtml.length, startIndex + 8000);
    const popupHtml = normalizedHtml.slice(startIndex, endIndex);
    const popupText = stripTags(popupHtml);

    const fromRows = extractRatingBreakdownFromRatingRows(popupHtml);
    if (fromRows) return fromRows;

    const fromText = extractRatingBreakdownFromText(popupText);
    if (fromText) return fromText;

    const fromAttrs = extractRatingBreakdownFromHtmlAttributes(popupHtml);
    if (fromAttrs) return fromAttrs;
  }

  return undefined;
}

function extractRatingBreakdownFromEmbeddedRatingPopupFragments(html: string): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));

  // hover時にDOMへ挿入されるHTMLが、script内の文字列/templateとして埋まっているケース用。
  // rating_popup / rating_map を含む周辺だけを切り出して、同じパーサにかける。
  const markerPatterns = [/rating_popup/gi, /rating_map_label/gi, /rating_map_body/gi];
  for (const markerPattern of markerPatterns) {
    for (const match of normalizedHtml.matchAll(markerPattern)) {
      const markerIndex = match.index ?? 0;
      const startIndex = Math.max(0, markerIndex - 2000);
      const endIndex = Math.min(normalizedHtml.length, markerIndex + 10000);
      const fragment = normalizedHtml.slice(startIndex, endIndex);

      const fromMap = extractRatingBreakdownFromDlsiteRatingMap(fragment);
      if (fromMap) return fromMap;

      const fromText = extractRatingBreakdownFromText(stripTags(fragment));
      if (fromText) return fromText;
    }
  }

  return undefined;
}


function extractRatingBreakdownFromHtmlAttributes(html: string): ProductRatingBreakdown[] | undefined {
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));

  const starThenCountPatterns = [
    /(?:star|stars|rate|rating|score|評価|星)[_-]?([1-5])[^>]{0,220}?(?:count|num|total|件数)["']?\s*[:=]\s*["']?([0-9,]+)/gi,
    /(?:data-star|data-rate|data-rating|data-score)["']?\s*=\s*["']?([1-5])["']?[^>]{0,220}?(?:data-count|data-num|data-total)["']?\s*=\s*["']?([0-9,]+)/gi,
  ];
  const countThenStarPatterns = [
    /(?:count|num|total|件数)["']?\s*[:=]\s*["']?([0-9,]+)[^>]{0,220}?(?:star|stars|rate|rating|score|評価|星)[_-]?([1-5])/gi,
    /(?:data-count|data-num|data-total)["']?\s*=\s*["']?([0-9,]+)["']?[^>]{0,220}?(?:data-star|data-rate|data-rating|data-score)["']?\s*=\s*["']?([1-5])["']?/gi,
  ];

  for (const pattern of starThenCountPatterns) {
    for (const match of normalizedHtml.matchAll(pattern)) {
      setRatingBreakdownCount(byStar, Number(match[1]), toNumber(match[2]));
    }
  }

  for (const pattern of countThenStarPatterns) {
    for (const match of normalizedHtml.matchAll(pattern)) {
      setRatingBreakdownCount(byStar, Number(match[2]), toNumber(match[1]));
    }
  }

  return normalizeExplicitRatingBreakdown(byStar);
}

function extractRatingBreakdown(html: string, text: string, rating?: number): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));
  const jsonPatterns = [
    /(?:rate|rating|review|evaluation)[_-]?(?:count)?[_-]?(?:detail|breakdown|distribution|histogram)\s*[=:]\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/gi,
    /["'](?:rate|rating|review|evaluation)[_-]?(?:count)?[_-]?(?:detail|breakdown|distribution|histogram)["']\s*:\s*(\[[\s\S]*?\]|\{[\s\S]*?\})/gi,
  ];

  for (const pattern of jsonPatterns) {
    for (const match of normalizedHtml.matchAll(pattern)) {
      const rawJson = match[1];
      if (!rawJson) continue;
      try {
        const parsed = JSON.parse(decodeJsEscapedUrl(rawJson).replace(/'/g, '"')) as unknown;
        const found = extractRatingBreakdownFromObject(parsed, rating);
        if (found) return found;
      } catch {
        // HTML本文からの抽出へフォールバックする。
      }
    }
  }

  const scriptPattern = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of normalizedHtml.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1] ?? "")) as unknown;
      const found = findRatingBreakdownInJson(parsed, rating);
      if (found) return found;
    } catch {
      // HTML本文からの抽出へフォールバックする。
    }
  }

  return (
    extractRatingBreakdownFromRatingPopup(normalizedHtml) ??
    extractRatingBreakdownFromEmbeddedRatingPopupFragments(normalizedHtml) ??
    extractRatingBreakdownFromHtmlAttributes(normalizedHtml) ??
    extractRatingBreakdownFromText(text)
  );
}

function extractSalesCount(html: string, text: string): number | undefined {
  return (
    extractJsonLikeNumber(html, [
      "dl_count",
      "dlCount",
      "download_count",
      "downloadCount",
      "sales_count",
      "salesCount",
      "work_dl_count",
      "workDlCount",
    ]) ??
    toNumber(text.match(/(?:販売数|販売本数|DL数|ダウンロード数)\s*[:：]?\s*([0-9,]+)/)?.[1]) ??
    toNumber(text.match(/([0-9,]+)\s*(?:DL|ダウンロード)/i)?.[1])
  );
}

function extractPriceCurrent(html: string, text: string): number | undefined {
  return (
    toNumber(matchFirst(html, [
      /class=["'][^"']*(?:work_price|discount_price|price)[^"']*["'][^>]*>([\s\S]*?)<\//i,
      /itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
    ])) ??
    toNumber(text.match(/(?:販売価格|価格)\s*[:：]?\s*([0-9,]+)\s*円/)?.[1]) ??
    toNumber(text.match(/([0-9,]+)\s*円/)?.[1])
  );
}

async function extractProductDetail(html: string, sourceProductId: string): Promise<RawProductDetail> {
  const text = stripTags(html);
  const title =
    cleanText(findMetaContent(html, "og:title")?.replace(/\s*\|\s*DLsite.*$/i, "")) ??
    cleanText(matchFirst(html, [/<h1[^>]*id=["']work_name["'][^>]*>([\s\S]*?)<\/h1>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i])) ??
    sourceProductId;

  const seller = extractSeller(html);
  const ajaxInfo = await fetchProductInfoAjax(sourceProductId);
  const images = await extractImages(html, sourceProductId);
  const priceCurrent = ajaxInfo.priceCurrent ?? extractPriceCurrent(html, text);
  const priceOriginal =
    ajaxInfo.priceOriginal ??
    toNumber(matchFirst(html, [/class=["'][^"']*(?:base_price|default_price|strike|regular_price)[^"']*["'][^>]*>([\s\S]*?)<\//i])) ??
    toNumber(text.match(/(?:通常価格|定価)\s*[:：]?\s*([0-9,]+)\s*円/)?.[1]);
  const discountRate =
    ajaxInfo.discountRate ??
    toNumber(text.match(/([0-9]{1,2})\s*%\s*OFF/i)?.[1]) ??
    toNumber(text.match(/([0-9]{1,2})\s*％\s*OFF/i)?.[1]);
  const salesCount = ajaxInfo.salesCount ?? extractSalesCount(html, text);
  // DLsiteでは「レビュー本文数」よりも「評価数」が表示・取得しやすいケースが多いため、
  // MVPでは reviewCount に評価数を入れて画面表示する。
  const reviewCount = ajaxInfo.reviewCount ?? extractEvaluationCount(html, text);
  const rating = ajaxInfo.rating ?? extractRating(html, text);
  const ratingBreakdown = ajaxInfo.ratingBreakdown ?? extractRatingBreakdown(html, text, rating) ?? [];
  const releaseDate = ajaxInfo.releaseDate ?? normalizeReleaseDate(
    text.match(/(?:販売日|発売日)\s*[:：]?\s*(\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2})/)?.[1] ??
      matchFirst(html, [/itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i]),
  );
  const genres = extractDlsiteMainGenres(html);
  // DLsiteの keyword/tag/options 系リンクは「作品をもっと見る」「PDF同梱」など
  // 作品分類として使いづらいノイズが混ざりやすいため、MVPでは取得しない。
  // ジャンル導線は main_genre 由来の genres / genreIds に一本化する。
  const tags: string[] = [];
  const hintTypes = sourceProductIdHints.get(sourceProductId) ?? new Set<RankingType>();
  const isAdult = /R18|18禁|成人向け|年齢確認/.test(text);
  const workTypeInfo = extractDlsiteWorkType(html, text);
  const contentTypeInfos = extractDlsiteContentTypes(html);

  return {
    sourceProductId,
    title,
    sellerId: seller.sellerId,
    sellerName: seller.sellerName,
    sellerType: "circle",
    sellerUrl: seller.sellerUrl,
    priceCurrent,
    priceOriginal,
    discountRate,
    salesCount,
    rating,
    ratingAverage: rating,
    reviewCount,
    ratingBreakdown,
    releaseDate,
    ageRating: isAdult ? "r18" : "all",
    workType: workTypeInfo.workType,
    workTypeLabel: workTypeInfo.workTypeLabel,
    contentTypes: contentTypeInfos.map((item) => item.contentTypeLabel),
    contentTypeIds: contentTypeInfos.map((item) => `dlsite:${item.contentType}`),
    thumbnailUrl: images[0]?.url,
    mainImageUrl: images[0]?.url,
    images,
    sourceUrl: buildSourceUrl(sourceProductId),
    affiliateUrl: "",
    description: cleanText(findMetaContent(html, "description"))?.slice(0, 500),
    genres,
    tags,
    genreIds: genres.map((genre) => `dlsite:${genre.toLowerCase()}`),
    tagIds: [],
    isNew: hintTypes.has("new"),
    isOnSale: hintTypes.has("sale") || Boolean(discountRate && discountRate > 0),
  };
}

async function fetchPublicHtml(url: string): Promise<string> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "ja,en;q=0.8",
    },
  });

  if (response.status === 403 || response.status === 429) {
    throw new BlockedAccessError(`DLsite access blocked or rate limited: status=${response.status} url=${url}`);
  }

  if (!response.ok) {
    throw new Error(`DLsite fetch failed: status=${response.status} url=${url}`);
  }

  const html = await response.text();
  if (/captcha|reCAPTCHA|アクセスが集中|ただいま大変混み合って/.test(html)) {
    throw new BlockedAccessError(`DLsite returned a block/captcha-like page: url=${url}`);
  }

  return html;
}

export const dlsiteFemaleDoujinAdapter: SourceAdapter = {
  key: "dlsite_female_doujin",
  target,

  async fetchRankingWorkIds(fetchTarget, options): Promise<RankingFetchResult> {
    const sourceUrls = listUrls[fetchTarget.rankingType] ?? listUrls.daily;
    if (!sourceUrls || sourceUrls.length === 0) {
      return { sourceProductIds: [], sourceUrl: undefined };
    }

    const failedMessages: string[] = [];
    let html: string | undefined;
    let sourceUrl: string | undefined;

    for (const candidateUrl of sourceUrls) {
      try {
        html = await fetchPublicHtml(candidateUrl);
        sourceUrl = candidateUrl;
        break;
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        failedMessages.push(message);
      }
    }

    if (!html || !sourceUrl) {
      throw new Error(`DLsite list fetch failed: ${fetchTarget.rankingType}: ${failedMessages.join(" / ")}`);
    }

    const sourceProductIds = extractProductIds(html).slice(0, getListLimit(options));
    for (const sourceProductId of sourceProductIds) {
      const hints = sourceProductIdHints.get(sourceProductId) ?? new Set<RankingType>();
      hints.add(fetchTarget.rankingType);
      sourceProductIdHints.set(sourceProductId, hints);
    }

    return {
      sourceProductIds,
      sourceUrl,
    };
  },

  async fetchProductDetail(sourceProductId: string): Promise<RawProductDetail> {
    const html = await fetchPublicHtml(buildSourceUrl(sourceProductId));
    return await extractProductDetail(html, sourceProductId);
  },

  normalizeProduct,

  buildSourceUrl,

  buildAffiliateUrl(url: string) {
    return url;
  },
};
