import type { ProductImage, RawProductDetail, RankingType } from "../../types";
import type { RankingFetchResult, SourceAdapter } from "../types";
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
const MAX_LIST_LIMIT = 50;
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

function getListLimit(): number {
  const parsed = Number(process.env.DLSITE_LIST_LIMIT ?? DEFAULT_LIST_LIMIT);
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

function extractAnchorsByHref(html: string, hrefPattern: RegExp, limit: number): string[] {
  const values: string[] = [];
  const anchorPattern = /<a\b([^>]*href=["'][^"']+["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attrs = match[1] ?? "";
    if (!hrefPattern.test(attrs)) continue;
    hrefPattern.lastIndex = 0;
    const text = cleanText(match[2]);
    if (text) values.push(text);
    if (values.length >= limit) break;
  }
  return uniq(values).slice(0, limit);
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

function extractImages(html: string, sourceProductId: string): ProductImage[] {
  const imageCandidates: string[] = [];
  const ogImage = findMetaContent(html, "og:image");
  if (ogImage) imageCandidates.push(ogImage);

  const imagePattern = /<(?:img|source)\b[^>]*(?:src|data-src|data-original|data-lazy)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(imagePattern)) {
    const url = buildAbsoluteUrl(match[1]);
    if (!url) continue;
    if (
      url.includes(sourceProductId) ||
      /\/modpub\//.test(url) ||
      /\/resize\//.test(url) ||
      /work_main|work_thumb|sam/.test(url)
    ) {
      imageCandidates.push(url);
    }
  }

  const urls = [...new Set(imageCandidates.map(buildAbsoluteUrl).filter((url): url is string => Boolean(url)))].slice(0, 6);
  return urls.map((url, index) => ({
    url,
    thumbnailUrl: url,
    type: index === 0 ? "main" : "sample",
    displayOrder: index,
  }));
}

function extractRating(html: string, text: string): number | undefined {
  return (
    toNumber(matchFirst(html, [/itemprop=["']ratingValue["'][^>]+content=["']([^"']+)["']/i])) ??
    toNumber(matchFirst(html, [/"ratingValue"\s*:\s*"?([0-9.]+)"?/i])) ??
    toNumber(text.match(/評価\s*[:：]?\s*([0-9.]+)/)?.[1])
  );
}

function extractReviewCount(html: string, text: string): number | undefined {
  return (
    toNumber(matchFirst(html, [/itemprop=["']reviewCount["'][^>]+content=["']([^"']+)["']/i])) ??
    toNumber(matchFirst(html, [/"reviewCount"\s*:\s*"?([0-9,]+)"?/i])) ??
    toNumber(text.match(/レビュー(?:数)?\s*[:：]?\s*([0-9,]+)/)?.[1])
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

function extractProductDetail(html: string, sourceProductId: string): RawProductDetail {
  const text = stripTags(html);
  const title =
    cleanText(findMetaContent(html, "og:title")?.replace(/\s*\|\s*DLsite.*$/i, "")) ??
    cleanText(matchFirst(html, [/<h1[^>]*id=["']work_name["'][^>]*>([\s\S]*?)<\/h1>/i, /<h1[^>]*>([\s\S]*?)<\/h1>/i])) ??
    sourceProductId;

  const seller = extractSeller(html);
  const images = extractImages(html, sourceProductId);
  const priceCurrent = extractPriceCurrent(html, text);
  const priceOriginal =
    toNumber(matchFirst(html, [/class=["'][^"']*(?:base_price|default_price|strike|regular_price)[^"']*["'][^>]*>([\s\S]*?)<\//i])) ??
    toNumber(text.match(/(?:通常価格|定価)\s*[:：]?\s*([0-9,]+)\s*円/)?.[1]);
  const discountRate =
    toNumber(text.match(/([0-9]{1,2})\s*%\s*OFF/i)?.[1]) ??
    toNumber(text.match(/([0-9]{1,2})\s*％\s*OFF/i)?.[1]);
  const salesCount =
    toNumber(text.match(/販売数\s*[:：]?\s*([0-9,]+)/)?.[1]) ??
    toNumber(text.match(/DL数\s*[:：]?\s*([0-9,]+)/)?.[1]);
  const reviewCount = extractReviewCount(html, text);
  const rating = extractRating(html, text);
  const releaseDate = normalizeReleaseDate(
    text.match(/(?:販売日|発売日)\s*[:：]?\s*(\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2})/)?.[1] ??
      matchFirst(html, [/itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i]),
  );
  const genres = uniq([
    ...extractAnchorsByHref(html, /genre|work_type|category/i, 20),
    text.includes("TL") ? "TL" : undefined,
    /ASMR/i.test(text) ? "ASMR" : undefined,
    text.includes("乙女向け") ? "乙女向け" : undefined,
  ]).slice(0, 20);
  const tags = extractAnchorsByHref(html, /keyword|tag|options/i, 30).slice(0, 30);
  const hintTypes = sourceProductIdHints.get(sourceProductId) ?? new Set<RankingType>();
  const isAdult = /R18|18禁|成人向け|年齢確認/.test(text);
  const workType =
    text.includes("音声") || /ASMR/i.test(text) ? "音声" : text.includes("マンガ") || text.includes("漫画") ? "マンガ" : "同人";

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
    releaseDate,
    ageRating: isAdult ? "r18" : "all",
    workType,
    thumbnailUrl: images[0]?.thumbnailUrl,
    mainImageUrl: images[0]?.url,
    images,
    sourceUrl: buildSourceUrl(sourceProductId),
    affiliateUrl: "",
    description: cleanText(findMetaContent(html, "description"))?.slice(0, 500),
    genres,
    tags,
    genreIds: genres.map((genre) => `dlsite:${genre.toLowerCase()}`),
    tagIds: tags.map((tag) => `dlsite:${tag.toLowerCase()}`),
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

  async fetchRankingWorkIds(fetchTarget): Promise<RankingFetchResult> {
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

    const sourceProductIds = extractProductIds(html).slice(0, getListLimit());
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
    return extractProductDetail(html, sourceProductId);
  },

  normalizeProduct,

  buildSourceUrl,

  buildAffiliateUrl(url: string) {
    return url;
  },
};
