import type {
  ProductContentType,
  ProductImage,
  ProductRatingBreakdown,
  ProductWorkType,
  RawProductDetail,
  RankingType,
} from "../../types";
import type {
  DiscoveredProductSource,
  HtmlSalesCountAjaxComparison,
  ProductDetailFetchOptions,
  ProductDetailParseTiming,
  ProductParseMode,
  RankingFetchOptions,
  RankingFetchResult,
  SourceAdapter,
} from "../types";
import { BlockedAccessError } from "../types";
import { normalizeProduct } from "../../normalizers/normalizeProduct";
import { logger } from "firebase-functions";
import dns from "node:dns";

const target = {
  platform: "dlsite" as const,
  audience: "female" as const,
  category: "doujin" as const,
  rankingType: "daily" as const,
};

const DLSITE_GIRLS_BASE_URL = "https://www.dlsite.com/girls";
const DLSITE_BL_BASE_URL = "https://www.dlsite.com/bl";
const DLSITE_GIRLS_RELEASE_OLD_LIST_URL =
  "https://www.dlsite.com/girls/fsr/=/language/jp/sex_category[0]/female/sex_category[1]/gay/work_category[0]/doujin/order/release_d/work_type_category[0]/game/work_type_category[1]/comic/work_type_category[2]/illust/work_type_category[3]/novel/work_type_category[4]/movie/work_type_category[5]/audio/work_type_category[6]/music/work_type_category[7]/tool/work_type_category[8]/etc/options_and_or/and/options[0]/JPN/options[1]/NM/per_page/100/is_tl/1/lang_options[0]/%E6%97%A5%E6%9C%AC%E8%AA%9E/lang_options[1]/%E8%A8%80%E8%AA%9E%E4%B8%8D%E8%A6%81";
const DLSITE_GIRLS_RELEASE_OLD_PER_PAGE = 100;
const DLSITE_BL_RELEASE_NEW_LIST_URL =
  "https://www.dlsite.com/bl/fsr/=/language/jp/sex_category%5B0%5D/female/sex_category%5B1%5D/gay/work_category%5B0%5D/doujin/order%5B0%5D/release_d/work_type_category%5B0%5D/game/work_type_category%5B1%5D/comic/work_type_category%5B2%5D/illust/work_type_category%5B3%5D/novel/work_type_category%5B4%5D/movie/work_type_category%5B5%5D/audio/work_type_category%5B6%5D/music/work_type_category%5B7%5D/tool/work_type_category%5B8%5D/etc/work_type_category_name%5B0%5D/%E3%82%B2%E3%83%BC%E3%83%A0/work_type_category_name%5B1%5D/%E3%83%9E%E3%83%B3%E3%82%AC/work_type_category_name%5B2%5D/CG%E3%83%BB%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88/work_type_category_name%5B3%5D/%E3%83%8E%E3%83%99%E3%83%AB/work_type_category_name%5B4%5D/%E5%8B%95%E7%94%BB/work_type_category_name%5B5%5D/%E3%83%9C%E3%82%A4%E3%82%B9%E3%83%BBASMR/work_type_category_name%5B6%5D/%E9%9F%B3%E6%A5%BD/work_type_category_name%5B7%5D/%E3%83%84%E3%83%BC%E3%83%AB%2F%E3%82%A2%E3%82%AF%E3%82%BB%E3%82%B5%E3%83%AA/work_type_category_name%5B8%5D/%E3%81%9D%E3%81%AE%E4%BB%96/options_and_or/and/options%5B0%5D/JPN/options%5B1%5D/NM/options_name%5B0%5D/%E6%97%A5%E6%9C%AC%E8%AA%9E%E4%BD%9C%E5%93%81/options_name%5B1%5D/%E8%A8%80%E8%AA%9E%E4%B8%8D%E5%95%8F%E4%BD%9C%E5%93%81/per_page/100/page/1/is_bl/1/is_gay/1/show_type/3";
const DLSITE_BL_RELEASE_NEW_PER_PAGE = 100;

const DLSITE_DAILY_PRIORITY_PER_PAGE = 100;
const DLSITE_TL_DAILY_PRIORITY_LIST_URL_TEMPLATE =
  "https://www.dlsite.com/girls/fsr/=/language/jp/sex_category%5B0%5D/female/sex_category%5B1%5D/gay/work_category%5B0%5D/doujin/order%5B0%5D/__ORDER__/work_type_category%5B0%5D/game/work_type_category%5B1%5D/comic/work_type_category%5B2%5D/illust/work_type_category%5B3%5D/novel/work_type_category%5B4%5D/movie/work_type_category%5B5%5D/audio/work_type_category%5B6%5D/music/work_type_category%5B7%5D/tool/work_type_category%5B8%5D/etc/work_type_category_name%5B0%5D/%E3%82%B2%E3%83%BC%E3%83%A0/work_type_category_name%5B1%5D/%E3%83%9E%E3%83%B3%E3%82%AC/work_type_category_name%5B2%5D/CG%E3%83%BB%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88/work_type_category_name%5B3%5D/%E3%83%8E%E3%83%99%E3%83%AB/work_type_category_name%5B4%5D/%E5%8B%95%E7%94%BB/work_type_category_name%5B5%5D/%E3%83%9C%E3%82%A4%E3%82%B9%E3%83%BBASMR/work_type_category_name%5B6%5D/%E9%9F%B3%E6%A5%BD/work_type_category_name%5B7%5D/%E3%83%84%E3%83%BC%E3%83%AB%2F%E3%82%A2%E3%82%AF%E3%82%BB%E3%82%B5%E3%83%AA/work_type_category_name%5B8%5D/%E3%81%9D%E3%81%AE%E4%BB%96/options_and_or/and/options%5B0%5D/JPN/options%5B1%5D/NM/options_name%5B0%5D/%E6%97%A5%E6%9C%AC%E8%AA%9E%E4%BD%9C%E5%93%81/options_name%5B1%5D/%E8%A8%80%E8%AA%9E%E4%B8%8D%E5%95%8F%E4%BD%9C%E5%93%81/per_page/100/page/1/is_tl/1/show_type/3";
const DLSITE_BL_DAILY_PRIORITY_LIST_URL_TEMPLATE =
  "https://www.dlsite.com/bl/fsr/=/language/jp/sex_category%5B0%5D/female/sex_category%5B1%5D/gay/work_category%5B0%5D/doujin/order%5B0%5D/__ORDER__/work_type_category%5B0%5D/game/work_type_category%5B1%5D/comic/work_type_category%5B2%5D/illust/work_type_category%5B3%5D/novel/work_type_category%5B4%5D/movie/work_type_category%5B5%5D/audio/work_type_category%5B6%5D/music/work_type_category%5B7%5D/tool/work_type_category%5B8%5D/etc/work_type_category_name%5B0%5D/%E3%82%B2%E3%83%BC%E3%83%A0/work_type_category_name%5B1%5D/%E3%83%9E%E3%83%B3%E3%82%AC/work_type_category_name%5B2%5D/CG%E3%83%BB%E3%82%A4%E3%83%A9%E3%82%B9%E3%83%88/work_type_category_name%5B3%5D/%E3%83%8E%E3%83%99%E3%83%AB/work_type_category_name%5B4%5D/%E5%8B%95%E7%94%BB/work_type_category_name%5B5%5D/%E3%83%9C%E3%82%A4%E3%82%B9%E3%83%BBASMR/work_type_category_name%5B6%5D/%E9%9F%B3%E6%A5%BD/work_type_category_name%5B7%5D/%E3%83%84%E3%83%BC%E3%83%AB%2F%E3%82%A2%E3%82%AF%E3%82%BB%E3%82%B5%E3%83%AA/work_type_category_name%5B8%5D/%E3%81%9D%E3%81%AE%E4%BB%96/options_and_or/and/options%5B0%5D/JPN/options%5B1%5D/NM/options_name%5B0%5D/%E6%97%A5%E6%9C%AC%E8%AA%9E%E4%BD%9C%E5%93%81/options_name%5B1%5D/%E8%A8%80%E8%AA%9E%E4%B8%8D%E5%95%8F%E4%BD%9C%E5%93%81/per_page/100/page/1/is_bl/1/is_gay/1/show_type/3";
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 200;
const MAX_LIST_PAGE_COUNT = 20;
const USER_AGENT =
  "doujin-info-mvp/0.1 (+https://doujin-info-mvp.web.app; low-frequency public-page fetcher)";
const FETCH_TIMEOUT_MS = 30_000;
const FETCH_RETRY_COUNT = 2;

try {
  // Windows/一部ネットワーク環境では Node fetch がIPv6側へ接続して低レベルで
  // `fetch failed` になることがあるため、DLsite取得ではIPv4を優先する。
  dns.setDefaultResultOrder("ipv4first");
} catch (error) {
  logger.warn("Failed to set DNS default result order", {
    message: error instanceof Error ? error.message : String(error),
  });
}

const sourceProductIdHints = new Map<string, Set<RankingType>>();
const sourceProductIdContentTypeHints = new Map<string, ProductContentType>();

type DlsiteFloor = "girls" | "bl";

function getBaseUrlForContentType(
  contentType: ProductContentType | undefined,
): string {
  return contentType === "bl" ? DLSITE_BL_BASE_URL : DLSITE_GIRLS_BASE_URL;
}

function buildListUrls(fetchTarget: {
  rankingType: RankingType;
  contentType?: ProductContentType;
}): string[] {
  const baseUrl = getBaseUrlForContentType(fetchTarget.contentType);

  switch (fetchTarget.rankingType) {
    case "daily":
      return [`${baseUrl}/ranking/day`];
    case "weekly":
      return [`${baseUrl}/ranking/week`];
    case "monthly":
      return [`${baseUrl}/ranking/month`];
    case "new":
    case "sale":
      // 2026-07時点の検証ログで従来候補URLが404になっていたため、
      // サーバー負荷を避ける目的で一旦バッチ対象から外す。
      // 正しいURLを確認できたら、listOnly=trueで一覧だけ検証してから再追加する。
      return [];
    case "popular":
      return [`${baseUrl}/ranking/day`];
    default:
      return [`${baseUrl}/ranking/day`];
  }
}

function getListLimit(options?: RankingFetchOptions): number {
  const rawLimit =
    options?.listLimit ??
    Number(process.env.DLSITE_LIST_LIMIT ?? DEFAULT_LIST_LIMIT);
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(parsed), MAX_LIST_LIMIT);
}

function buildSourceUrlWithBase(
  baseUrl: string,
  sourceProductId: string,
): string {
  return `${baseUrl}/work/=/product_id/${sourceProductId}.html`;
}

function buildSourceUrl(sourceProductId: string): string {
  return buildSourceUrlWithBase(DLSITE_GIRLS_BASE_URL, sourceProductId);
}

function buildBlSourceUrl(sourceProductId: string): string {
  return buildSourceUrlWithBase(DLSITE_BL_BASE_URL, sourceProductId);
}

function buildAbsoluteUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = decodeHtml(url.trim());
  if (!trimmed) return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;
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
  return [
    ...new Set(
      values
        .map((value) => cleanText(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findMetaContent(html: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return matchFirst(html, [
    new RegExp(
      `<meta[^>]+property=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${escaped}["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+name=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      "i",
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${escaped}["'][^>]*>`,
      "i",
    ),
  ]);
}

function extractCanonicalProductUrl(
  html: string,
  sourceProductId: string,
  currentUrl?: string,
): string | undefined {
  const canonical = matchFirst(html, [
    /<link\b[^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*\bcanonical\b[^"']*["'][^>]*>/i,
  ]);
  const absolute = buildListAbsoluteUrl(
    canonical,
    currentUrl ?? buildSourceUrl(sourceProductId),
  );
  if (!absolute) return undefined;

  const escapedId = escapeRegExp(sourceProductId);
  if (
    !new RegExp(`/work/=/product_id/${escapedId}\\.html(?:[?#].*)?$`, "i").test(
      absolute,
    )
  ) {
    return undefined;
  }

  return absolute;
}

function shouldTryBlProductPage(
  html: string,
  sourceProductId: string,
  currentUrl: string,
): boolean {
  if (/\/bl(?:-touch)?\/work\//i.test(currentUrl)) return false;

  const canonicalUrl = extractCanonicalProductUrl(
    html,
    sourceProductId,
    currentUrl,
  );
  if (canonicalUrl && /\/bl(?:-touch)?\/work\//i.test(canonicalUrl))
    return true;

  // BL作品をgirls側URLで開くと、メタ情報だけは取れてもスライダー画像が少ないケースがある。
  // ただしページ全体には関連作品も混ざるため、meta/現在の商品属性だけでBL判定する。
  const ogUrl = findMetaContent(html, "og:url") ?? "";
  if (/\/bl(?:-touch)?\/work\//i.test(ogUrl)) return true;

  const description = findMetaContent(html, "description") ?? "";
  if (/(?:ボーイズラブ|BL同人|BLマンガ|BL漫画)/i.test(description)) return true;

  const escapedId = escapeRegExp(sourceProductId);
  return new RegExp(
    `data-product_id=["']${escapedId}["'][^>]+data-options=["'][^"']*(?:^|#|,)(?:BL|BL1|BLG)(?:#|,|$)`,
    "i",
  ).test(html);
}

function countExtractedProductImages(
  html: string,
  sourceProductId: string,
): number {
  const keys = new Set<string>();
  for (const pair of extractImageUrlsFromHtml(html, sourceProductId)) {
    keys.add(canonicalImageKey(pair.displayUrl, sourceProductId));
  }
  return keys.size;
}

type ProductDetailHtmlCandidate = {
  url: string;
  html: string;
  imageCount: number;
  hasProductSlider: boolean;
  hasWorkSlider: boolean;
};

function scoreProductDetailHtmlCandidate(
  candidate: ProductDetailHtmlCandidate,
): number {
  return (
    candidate.imageCount * 100 +
    (candidate.hasProductSlider ? 20 : 0) +
    (candidate.hasWorkSlider ? 10 : 0) +
    (/\/bl(?:-touch)?\/work\//i.test(candidate.url) ? 1 : 0)
  );
}

function sortProductDetailHtmlCandidates(
  a: ProductDetailHtmlCandidate,
  b: ProductDetailHtmlCandidate,
): number {
  return (
    scoreProductDetailHtmlCandidate(b) - scoreProductDetailHtmlCandidate(a)
  );
}

async function fetchBestProductDetailHtml(
  sourceProductId: string,
  preferredSourceUrl?: string,
): Promise<ProductDetailHtmlCandidate> {
  const hintedContentType =
    sourceProductIdContentTypeHints.get(sourceProductId);
  const initialUrl =
    preferredSourceUrl ??
    (hintedContentType === "bl"
      ? buildBlSourceUrl(sourceProductId)
      : buildSourceUrl(sourceProductId));
  const queue: string[] = [initialUrl];
  const queued = new Set(queue.map((url) => normalizeListPageUrlKey(url)));
  const candidates: ProductDetailHtmlCandidate[] = [];
  const failedMessages: string[] = [];

  const enqueue = (url: string | undefined) => {
    if (!url) return;
    const key = normalizeListPageUrlKey(url);
    if (queued.has(key)) return;
    queued.add(key);
    queue.push(url);
  };

  for (let index = 0; index < queue.length; index += 1) {
    const url = queue[index];
    try {
      const html = await fetchPublicHtml(url);
      const candidate: ProductDetailHtmlCandidate = {
        url,
        html,
        imageCount: countExtractedProductImages(html, sourceProductId),
        hasProductSlider: /class=["'][^"']*\bproduct-slider\b/i.test(html),
        hasWorkSlider: /class=["'][^"']*\bwork_slider\b/i.test(html),
      };
      candidates.push(candidate);

      const canonicalUrl = extractCanonicalProductUrl(
        html,
        sourceProductId,
        url,
      );
      enqueue(canonicalUrl);

      if (
        candidate.imageCount <= 1 &&
        shouldTryBlProductPage(html, sourceProductId, url)
      ) {
        enqueue(buildBlSourceUrl(sourceProductId));
      }

      // 複数画像が取れている商品は追加URLを叩かず、従来と同じ低負荷で終了する。
      if (candidate.imageCount > 1) {
        break;
      }
    } catch (error) {
      if (error instanceof BlockedAccessError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      failedMessages.push(`${url}: ${message}`);

      // 初回URLが404等で取れない場合に備え、TL/BLの反対側URLも一度だけ試す。
      if (index === 0) {
        enqueue(
          hintedContentType === "bl"
            ? buildSourceUrl(sourceProductId)
            : buildBlSourceUrl(sourceProductId),
        );
      }
    }
  }

  const best = [...candidates].sort(sortProductDetailHtmlCandidates)[0];
  if (!best) {
    throw new Error(
      `DLsite product detail fetch failed: ${sourceProductId}: ${failedMessages.join(" / ")}`,
    );
  }

  const normalizedBestUrl = normalizeListPageUrlKey(best.url);
  const normalizedInitialUrl = normalizeListPageUrlKey(initialUrl);
  const shouldLogSelectedSource =
    normalizedBestUrl !== normalizedInitialUrl ||
    candidates.length > 1 ||
    failedMessages.length > 0;

  if (shouldLogSelectedSource) {
    logger.info("DLsite product detail source selected", {
      sourceProductId,
      initialUrl,
      selectedUrl: best.url,
      selectedImageCount: best.imageCount,
      failedCandidateCount: failedMessages.length,
      candidates: candidates.map((candidate) => ({
        url: candidate.url,
        imageCount: candidate.imageCount,
        hasProductSlider: candidate.hasProductSlider,
        hasWorkSlider: candidate.hasWorkSlider,
      })),
    });
  }

  return best;
}

function extractProductIdFromWorkUrl(url: string): string | undefined {
  const decoded = safeDecodeURIComponent(decodeHtml(url));
  const match =
    decoded.match(/\/work\/=\/product_id\/(RJ\d{6,10})\.html(?:$|[?#/])/i) ??
    decoded.match(/product_id\/(RJ\d{6,10})\.html(?:$|[?#/])/i) ??
    decoded.match(/product_id[=/](RJ\d{6,10})(?:$|[?#/&])/i);
  return match?.[1]?.toUpperCase();
}

function extractProductSources(
  html: string,
  currentUrl: string,
): DiscoveredProductSource[] {
  const products: DiscoveredProductSource[] = [];
  const seenProductIds = new Set<string>();

  const push = (
    sourceProductId: string | undefined,
    sourceUrl: string | undefined,
    listUrl = currentUrl,
  ) => {
    if (!sourceProductId) return;
    const normalizedId = sourceProductId.toUpperCase();
    if (!/^RJ\d{6,10}$/.test(normalizedId)) return;
    if (seenProductIds.has(normalizedId)) return;
    seenProductIds.add(normalizedId);
    products.push({
      sourceProductId: normalizedId,
      sourceUrl,
      rank: products.length + 1,
      listUrl,
    });
  };

  // 画像URL内のフォルダRJを商品IDとして誤取得しないよう、
  // 実際の商品詳細リンクだけを最優先で採用する。
  const anchorPattern = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[2] ?? "";
    if (!/\/work\/=\/product_id\//i.test(decodeHtml(rawHref))) continue;
    const sourceProductId = extractProductIdFromWorkUrl(rawHref);
    const sourceUrl = buildListAbsoluteUrl(rawHref, currentUrl);
    push(sourceProductId, sourceUrl);
  }

  // まれに一覧カードが data-product_id 中心でレンダリングされるケースへのフォールバック。
  // hrefが1件も取れない場合だけ使い、HTML全体のRJ正規表現スキャンはしない。
  if (products.length === 0) {
    const fallbackPatterns = [
      /\bdata-[\w:-]*product[_-]id=["'](RJ\d{6,10})["']/gi,
      /\bname=["']product_attributes["'][^>]*\bid=["'](RJ\d{6,10})["']/gi,
      /\bid=["'](RJ\d{6,10})["'][^>]*\bname=["']product_attributes["']/gi,
    ];

    for (const pattern of fallbackPatterns) {
      for (const match of html.matchAll(pattern)) {
        push(match[1], undefined);
      }
      if (products.length > 0) break;
    }
  }

  return products;
}


export type DlsiteDailyPriorityListOrder = "release_d" | "trend" | "dl_d";

export type DlsiteDailyPriorityProductSource = DiscoveredProductSource & {
  releaseDate?: string;
  releaseDateKey?: string;
  orderType: DlsiteDailyPriorityListOrder;
};

export type FetchDlsiteDailyPriorityProductSourcesOptions = {
  contentType?: ProductContentType;
  orderType: DlsiteDailyPriorityListOrder;
  limit: number;
  delayMs?: number;
  targetReleaseDateKey?: string;
  breakOnOlderReleaseDate?: boolean;
  startPage?: number;
};

export type FetchDlsiteDailyPriorityProductSourcesResult = {
  contentType: ProductContentType;
  orderType: DlsiteDailyPriorityListOrder;
  sourceUrl: string;
  requestedLimit: number;
  fetchedPageCount: number;
  sourceProductIds: string[];
  products: DlsiteDailyPriorityProductSource[];
  olderReleaseDateFound: boolean;
  missingReleaseDateCount: number;
  performance: {
    totalMs: number;
    listPageFetchTotalMs: number;
    productIdExtractTotalMs: number;
  };
};

function resolveDailyPriorityContentType(
  contentType: ProductContentType | undefined,
): ProductContentType {
  return contentType === "bl" ? "bl" : "tl";
}

function buildDailyPriorityListUrl(
  contentType: ProductContentType | undefined,
  orderType: DlsiteDailyPriorityListOrder,
): string {
  const template =
    resolveDailyPriorityContentType(contentType) === "bl"
      ? DLSITE_BL_DAILY_PRIORITY_LIST_URL_TEMPLATE
      : DLSITE_TL_DAILY_PRIORITY_LIST_URL_TEMPLATE;
  return template.replace("__ORDER__", orderType);
}

function buildDailyPriorityListPageUrl(
  contentType: ProductContentType | undefined,
  orderType: DlsiteDailyPriorityListOrder,
  pageNumber: number,
): string {
  const safePage = Math.max(1, Math.floor(pageNumber));
  return buildDailyPriorityListUrl(contentType, orderType).replace(
    /\/page\/\d+(?=\/|$)/i,
    `/page/${safePage}`,
  );
}

function normalizeListReleaseDate(value: string | undefined):
  | { releaseDate: string; releaseDateKey: string }
  | undefined {
  if (!value) return undefined;

  const match = value.match(
    /(\d{4})\s*(?:年|[/.\-])\s*(\d{1,2})\s*(?:月|[/.\-])\s*(\d{1,2})\s*(?:日)?/,
  );
  if (!match?.[1] || !match[2] || !match[3]) return undefined;

  const year = match[1];
  const month = match[2].padStart(2, "0");
  const day = match[3].padStart(2, "0");
  const releaseDate = `${year}-${month}-${day}`;
  return { releaseDate, releaseDateKey: `${year}${month}${day}` };
}

function extractReleaseDateNearProductAnchor(
  html: string,
  anchorIndex: number,
): { releaseDate: string; releaseDateKey: string } | undefined {
  const start = Math.max(0, anchorIndex - 1800);
  const end = Math.min(html.length, anchorIndex + 3200);
  const rawChunk = html.slice(start, end);

  const attributePatterns = [
    /\bdata-[\w:-]*(?:release|regist|sales?|sale)[\w:-]*date[\w:-]*=["']([^"']+)["']/gi,
    /\b(?:release|regist|sales?|sale)[_-]?date=["']([^"']+)["']/gi,
    /["'](?:regist_date|release_date|releaseDate|datePublished)["']\s*:\s*["']([^"']+)["']/gi,
  ];

  for (const pattern of attributePatterns) {
    for (const match of rawChunk.matchAll(pattern)) {
      const normalized = normalizeListReleaseDate(decodeHtml(match[1]));
      if (normalized) return normalized;
    }
  }

  const text = stripTags(rawChunk);

  const labeledPatterns = [
    /(?:販売日|販売開始日|発売日|発売開始日)\s*[:：]?\s*((?:\d{4})\s*(?:年|[/.\-])\s*(?:\d{1,2})\s*(?:月|[/.\-])\s*(?:\d{1,2})\s*(?:日)?)/,
    /((?:\d{4})\s*(?:年|[/.\-])\s*(?:\d{1,2})\s*(?:月|[/.\-])\s*(?:\d{1,2})\s*(?:日)?)\s*(?:販売開始|発売開始|販売|発売)/,
  ];

  for (const pattern of labeledPatterns) {
    const matched = text.match(pattern);
    const normalized = normalizeListReleaseDate(matched?.[1]);
    if (normalized) return normalized;
  }

  // DLsiteの一覧カードでは日付ラベルがHTML構造で分断されることがあるため、
  // 最後のフォールバックとしてカード近傍の年月日を拾う。
  const dateMatches = [
    ...text.matchAll(
      /(\d{4}\s*(?:年|[/.\-])\s*\d{1,2}\s*(?:月|[/.\-])\s*\d{1,2}\s*(?:日)?)/g,
    ),
  ];
  for (const matched of dateMatches) {
    const normalized = normalizeListReleaseDate(matched[1]);
    if (normalized) return normalized;
  }

  return undefined;
}

function extractProductSourcesWithReleaseDates(
  html: string,
  currentUrl: string,
  orderType: DlsiteDailyPriorityListOrder,
): DlsiteDailyPriorityProductSource[] {
  const products: DlsiteDailyPriorityProductSource[] = [];
  const seenProductIds = new Set<string>();
  const push = (
    sourceProductId: string | undefined,
    sourceUrl: string | undefined,
    anchorIndex: number | undefined,
  ) => {
    if (!sourceProductId) return;
    const normalizedId = sourceProductId.toUpperCase();
    if (!/^RJ\d{6,10}$/.test(normalizedId)) return;
    if (seenProductIds.has(normalizedId)) return;
    seenProductIds.add(normalizedId);
    const releaseDate =
      anchorIndex === undefined
        ? undefined
        : extractReleaseDateNearProductAnchor(html, anchorIndex);
    products.push({
      sourceProductId: normalizedId,
      sourceUrl,
      rank: products.length + 1,
      listUrl: currentUrl,
      releaseDate: releaseDate?.releaseDate,
      releaseDateKey: releaseDate?.releaseDateKey,
      orderType,
    });
  };

  const anchorPattern = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const rawHref = match[2] ?? "";
    if (!/\/work\/=\/product_id\//i.test(decodeHtml(rawHref))) continue;
    const sourceProductId = extractProductIdFromWorkUrl(rawHref);
    const sourceUrl = buildListAbsoluteUrl(rawHref, currentUrl);
    push(sourceProductId, sourceUrl, match.index);
  }

  if (products.length > 0) return products;

  for (const product of extractProductSources(html, currentUrl)) {
    products.push({
      ...product,
      orderType,
    });
  }

  return products;
}

export async function fetchDlsiteDailyPriorityProductSources(
  options: FetchDlsiteDailyPriorityProductSourcesOptions,
): Promise<FetchDlsiteDailyPriorityProductSourcesResult> {
  const startedAt = Date.now();
  let listPageFetchTotalMs = 0;
  let productIdExtractTotalMs = 0;
  const contentType = resolveDailyPriorityContentType(options.contentType);
  const limit = Math.max(0, Math.floor(options.limit));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 0));
  const sourceUrl = buildDailyPriorityListPageUrl(
    contentType,
    options.orderType,
    1,
  );
  const products: DlsiteDailyPriorityProductSource[] = [];
  const seenProductIds = new Set<string>();
  let fetchedPageCount = 0;
  let olderReleaseDateFound = false;
  let missingReleaseDateCount = 0;
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  const pageCount = Math.max(
    1,
    Math.ceil(Math.max(limit, DLSITE_DAILY_PRIORITY_PER_PAGE) / DLSITE_DAILY_PRIORITY_PER_PAGE),
  );

  for (
    let pageOffset = 0;
    pageOffset < pageCount && products.length < limit && !olderReleaseDateFound;
    pageOffset += 1
  ) {
    const page = startPage + pageOffset;
    if (pageOffset > 0 && delayMs > 0) await delay(delayMs);
    const url = buildDailyPriorityListPageUrl(contentType, options.orderType, page);
    const fetchStartedAt = Date.now();
    const html = await fetchPublicHtml(url);
    listPageFetchTotalMs += Date.now() - fetchStartedAt;
    fetchedPageCount += 1;

    const extractStartedAt = Date.now();
    const pageProducts = extractProductSourcesWithReleaseDates(
      html,
      url,
      options.orderType,
    );
    productIdExtractTotalMs += Date.now() - extractStartedAt;

    let newCount = 0;
    for (const product of pageProducts) {
      if (seenProductIds.has(product.sourceProductId)) continue;

      if (options.targetReleaseDateKey) {
        if (!product.releaseDateKey) {
          missingReleaseDateCount += 1;
          continue;
        }
        if (product.releaseDateKey < options.targetReleaseDateKey) {
          olderReleaseDateFound = true;
          continue;
        }
        if (product.releaseDateKey !== options.targetReleaseDateKey) {
          continue;
        }
      }

      seenProductIds.add(product.sourceProductId);
      products.push({
        ...product,
        rank: products.length + 1,
      });
      sourceProductIdContentTypeHints.set(product.sourceProductId, contentType);
      newCount += 1;
      if (products.length >= limit) break;
    }

    logger.info("DLsite daily priority list page fetched", {
      contentType,
      orderType: options.orderType,
      page,
      url,
      extractedCount: pageProducts.length,
      newCount,
      totalCount: products.length,
      targetReleaseDateKey: options.targetReleaseDateKey,
      olderReleaseDateFound,
      missingReleaseDateCount,
      limit,
    });

    if (options.breakOnOlderReleaseDate && olderReleaseDateFound) break;
    if (pageProducts.length === 0) break;
  }

  return {
    contentType,
    orderType: options.orderType,
    sourceUrl,
    requestedLimit: limit,
    fetchedPageCount,
    sourceProductIds: products.map((product) => product.sourceProductId),
    products,
    olderReleaseDateFound,
    missingReleaseDateCount,
    performance: {
      totalMs: Date.now() - startedAt,
      listPageFetchTotalMs,
      productIdExtractTotalMs,
    },
  };
}

function buildListAbsoluteUrl(
  url: string | undefined | null,
  currentUrl: string,
): string | undefined {
  if (!url) return undefined;
  const trimmed = decodeHtml(url.trim());
  if (!trimmed || trimmed.startsWith("#") || /^javascript:/i.test(trimmed))
    return undefined;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://"))
    return trimmed;

  try {
    return new URL(trimmed, currentUrl).toString();
  } catch {
    return buildAbsoluteUrl(trimmed);
  }
}

function normalizeListPageUrlKey(url: string): string {
  return decodeHtml(url).replace(/#.*$/, "").replace(/\/+$/, "");
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isLikelyRequestedListPageUrl(
  url: string,
  pageNumber: number,
): boolean {
  const decoded = safeDecodeURIComponent(decodeHtml(url));
  const escapedPage = String(pageNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  return (
    new RegExp(`(?:^|/)page/${escapedPage}(?:/|$|[?#])`, "i").test(decoded) ||
    new RegExp(
      `[?&](?:page|p|pagenum|page_no)=${escapedPage}(?:&|$)`,
      "i",
    ).test(decoded) ||
    new RegExp(`(?:^|/)p/${escapedPage}(?:/|$|[?#])`, "i").test(decoded)
  );
}

function isLikelyNextAnchor(
  attributes: string,
  body: string,
  href: string,
  pageNumber: number,
): boolean {
  if (/\brel=["'][^"']*\bnext\b[^"']*["']/i.test(attributes)) return true;
  if (isLikelyRequestedListPageUrl(href, pageNumber)) return true;

  const text = cleanText(body) ?? "";
  return (
    text === String(pageNumber) ||
    /^(?:次へ|次|NEXT|Next|next|>|＞|»|›)$/.test(text)
  );
}

function extractNextListPageUrls(
  html: string,
  currentUrl: string,
  pageNumber: number,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const anchorPattern =
    /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const rawHref = match[2] ?? "";
    const body = match[3] ?? "";
    const href = decodeHtml(rawHref);
    if (!isLikelyNextAnchor(attributes, body, href, pageNumber)) continue;

    const absoluteUrl = buildListAbsoluteUrl(href, currentUrl);
    if (!absoluteUrl) continue;

    const key = normalizeListPageUrlKey(absoluteUrl);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(absoluteUrl);
  }

  return urls;
}

function appendPathPageSegment(
  url: string,
  pageNumber: number,
): string | undefined {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "");

    if (/\/page\/\d+\/?$/i.test(pathname)) {
      parsed.pathname = pathname.replace(
        /\/page\/\d+\/?$/i,
        `/page/${pageNumber}`,
      );
    } else if (pathname.includes("/=/")) {
      parsed.pathname = `${pathname}/page/${pageNumber}`;
    } else {
      parsed.pathname = `${pathname}/=/page/${pageNumber}`;
    }

    return parsed.toString();
  } catch {
    return undefined;
  }
}

function buildListPageFallbackUrls(
  baseUrl: string,
  pageNumber: number,
): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (url: string | undefined) => {
    if (!url) return;
    const key = normalizeListPageUrlKey(url);
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  push(appendPathPageSegment(baseUrl, pageNumber));

  for (const queryKey of ["page", "p", "pagenum", "page_no"]) {
    try {
      const parsed = new URL(baseUrl);
      parsed.searchParams.set(queryKey, String(pageNumber));
      push(parsed.toString());
    } catch {
      // ignore invalid URL fallback
    }
  }

  return urls;
}

type ListCandidateFetchResult = {
  sourceProductIds: string[];
  products: DiscoveredProductSource[];
  sourceUrl?: string;
  fetchedPageCount: number;
};

export type DlsiteGirlsReleaseOldListPageResult = {
  page: number;
  url: string;
  idsInPage: number;
  newIdsInPage: number;
};

export type DlsiteGirlsReleaseOldListFailedPage = {
  page: number;
  url: string;
  message: string;
};

export type DlsiteGirlsReleaseOldListScanOptions = {
  maxPages?: number;
  startPage?: number;
  delayMs?: number;
  contentType?: ProductContentType;
};

export type DlsiteGirlsReleaseOldListMeta = {
  totalCount: number;
  totalPages: number;
  perPage: number;
  contentType: ProductContentType;
  sourceUrl: string;
  firstPageHtml: string;
  performance: {
    totalMs: number;
    listPageFetchTotalMs: number;
    productIdExtractTotalMs: number;
  };
};

export type DlsiteGirlsReleaseOldListPageRangeOptions = {
  startPage: number;
  pagesToFetch: number;
  delayMs?: number;
  contentType?: ProductContentType;
  totalCount: number;
  totalPages: number;
  firstPageHtml?: string;
  logPages?: boolean;
};

export type DlsiteGirlsReleaseOldListScanResult = {
  totalCount: number;
  totalPages: number;
  perPage: number;
  startPage: number;
  pagesToFetch: number;
  fetchedPageCount: number;
  sourceUrl: string;
  sourceProductIds: string[];
  products: DiscoveredProductSource[];
  pageResults: DlsiteGirlsReleaseOldListPageResult[];
  failedPages: DlsiteGirlsReleaseOldListFailedPage[];
  performance: {
    totalMs: number;
    listPageFetchTotalMs: number;
    productIdExtractTotalMs: number;
  };
};

type DlsiteReleaseNewListConfig = {
  contentType: ProductContentType;
  site: "girls" | "bl";
  label: string;
  baseUrl: string;
  listUrl: string;
  perPage: number;
};

function resolveReleaseListContentType(
  contentType: ProductContentType | undefined,
): ProductContentType {
  return contentType === "bl" ? "bl" : "tl";
}

function getReleaseNewListConfig(
  contentType: ProductContentType | undefined,
): DlsiteReleaseNewListConfig {
  const resolved = resolveReleaseListContentType(contentType);
  if (resolved === "bl") {
    return {
      contentType: "bl",
      site: "bl",
      label: "bl",
      baseUrl: DLSITE_BL_BASE_URL,
      listUrl: DLSITE_BL_RELEASE_NEW_LIST_URL,
      perPage: DLSITE_BL_RELEASE_NEW_PER_PAGE,
    };
  }

  return {
    contentType: "tl",
    site: "girls",
    label: "girls",
    baseUrl: DLSITE_GIRLS_BASE_URL,
    listUrl: DLSITE_GIRLS_RELEASE_OLD_LIST_URL,
    perPage: DLSITE_GIRLS_RELEASE_OLD_PER_PAGE,
  };
}

function buildGirlsReleaseOldListPageUrl(
  pageNumber: number,
  contentType?: ProductContentType,
): string {
  const safePage = Math.max(1, Math.floor(pageNumber));
  const config = getReleaseNewListConfig(contentType);
  if (/\/page\/\d+(?:\/|$)/i.test(config.listUrl)) {
    return config.listUrl.replace(/\/page\/\d+(?=\/|$)/i, `/page/${safePage}`);
  }

  if (/\/per_page\/\d+(?:\/|$)/i.test(config.listUrl)) {
    return config.listUrl.replace(
      /\/per_page\/\d+(?=\/|$)/i,
      `/per_page/${config.perPage}/page/${safePage}`,
    );
  }

  return appendPathPageSegment(config.listUrl, safePage) ?? config.listUrl;
}

function extractTotalCountFromGirlsReleaseOldHtml(
  html: string,
): number | undefined {
  const text = stripTags(html);
  const normalizedText = text.replace(/[,，]/g, "").replace(/\s+/g, "");

  const patterns = [
    /(\d+)件中\d+(?:〜|～|~|-|－|―)\d+件目/,
    /(\d+)件中\d+件目/,
    /(?:^|[^0-9])全(\d+)件/,
    /(?:検索結果|該当作品|作品数|該当件数)[:：]?全?(\d+)件/,
    /\d+(?:〜|～|~|-|－|―)\d+件目[\/／]全?(\d+)件/,
    /全?(\d+)件[\/／]\d+(?:〜|～|~|-|－|―)\d+件目/,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (!match?.[1]) continue;
    const totalCount = Number(match[1]);
    if (Number.isFinite(totalCount) && totalCount >= 0) return totalCount;
  }

  const rawPatterns = [
    /["'](?:total|total_count|hit_count|search_result_count)["']\s*:\s*["']?([0-9,，]+)["']?/i,
    /\bdata-[\w:-]*(?:total|count)[\w:-]*=["']([0-9,，]+)["']/i,
  ];

  for (const pattern of rawPatterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const totalCount = Number(match[1].replace(/[,，]/g, ""));
    if (Number.isFinite(totalCount) && totalCount >= 0) return totalCount;
  }

  return undefined;
}

function buildGirlsReleaseOldTotalCountDiagnostic(html: string): string {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const cleanTitle = cleanText(title) ?? "unknown";
  const productIdLikeCount =
    html.match(/product_id\/RJ\d{6,10}\.html/gi)?.length ?? 0;
  const textSnippet = stripTags(html).replace(/\s+/g, " ").slice(0, 300);

  return `title=${cleanTitle}; productIdLikeCount=${productIdLikeCount}; snippet=${textSnippet}`;
}

async function fetchDlsiteGirlsReleaseOldListMetaInternal(
  contentType: ProductContentType | undefined,
): Promise<DlsiteGirlsReleaseOldListMeta> {
  const startedAt = Date.now();
  const listConfig = getReleaseNewListConfig(contentType);
  const firstPageUrl = buildGirlsReleaseOldListPageUrl(
    1,
    listConfig.contentType,
  );
  const firstPageFetchStartedAt = Date.now();
  const firstHtml = await fetchPublicHtml(firstPageUrl);
  const listPageFetchTotalMs = Date.now() - firstPageFetchStartedAt;
  const extractedTotalCount =
    extractTotalCountFromGirlsReleaseOldHtml(firstHtml);

  if (extractedTotalCount === undefined) {
    throw new Error(
      `DLsite ${listConfig.label} release-new list total count was not found in HTML: ${buildGirlsReleaseOldTotalCountDiagnostic(firstHtml)}`,
    );
  }

  const totalCount = extractedTotalCount;
  const totalPages = Math.max(1, Math.ceil(totalCount / listConfig.perPage));

  return {
    totalCount,
    totalPages,
    perPage: listConfig.perPage,
    contentType: listConfig.contentType,
    sourceUrl: firstPageUrl,
    firstPageHtml: firstHtml,
    performance: {
      totalMs: Date.now() - startedAt,
      listPageFetchTotalMs,
      productIdExtractTotalMs: 0,
    },
  };
}

export async function fetchDlsiteGirlsReleaseOldListMeta(
  options: Pick<DlsiteGirlsReleaseOldListScanOptions, "contentType"> = {},
): Promise<DlsiteGirlsReleaseOldListMeta> {
  return fetchDlsiteGirlsReleaseOldListMetaInternal(options.contentType);
}

export async function fetchDlsiteGirlsReleaseOldProductSourcesForPageRange(
  options: DlsiteGirlsReleaseOldListPageRangeOptions,
): Promise<DlsiteGirlsReleaseOldListScanResult> {
  const scanStartedAt = Date.now();
  let listPageFetchTotalMs = 0;
  let productIdExtractTotalMs = 0;
  const listConfig = getReleaseNewListConfig(options.contentType);
  const startPage = Math.max(1, Math.floor(options.startPage));
  const pagesToFetch = Math.max(0, Math.floor(options.pagesToFetch));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 500));
  const endPage = startPage + pagesToFetch - 1;
  const products: DiscoveredProductSource[] = [];
  const seenProductIds = new Set<string>();
  const pageResults: DlsiteGirlsReleaseOldListPageResult[] = [];
  const failedPages: DlsiteGirlsReleaseOldListFailedPage[] = [];
  const sourceUrl = buildGirlsReleaseOldListPageUrl(
    startPage,
    listConfig.contentType,
  );
  let fetchedPageCount = 0;

  if (pagesToFetch <= 0) {
    return {
      totalCount: options.totalCount,
      totalPages: options.totalPages,
      perPage: listConfig.perPage,
      startPage,
      pagesToFetch: 0,
      fetchedPageCount: 0,
      sourceUrl,
      sourceProductIds: [],
      products: [],
      pageResults: [],
      failedPages: [],
      performance: {
        totalMs: Date.now() - scanStartedAt,
        listPageFetchTotalMs,
        productIdExtractTotalMs,
      },
    };
  }

  for (let page = startPage; page <= endPage; page += 1) {
    const url = buildGirlsReleaseOldListPageUrl(page, listConfig.contentType);
    let html: string;

    try {
      if (page === 1 && options.firstPageHtml) {
        html = options.firstPageHtml;
      } else {
        if (delayMs > 0) await delay(delayMs);
        const pageFetchStartedAt = Date.now();
        html = await fetchPublicHtml(url);
        listPageFetchTotalMs += Date.now() - pageFetchStartedAt;
      }
    } catch (error) {
      if (error instanceof BlockedAccessError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      failedPages.push({ page, url, message });
      logger.warn(
        `DLsite ${listConfig.label} release-new list page fetch failed; continue next page`,
        {
          page,
          url,
          message,
        },
      );
      continue;
    }

    fetchedPageCount += 1;
    const productIdExtractStartedAt = Date.now();
    const pageProducts = extractProductSources(html, url);
    productIdExtractTotalMs += Date.now() - productIdExtractStartedAt;
    let newIdsInPage = 0;

    for (const product of pageProducts) {
      if (seenProductIds.has(product.sourceProductId)) continue;
      seenProductIds.add(product.sourceProductId);
      products.push({
        ...product,
        rank: (page - 1) * listConfig.perPage + products.length + 1,
        listUrl: product.listUrl ?? url,
      });
      sourceProductIdContentTypeHints.set(
        product.sourceProductId,
        listConfig.contentType,
      );
      newIdsInPage += 1;
    }

    pageResults.push({
      page,
      url,
      idsInPage: pageProducts.length,
      newIdsInPage,
    });

    const logPayload = {
      totalCount: options.totalCount,
      totalPages: options.totalPages,
      pagesToFetch,
      currentPage: page,
      contentType: listConfig.contentType,
      idsInPage: pageProducts.length,
      newIdsInPage,
      uniqueIdsSoFar: products.length,
      failedPages: failedPages.map((failedPage) => failedPage.page),
    };

    if (pageProducts.length === 0) {
      logger.warn(
        `DLsite ${listConfig.label} release-new list page had no product ids`,
        logPayload,
      );
    } else if (options.logPages === true) {
      logger.info(
        `DLsite ${listConfig.label} release-new list page fetched`,
        logPayload,
      );
    }
  }

  return {
    totalCount: options.totalCount,
    totalPages: options.totalPages,
    perPage: listConfig.perPage,
    startPage,
    pagesToFetch,
    fetchedPageCount,
    sourceUrl,
    sourceProductIds: products.map((product) => product.sourceProductId),
    products,
    pageResults,
    failedPages,
    performance: {
      totalMs: Date.now() - scanStartedAt,
      listPageFetchTotalMs,
      productIdExtractTotalMs,
    },
  };
}

export async function fetchDlsiteGirlsReleaseOldProductSources(
  options: DlsiteGirlsReleaseOldListScanOptions = {},
): Promise<DlsiteGirlsReleaseOldListScanResult> {
  const scanStartedAt = Date.now();
  const listConfig = getReleaseNewListConfig(options.contentType);
  const startPage = Math.max(1, Math.floor(options.startPage ?? 1));
  const delayMs = Math.max(0, Math.floor(options.delayMs ?? 500));
  const firstPageUrl = buildGirlsReleaseOldListPageUrl(
    1,
    listConfig.contentType,
  );
  const firstPageFetchStartedAt = Date.now();
  const firstHtml = await fetchPublicHtml(firstPageUrl);
  let listPageFetchTotalMs = Date.now() - firstPageFetchStartedAt;
  let productIdExtractTotalMs = 0;
  const extractedTotalCount =
    extractTotalCountFromGirlsReleaseOldHtml(firstHtml);
  const hasMaxPages =
    typeof options.maxPages === "number" && Math.floor(options.maxPages) > 0;

  if (extractedTotalCount === undefined && !hasMaxPages) {
    throw new Error(
      `DLsite ${listConfig.label} release-new list total count was not found in HTML: ${buildGirlsReleaseOldTotalCountDiagnostic(firstHtml)}`,
    );
  }

  if (extractedTotalCount === undefined) {
    logger.warn(
      `DLsite ${listConfig.label} release-new list total count was not found; continue because maxPages is specified`,
      {
        maxPages: options.maxPages,
        startPage,
        contentType: listConfig.contentType,
        sourceUrl: firstPageUrl,
        diagnostic: buildGirlsReleaseOldTotalCountDiagnostic(firstHtml),
      },
    );
  }

  const totalCount = extractedTotalCount ?? 0;
  const totalPages =
    extractedTotalCount === undefined
      ? 0
      : Math.max(1, Math.ceil(extractedTotalCount / listConfig.perPage));
  const requestedMaxPages =
    typeof options.maxPages === "number"
      ? Math.max(0, Math.floor(options.maxPages))
      : undefined;
  const remainingPageCount =
    extractedTotalCount === undefined
      ? (requestedMaxPages ?? 0)
      : Math.max(0, totalPages - startPage + 1);
  const pagesToFetch =
    requestedMaxPages !== undefined
      ? Math.min(remainingPageCount, requestedMaxPages)
      : remainingPageCount;

  logger.info(`DLsite ${listConfig.label} release-new list scan started`, {
    totalCount,
    totalPages,
    perPage: listConfig.perPage,
    maxPages: options.maxPages,
    startPage,
    pagesToFetch,
    delayMs,
    contentType: listConfig.contentType,
    sourceUrl: firstPageUrl,
  });

  const range = await fetchDlsiteGirlsReleaseOldProductSourcesForPageRange({
    startPage,
    pagesToFetch,
    delayMs,
    contentType: listConfig.contentType,
    totalCount,
    totalPages,
    firstPageHtml: startPage === 1 ? firstHtml : undefined,
    logPages: true,
  });
  listPageFetchTotalMs += range.performance.listPageFetchTotalMs;
  productIdExtractTotalMs += range.performance.productIdExtractTotalMs;

  logger.info(`DLsite ${listConfig.label} release-new list scan finished`, {
    totalCount,
    totalPages,
    maxPages: options.maxPages,
    startPage,
    pagesToFetch,
    fetchedPageCount: range.fetchedPageCount,
    contentType: listConfig.contentType,
    uniqueIds: range.products.length,
    failedPages: range.failedPages.map((failedPage) => failedPage.page),
    performance: {
      totalMs: Date.now() - scanStartedAt,
      listPageFetchTotalMs,
      productIdExtractTotalMs,
    },
  });

  return {
    ...range,
    sourceUrl: firstPageUrl,
    performance: {
      totalMs: Date.now() - scanStartedAt,
      listPageFetchTotalMs,
      productIdExtractTotalMs,
    },
  };
}

async function fetchProductIdsFromListCandidate(params: {
  candidateUrl: string;
  rankingType: RankingType;
  listLimit: number;
}): Promise<ListCandidateFetchResult> {
  const products: DiscoveredProductSource[] = [];
  const seenProductIds = new Set<string>();
  const attemptedUrlKeys = new Set<string>();
  let currentUrl: string | undefined = params.candidateUrl;
  let firstFetchedUrl: string | undefined;
  let fetchedPageCount = 0;
  const maxPageCount = Math.min(
    MAX_LIST_PAGE_COUNT,
    Math.max(1, Math.ceil(params.listLimit / 10)),
  );

  for (
    let pageNumber = 1;
    currentUrl &&
    pageNumber <= maxPageCount &&
    products.length < params.listLimit;
    pageNumber += 1
  ) {
    const currentKey = normalizeListPageUrlKey(currentUrl);
    if (attemptedUrlKeys.has(currentKey)) {
      logger.warn(
        "DLsite list page skipped because URL was already attempted",
        {
          rankingType: params.rankingType,
          pageNumber,
          url: currentUrl,
        },
      );
      break;
    }
    attemptedUrlKeys.add(currentKey);

    let html: string;
    try {
      logger.info("DLsite list page fetch started", {
        rankingType: params.rankingType,
        pageNumber,
        url: currentUrl,
        listLimit: params.listLimit,
      });
      html = await fetchPublicHtml(currentUrl);
    } catch (error) {
      if (error instanceof BlockedAccessError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      if (pageNumber === 1) {
        throw new Error(message);
      }

      logger.warn(
        "DLsite list page fetch failed; stop pagination for this candidate",
        {
          rankingType: params.rankingType,
          pageNumber,
          url: currentUrl,
          message,
        },
      );
      break;
    }

    firstFetchedUrl ??= currentUrl;
    fetchedPageCount += 1;

    const pageProducts = extractProductSources(html, currentUrl);
    let newProductCount = 0;
    for (const product of pageProducts) {
      if (seenProductIds.has(product.sourceProductId)) continue;
      seenProductIds.add(product.sourceProductId);
      products.push({
        ...product,
        rank: products.length + 1,
      });
      newProductCount += 1;
      if (products.length >= params.listLimit) break;
    }

    logger.info("DLsite list page fetched", {
      rankingType: params.rankingType,
      pageNumber,
      url: currentUrl,
      extractedCount: pageProducts.length,
      newCount: newProductCount,
      totalCount: products.length,
      listLimit: params.listLimit,
    });

    if (products.length >= params.listLimit) break;
    if (newProductCount === 0 && pageNumber > 1) break;

    const nextPageNumber = pageNumber + 1;
    const nextUrlCandidates: string[] = [
      ...extractNextListPageUrls(html, currentUrl, nextPageNumber),
      ...buildListPageFallbackUrls(params.candidateUrl, nextPageNumber),
    ];
    currentUrl = nextUrlCandidates.find(
      (url: string) => !attemptedUrlKeys.has(normalizeListPageUrlKey(url)),
    );

    if (!currentUrl) {
      logger.info(
        "DLsite list pagination finished because next page was not found",
        {
          rankingType: params.rankingType,
          pageNumber,
          totalCount: products.length,
        },
      );
    }
  }

  const limitedProducts = products.slice(0, params.listLimit);
  return {
    sourceProductIds: limitedProducts.map((product) => product.sourceProductId),
    products: limitedProducts,
    sourceUrl: firstFetchedUrl,
    fetchedPageCount,
  };
}

function extractAnchorTexts(
  html: string,
  hrefPattern: RegExp,
  limit: number,
): string[] {
  const values: string[] = [];
  const anchorPattern =
    /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;

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
    /^(R18|全年齢|マンガ|漫画|コミック|JPEG|JPG|PNG|PDF|ZIP|MP3|WAV|動画|ゲーム|音声|ドラマCD|乙女向け|女性向け|男性向け|成人向け)$/i.test(
      value,
    )
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

function normalizeWorkTypeFromText(
  value: string | undefined,
): NormalizedWorkType | undefined {
  const text = cleanText(value)?.toLowerCase();
  if (!text) return undefined;

  if (/マンガ|漫画|コミック|manga|comic/.test(text))
    return { workType: "comic", workTypeLabel: "マンガ" };
  if (/cg|イラスト|illust|画像/.test(text))
    return { workType: "cg", workTypeLabel: "CG" };
  if (/動画|ムービー|movie|video|アニメーション/.test(text))
    return { workType: "movie", workTypeLabel: "動画" };
  if (
    /ゲーム|game|rpg|ロールプレイング|アドベンチャー|シミュレーション|アクション|シューティング|パズル|クイズ/.test(
      text,
    )
  ) {
    return { workType: "game", workTypeLabel: "ゲーム" };
  }
  if (
    /音声|asmr|ボイス|voice|ドラマcd|ボイスドラマ|サウンド|sound|音楽/.test(
      text,
    )
  )
    return { workType: "voice", workTypeLabel: "音声" };
  return undefined;
}

function normalizeWorkTypeFromCode(
  value: string | undefined,
): NormalizedWorkType | undefined {
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
    const codeFromHref = matchFirst(categoryTypeBlock, [
      /work_type\/([A-Za-z0-9_]+)/i,
    ]);
    const byHref = normalizeWorkTypeFromCode(codeFromHref);
    if (byHref) return byHref;

    const codeFromClass = matchFirst(categoryTypeBlock, [
      /class=["'][^"']*\bicon\s+([A-Za-z0-9_]+)\b[^"']*["']/i,
    ]);
    const byClass = normalizeWorkTypeFromCode(codeFromClass);
    if (byClass) return byClass;

    const title = matchFirst(categoryTypeBlock, [/title=["']([^"']+)["']/i]);
    const byTitle = normalizeWorkTypeFromText(title);
    if (byTitle) return byTitle;

    const byText = normalizeWorkTypeFromText(categoryTypeBlock);
    if (byText) return byText;
  }

  const rowPattern =
    /<tr[^>]*>\s*<t[hd][^>]*>\s*(?:作品形式|作品タイプ|形式)\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/i;
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

function normalizeContentTypeFromCode(
  value: string | undefined,
): NormalizedContentType | undefined {
  const code = value?.trim().toUpperCase();
  if (!code) return undefined;
  return DLSITE_CONTENT_TYPE_CODE_MAP[code];
}

function normalizeContentTypeFromText(
  value: string | undefined,
): NormalizedContentType | undefined {
  const text = cleanText(value);
  if (!text) return undefined;

  if (/ボーイズラブ|ＢＬ|BL/i.test(text))
    return { contentType: "bl", contentTypeLabel: "BL" };
  if (/乙女向け|ティーンズラブ|ＴＬ|TL/i.test(text))
    return { contentType: "tl", contentTypeLabel: "TL" };
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
  const anchorPattern =
    /<a\b([^>]*href=["']([^"']*coupling_option\/([^\/"']+)[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const attributes = match[1] ?? "";
    const codeFromHref = match[3];
    const body = match[4] ?? "";
    const codeFromClass = matchFirst(body, [
      /class=["'][^"']*\bicon\s+([A-Za-z0-9_]+)\b[^"']*["']/i,
    ]);
    const title =
      matchFirst(body, [/title=["']([^"']+)["']/i]) ??
      matchFirst(attributes, [/title=["']([^"']+)["']/i]);

    pushNormalizedContentType(
      found,
      normalizeContentTypeFromCode(codeFromHref),
    );
    pushNormalizedContentType(
      found,
      normalizeContentTypeFromCode(codeFromClass),
    );
    pushNormalizedContentType(found, normalizeContentTypeFromText(title));
    pushNormalizedContentType(found, normalizeContentTypeFromText(body));
  }

  if (found.size === 0) {
    const rowPattern =
      /<tr[^>]*>\s*<t[hd][^>]*>\s*(?:その他|カテゴリ|対象)\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    for (const match of html.matchAll(rowPattern)) {
      pushNormalizedContentType(found, normalizeContentTypeFromText(match[1]));
    }
  }

  return Array.from(found.values());
}

function extractDlsiteMainGenres(html: string): string[] {
  const values: string[] = [];
  const mainGenrePattern =
    /<div\b[^>]*class=["'][^"']*\bmain_genre\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

  for (const match of html.matchAll(mainGenrePattern)) {
    values.push(...extractAnchorTexts(match[1] ?? "", /\/genre\/\d+\//i, 30));
  }

  // DLsiteのテンプレート差分に備え、テーブル行の「ジャンル」欄もフォールバックで見る。
  if (values.length === 0) {
    const rowPattern =
      /<tr[^>]*>\s*<t[hd][^>]*>\s*(?:ジャンル|作品ジャンル)\s*<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi;
    for (const match of html.matchAll(rowPattern)) {
      values.push(...extractAnchorTexts(match[1] ?? "", /\/genre\/\d+\//i, 30));
    }
  }

  return uniq(values)
    .filter((value) => !isDlsiteGenreNoise(value))
    .slice(0, 20);
}

function extractSeller(html: string): {
  sellerId?: string;
  sellerName?: string;
  sellerUrl?: string;
} {
  const makerMatch = html.match(
    /<a\b([^>]*href=["']([^"']*maker_id\/(RG\d+)[^"']*)["'][^>]*)>([\s\S]*?)<\/a>/i,
  );
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
  const imageProductId =
    extractDlsiteImageProductId(normalized) ?? sourceProductId;
  const escapedId = imageProductId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(
    new RegExp(`${escapedId}_img_(main|smp_?\\d+|sam_?\\d+|sample_?\\d+)`, "i"),
  );

  if (match?.[1]) {
    return `${imageProductId}_img_${match[1].replace(/_/g, "").toLowerCase()}`;
  }

  return normalized
    .replace(/_\d+x\d+\.(?:jpg|jpeg|png|webp)$/i, "")
    .toLowerCase();
}

function extractDlsiteImageProductId(url: string): string | undefined {
  const normalized = normalizeImageUrlForKey(url);
  return normalized
    .match(
      /\/(RJ\d{6,10})_img_(?:main|smp_?\d+|sam_?\d+|sample_?\d+)(?:_(?:\d+x\d+|[wh]\d+))?\.(?:jpg|jpeg|png|webp)$/i,
    )?.[1]
    ?.toUpperCase();
}

function isDlsiteWorkImageUrl(url: string): boolean {
  const normalized = normalizeImageUrlForKey(url);

  if (!/\.(?:jpg|jpeg|png|webp)$/i.test(normalized)) {
    return false;
  }

  if (
    /logo|banner|bnr|button|icon|sprite|common|campaign|affiliate|favicon/i.test(
      normalized,
    )
  ) {
    return false;
  }

  // 翻訳作品・BL作品ではページURLのproduct_idと画像URL内のRJコードが一致しないことがある。
  // そのため、DLsiteの作品画像として十分に特徴的なパス/ファイル名なら許可する。
  return (
    /(?:^https?:\/\/img\.dlsite\.jp\/|\/)(?:resize|modpub)\/images2\/work\//i.test(
      normalized,
    ) &&
    /\/RJ\d{6,10}_img_(?:main|smp_?\d+|sam_?\d+|sample_?\d+)(?:_(?:\d+x\d+|[wh]\d+))?\.(?:jpg|jpeg|png|webp)$/i.test(
      normalized,
    )
  );
}

function isLikelyWorkImage(url: string, sourceProductId: string): boolean {
  const normalized = normalizeImageUrlForKey(url);
  const lower = normalized.toLowerCase();

  if (!/\.(?:jpg|jpeg|png|webp)$/i.test(normalized)) {
    return false;
  }

  if (
    /logo|banner|bnr|button|icon|sprite|common|campaign|affiliate|favicon/i.test(
      normalized,
    )
  ) {
    return false;
  }

  if (lower.includes(sourceProductId.toLowerCase())) {
    return true;
  }

  return isDlsiteWorkImageUrl(normalized);
}

function pushImageCandidate(
  candidates: string[],
  rawValue: string | undefined | null,
): void {
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

function createProductDetailParseTiming(): Required<ProductDetailParseTiming> {
  return {
    htmlOnlyProbeMs: 0,
    htmlProbeExecuted: 0,
    htmlProbePriceCurrentFound: 0,
    htmlProbePriceOriginalFound: 0,
    htmlProbeDiscountRateFound: 0,
    htmlProbeSalesCountFound: 0,
    htmlProbeRatingFound: 0,
    htmlProbeReviewCountFound: 0,
    htmlProbeReleaseDateFound: 0,
    htmlProbeSalesCountAjaxCompared: 0,
    htmlProbeSalesCountAjaxMatch: 0,
    htmlProbeSalesCountAjaxMismatch: 0,
    htmlProbeSalesCountAjaxHtmlMissing: 0,
    htmlProbeSalesCountAjaxAjaxMissing: 0,
    htmlProbeSalesCountAjaxBothMissing: 0,
    cheerioLoadMs: 0,
    parseBasicInfoMs: 0,
    parsePriceMs: 0,
    parseSalesMs: 0,
    parseRatingMs: 0,
    parseReleaseDateMs: 0,
    parseGenresMs: 0,
    parseImagesMs: 0,
    parseDescriptionMs: 0,
    normalizeProductMs: 0,
    otherParseMs: 0,
    ajaxInfoFetchMs: 0,
  };
}

type ProductDetailParseTimingKey = keyof Required<ProductDetailParseTiming>;

function measureParseStep<T>(
  timing: Required<ProductDetailParseTiming>,
  key: ProductDetailParseTimingKey,
  action: () => T,
): T {
  const startedAt = Date.now();
  try {
    return action();
  } finally {
    timing[key] += Date.now() - startedAt;
  }
}

async function measureParseStepAsync<T>(
  timing: Required<ProductDetailParseTiming>,
  key: ProductDetailParseTimingKey,
  action: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await action();
  } finally {
    timing[key] += Date.now() - startedAt;
  }
}

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

function findNextIndex(
  html: string,
  startIndex: number,
  patterns: RegExp[],
): number | undefined {
  const foundIndexes = patterns
    .map((pattern) => {
      pattern.lastIndex = 0;
      const match = html.slice(startIndex).match(pattern);
      return match?.index === undefined ? undefined : startIndex + match.index;
    })
    .filter(
      (value): value is number => value !== undefined && value > startIndex,
    );

  return foundIndexes.length > 0 ? Math.min(...foundIndexes) : undefined;
}

function uniqRawStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function eachRegExpMatch(html: string, pattern: RegExp): RegExpMatchArray[] {
  const flags = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  return [...html.matchAll(globalPattern)];
}

function extractWorkImageHtmlFragments(html: string): string[] {
  const fragments: string[] = [];
  const normalizedHtml = decodeJsEscapedUrl(html);
  const startPatterns = [
    /<div\b[^>]*id=["']work_left["'][^>]*>/i,
    /<div\b[^>]*class=["'][^"']*\bproduct-slider\b[^"']*["'][^>]*>/i,
    /<div\b[^>]*class=["'][^"']*\bwork_slider\b[^"']*["'][^>]*>/i,
    /<ul\b[^>]*class=["'][^"']*\bslider_items\b[^"']*["'][^>]*>/i,
    /<ul\b[^>]*class=["'][^"']*\bcontroller_items\b[^"']*["'][^>]*>/i,
    /<div\b[^>]*data-section_name=["']work[_\s-]?header["'][^>]*>/i,
  ];

  for (const pattern of startPatterns) {
    for (const match of eachRegExpMatch(normalizedHtml, pattern)) {
      if (match.index === undefined) continue;

      const startIndex = match.index;
      const endIndex = findNextIndex(
        normalizedHtml,
        startIndex + match[0].length,
        [
          /<div\b[^>]*class=["'][^"']*\bwork_slider_comp\b[^"']*["'][^>]*>/i,
          /<!--\s*\/work_left\s*-->/i,
          /<div\b[^>]*id=["']work_right["'][^>]*>/i,
          /<section\b[^>]*id=["']work_detail["'][^>]*>/i,
          /<div\b[^>]*id=["']work_review["'][^>]*>/i,
          /<div\b[^>]*id=["']recommend["'][^>]*>/i,
        ],
      );

      fragments.push(
        normalizedHtml.slice(
          startIndex,
          endIndex ?? Math.min(normalizedHtml.length, startIndex + 160000),
        ),
      );
    }
  }

  // HTML断片の重複排除で cleanText/stripTags を使うと、
  // picture/source/img の属性が消えて og:image しか拾えなくなる。
  // 画像抽出ではタグと属性を保持したまま重複排除する。
  return uniqRawStrings(fragments);
}

function extractDlsiteWorkImageCandidatesFromText(text: string): string[] {
  const candidates: string[] = [];
  const imageUrlPattern =
    /(?:(?:https?:)?\/\/img\.dlsite\.jp)?\/(?:resize|modpub)\/images2\/work\/[^"'<>\s\)\]]+\/RJ\d{6,10}_img_(?:main|smp_?\d+|sam_?\d+|sample_?\d+)(?:_(?:\d+x\d+|[wh]\d+))?\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s\)\]]*)?/gi;

  for (const match of text.matchAll(imageUrlPattern)) {
    pushImageCandidate(candidates, match[0]);
  }

  return candidates;
}

function extractImageUrlsFromHtml(
  html: string,
  sourceProductId: string,
): Array<{ displayUrl: string; thumbnailUrl: string }> {
  const rawCandidates: string[] = [];
  const escapedId = escapeRegExp(sourceProductId);
  const normalizedHtml = decodeJsEscapedUrl(html);
  const scopedHtmlFragments = extractWorkImageHtmlFragments(normalizedHtml);
  const imageSearchHtml =
    scopedHtmlFragments.length > 0
      ? scopedHtmlFragments.join("\n")
      : normalizedHtml;

  const ogImage =
    findMetaContent(html, "og:image") ??
    findMetaContent(html, "twitter:image:src");
  pushImageCandidate(rawCandidates, ogImage);

  // DLsiteの作品画像は、メイン画像だけでなく、サムネイル部の
  // src / srcset / data-src / href / v-lazy に入っていることが多い。
  // BL翻訳作品ではページURLのproduct_idと画像URL内RJコードが一致しないため、
  // product-slider/work_slider周辺の実URLを直接拾う。
  // 例:
  //   //img.dlsite.jp/modpub/images2/work/doujin/RJ01514000/RJ01513001_img_smp1.jpg
  const attrPattern =
    /\b(?:src|data-src|data-original|data-lazy|data-srcset|srcset|href|v-lazy)=(['"])([\s\S]*?)\1/gi;
  for (const match of imageSearchHtml.matchAll(attrPattern)) {
    pushImageCandidate(rawCandidates, match[2]);
  }

  const absoluteUrlPattern = new RegExp(
    String.raw`(?:https?:)?//[^"'<>\s\)\]]*${escapedId}[^"'<>\s\)\]]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s\)\]]*)?`,
    "gi",
  );
  for (const match of imageSearchHtml.matchAll(absoluteUrlPattern)) {
    pushImageCandidate(rawCandidates, match[0]);
  }

  const relativeUrlPattern = new RegExp(
    String.raw`/(?:resize|modpub)/images2/work/[^"'<>\s\)\]]*${escapedId}[^"'<>\s\)\]]*\.(?:jpg|jpeg|png|webp)(?:\?[^"'<>\s\)\]]*)?`,
    "gi",
  );
  for (const match of imageSearchHtml.matchAll(relativeUrlPattern)) {
    pushImageCandidate(rawCandidates, match[0]);
  }

  rawCandidates.push(
    ...extractDlsiteWorkImageCandidatesFromText(imageSearchHtml),
  );

  const candidatePairs = rawCandidates
    .map((rawUrl) => ({
      displayUrl: buildDisplayImageUrl(rawUrl),
      thumbnailUrl: buildThumbnailImageUrl(rawUrl),
    }))
    .filter(
      ({ displayUrl, thumbnailUrl }) =>
        isLikelyWorkImage(displayUrl, sourceProductId) ||
        isLikelyWorkImage(thumbnailUrl, sourceProductId),
    );

  // 念のため、scoped抽出がDLsite側のHTML差分でog:image相当しか拾えなかった場合だけ、
  // ページ全体からDLsite作品画像URLを再探索する。通常時はproduct-slider周辺だけを見るため、
  // 関連作品・広告画像の混入リスクを抑えられる。
  const uniqueKeys = new Set(
    candidatePairs.map((pair) =>
      canonicalImageKey(pair.displayUrl, sourceProductId),
    ),
  );
  if (uniqueKeys.size <= 1 && imageSearchHtml !== normalizedHtml) {
    for (const rawUrl of extractDlsiteWorkImageCandidatesFromText(
      normalizedHtml,
    )) {
      const displayUrl = buildDisplayImageUrl(rawUrl);
      const thumbnailUrl = buildThumbnailImageUrl(rawUrl);
      if (
        isLikelyWorkImage(displayUrl, sourceProductId) ||
        isLikelyWorkImage(thumbnailUrl, sourceProductId)
      ) {
        candidatePairs.push({ displayUrl, thumbnailUrl });
      }
    }
  }

  return candidatePairs;
}

function mergeDlsiteAjaxInfo(
  base: DlsiteAjaxInfo,
  next: DlsiteAjaxInfo,
): DlsiteAjaxInfo {
  return {
    priceCurrent: base.priceCurrent ?? next.priceCurrent,
    priceOriginal: base.priceOriginal ?? next.priceOriginal,
    discountRate: base.discountRate ?? next.discountRate,
    salesCount: base.salesCount ?? next.salesCount,
    rating: base.rating ?? next.rating,
    reviewCount: base.reviewCount ?? next.reviewCount,
    ratingBreakdown:
      base.ratingBreakdown && base.ratingBreakdown.length > 0
        ? base.ratingBreakdown
        : next.ratingBreakdown,
    releaseDate: base.releaseDate ?? next.releaseDate,
  };
}

function parseDlsiteAjaxInfo(parsed: unknown): DlsiteAjaxInfo {
  const values = flattenJsonValues(parsed);
  const info: DlsiteAjaxInfo = {};

  info.salesCount = firstNumberByKey(values, [
    "dl_count",
    "dlCount",
    "download_count",
    "downloadCount",
    "sales_count",
    "salesCount",
  ]);
  info.rating = firstNumberByKey(values, [
    "rate_average_2dp",
    "rateAverage2dp",
    "rate_average",
    "rateAverage",
    "ratingValue",
  ]);
  info.reviewCount = firstNumberByKey(values, [
    "rate_count",
    "rateCount",
    "rating_count",
    "ratingCount",
    "review_count",
    "reviewCount",
  ]);
  info.priceCurrent = firstNumberByKey(values, [
    "price",
    "priceCurrent",
    "price_current",
    "work_price",
  ]);
  info.priceOriginal = firstNumberByKey(values, [
    "official_price",
    "priceOriginal",
    "price_original",
    "regular_price",
    "base_price",
  ]);
  info.discountRate = firstNumberByKey(values, [
    "discount_rate",
    "discountRate",
    "discount",
  ]);
  info.releaseDate = normalizeReleaseDate(
    firstStringByKey(values, [
      "regist_date",
      "release_date",
      "releaseDate",
      "datePublished",
    ]),
  );
  info.ratingBreakdown = findRatingBreakdownInJson(parsed, info.rating);

  return info;
}

async function fetchProductInfoAjax(
  sourceProductId: string,
  options?: { parseMode?: ProductParseMode; sourceUrl?: string },
): Promise<DlsiteAjaxInfo> {
  const parseMode = options?.parseMode ?? "full";
  const ajaxBaseUrl = /\/bl(?:-touch)?\//i.test(options?.sourceUrl ?? "")
    ? DLSITE_BL_BASE_URL
    : DLSITE_GIRLS_BASE_URL;
  const referer =
    options?.sourceUrl ??
    (ajaxBaseUrl === DLSITE_BL_BASE_URL
      ? buildBlSourceUrl(sourceProductId)
      : buildSourceUrl(sourceProductId));
  const urls = [
    `${ajaxBaseUrl}/product/info/ajax?product_id=${sourceProductId}`,
    `${ajaxBaseUrl}/product/info/ajax?product_id[]=${sourceProductId}`,
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
          referer,
        },
      });
      if (!response.ok) continue;

      const text = await response.text();
      const parsed = JSON.parse(text) as unknown;
      merged = mergeDlsiteAjaxInfo(merged, parseDlsiteAjaxInfo(parsed));

      // fastでは初回全量取得向けに、追加のAjax補完を行わない。
      // sales/price/ratingなどの主要項目は最初に成功したレスポンスとHTMLフォールバックで取得する。
      if (parseMode === "fast") {
        return merged;
      }

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
      for (const [key, childValue] of flattenJsonValues(
        item,
        `${prefix}${index}.`,
      )) {
        result.set(key, childValue);
      }
    });
    return result;
  }

  if (value && typeof value === "object") {
    for (const [key, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      result.set(key, childValue);
      for (const [childKey, grandChildValue] of flattenJsonValues(
        childValue,
        `${prefix}${key}.`,
      )) {
        result.set(childKey, grandChildValue);
      }
    }
  }

  return result;
}

function firstNumberByKey(
  values: Map<string, unknown>,
  keys: string[],
): number | undefined {
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

function firstStringByKey(
  values: Map<string, unknown>,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = values.get(key);
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

async function extractImages(
  html: string,
  sourceProductId: string,
): Promise<ProductImage[]> {
  // v6では smp1..smp16 を推測してHEAD確認していたが、
  // DLsite側へのリクエスト数が増えてFunctionが遅くなるため廃止。
  // v7ではページHTML内に実際に出ている main/smp サムネイルURLを直接拾い、
  // resize URL から表示用の modpub URLを機械的に作る。
  const pairs = extractImageUrlsFromHtml(html, sourceProductId);

  const byKey = new Map<string, { displayUrl: string; thumbnailUrl: string }>();
  const sortedPairs = pairs.sort(
    (a, b) => imageSortScore(a.displayUrl) - imageSortScore(b.displayUrl),
  );

  for (const pair of sortedPairs) {
    const key = canonicalImageKey(pair.displayUrl, sourceProductId);
    const existing = byKey.get(key);

    // 同じ画像の resize / modpub が混在する場合は、表示用はmodpub寄り、サムネは実在するresize寄りを残す。
    if (!existing) {
      byKey.set(key, pair);
      continue;
    }

    byKey.set(key, {
      displayUrl: existing.displayUrl.includes("/resize/")
        ? pair.displayUrl
        : existing.displayUrl,
      thumbnailUrl: pair.thumbnailUrl.includes("/resize/")
        ? pair.thumbnailUrl
        : existing.thumbnailUrl,
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

function extractJsonLikeNumber(
  html: string,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = matchFirst(html, [
      new RegExp(`["']${escaped}["']\\s*:\\s*["']?([0-9][0-9,.]*)`, "i"),
      new RegExp(`\\b${escaped}\\b\\s*[:=]\\s*["']?([0-9][0-9,.]*)`, "i"),
      new RegExp(
        `data-${escaped.replace(/_/g, "-")}=["']([0-9][0-9,.]*)["']`,
        "i",
      ),
    ]);
    const parsed = toNumber(value);
    if (parsed !== undefined) return parsed;
  }

  return undefined;
}

function extractRating(html: string, text: string): number | undefined {
  return (
    toNumber(
      matchFirst(html, [
        /itemprop=["']ratingValue["'][^>]+content=["']([^"']+)["']/i,
        /content=["']([^"']+)["'][^>]+itemprop=["']ratingValue["']/i,
        /data-(?:rating|rate|score)=["']([0-9.]+)["']/i,
      ]),
    ) ??
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

function extractEvaluationCount(
  html: string,
  text: string,
): number | undefined {
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
    toNumber(
      matchFirst(html, [
        /itemprop=["']reviewCount["'][^>]+content=["']([^"']+)["']/i,
        /content=["']([^"']+)["'][^>]+itemprop=["']reviewCount["']/i,
      ]),
    ) ??
    toNumber(
      text.match(/評価\s*[:：]?\s*[0-9.]+[\s\S]{0,120}?\(([0-9,]+)\)/)?.[1],
    ) ??
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

  const firstFive = counts
    .slice(0, 5)
    .map((count) => Math.max(0, Math.floor(count || 0)));
  if (firstFive.every((count) => count === 0)) return undefined;

  const ascending = firstFive.map((count, index) => ({
    star: (index + 1) as 1 | 2 | 3 | 4 | 5,
    count,
  }));
  const descending = firstFive.map((count, index) => ({
    star: (5 - index) as 1 | 2 | 3 | 4 | 5,
    count,
  }));

  if (rating !== undefined && rating > 0) {
    const score = (items: ProductRatingBreakdown[]) => {
      const total = items.reduce((sum, item) => sum + item.count, 0);
      if (total <= 0) return Number.MAX_SAFE_INTEGER;
      const average =
        items.reduce((sum, item) => sum + item.star * item.count, 0) / total;
      return Math.abs(average - rating);
    };

    return score(descending) < score(ascending) ? descending : ascending;
  }

  const averageAscending =
    ascending.reduce((sum, item) => sum + item.star * item.count, 0) /
    firstFive.reduce((sum, count) => sum + count, 0);
  const averageDescending =
    descending.reduce((sum, item) => sum + item.star * item.count, 0) /
    firstFive.reduce((sum, count) => sum + count, 0);
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
  if (star !== 1 && star !== 2 && star !== 3 && star !== 4 && star !== 5)
    return;
  if (count === undefined || !Number.isFinite(count) || count < 0) return;
  byStar[star] = Math.max(0, Math.floor(count));
}

function findStarCountInObject(record: Record<string, unknown>): {
  star?: number;
  count?: number;
} {
  let star: number | undefined;
  let count: number | undefined;

  for (const [key, rawValue] of Object.entries(record)) {
    const lowerKey = key.toLowerCase();
    const numberValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? toNumber(rawValue)
          : undefined;

    if (numberValue === undefined) continue;

    if (
      /^(?:star|stars|rate|rating|score|level|rank|評価|星)$/i.test(lowerKey)
    ) {
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
      const { star, count } = findStarCountInObject(
        item as Record<string, unknown>,
      );
      setRatingBreakdownCount(byStar, star, count);
    }

    const explicit = normalizeExplicitRatingBreakdown(byStar);
    if (explicit) return explicit;

    const counts = value
      .map((item) =>
        typeof item === "number"
          ? item
          : typeof item === "string"
            ? toNumber(item)
            : undefined,
      )
      .filter((item): item is number => item !== undefined);
    return normalizeRatingBreakdown(counts, rating);
  }

  const record = value as Record<string, unknown>;
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};

  for (const [key, rawValue] of Object.entries(record)) {
    const starMatch =
      key.match(
        /(?:star|stars|rate|rating|score|評価|星)[_-]?([1-5])(?:[_-]?(?:count|num|total|件数))?$/i,
      ) ??
      key.match(/(?:count|num|total|件数)[_-]?([1-5])$/i) ??
      key.match(/^([1-5])$/);
    if (!starMatch?.[1]) continue;
    const count =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? toNumber(rawValue)
          : undefined;
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
      /(?:breakdown|detail|star|distribution|count|histogram|summary)/.test(
        lowerKey,
      )
    ) {
      const found =
        extractRatingBreakdownFromObject(childValue, rating) ??
        findRatingBreakdownInJson(childValue, rating, depth + 1);
      if (found) return found;
    }
  }

  for (const childValue of Object.values(record)) {
    const found = findRatingBreakdownInJson(childValue, rating, depth + 1);
    if (found) return found;
  }

  return undefined;
}

function extractRatingBreakdownFromText(
  text: string,
): ProductRatingBreakdown[] | undefined {
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};
  const normalizedText = decodeHtml(text)
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

  for (const star of [5, 4, 3, 2, 1] as const) {
    const patterns = [
      new RegExp(
        `星\\s*${star}\\s*つ?[\\s\\S]{0,120}?[（(]\\s*([0-9][0-9,]*)\\s*[)）]`,
        "i",
      ),
      new RegExp(`星\\s*${star}\\s*つ?[\\s\\S]{0,60}?([0-9][0-9,]*)`, "i"),
      new RegExp(
        `${star}\\s*つ星[\\s\\S]{0,120}?[（(]\\s*([0-9][0-9,]*)\\s*[)）]`,
        "i",
      ),
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

function extractRatingBreakdownFromDlsiteRatingMap(
  html: string,
): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));
  const byStar: Partial<Record<1 | 2 | 3 | 4 | 5, number>> = {};

  // DLsiteのhover後DOMは概ね以下の形。
  //   <dt class="rating_map_label"><p>星5つ</p></dt> ... <dd>(403)</dd>
  // タグの入れ子が崩れていても拾えるよう、rating_map_label から次の count dd を短い範囲で探す。
  const labelPattern =
    /class=["'][^"']*\brating_map_label\b[^"']*["'][\s\S]{0,240}?星\s*([1-5])\s*つ?[\s\S]{0,900}?[（(]\s*([0-9][0-9,]*)\s*[)）]/gi;
  for (const match of normalizedHtml.matchAll(labelPattern)) {
    setRatingBreakdownCount(byStar, Number(match[1]), toNumber(match[2]));
  }

  const direct = normalizeExplicitRatingBreakdown(byStar);
  if (direct) return direct;

  // class名が削られた断片にも対応。星ラベルの直後、次の星ラベルまでの最後の括弧数字を件数とする。
  for (const star of [5, 4, 3, 2, 1] as const) {
    const startMatch = normalizedHtml.match(
      new RegExp(`星\\s*${star}\\s*つ?`, "i"),
    );
    if (!startMatch || startMatch.index === undefined) continue;

    const startIndex = startMatch.index + startMatch[0].length;
    const nextStars = ([5, 4, 3, 2, 1] as const)
      .filter((nextStar) => nextStar !== star)
      .map((nextStar) =>
        normalizedHtml
          .slice(startIndex)
          .search(new RegExp(`星\\s*${nextStar}\\s*つ?`, "i")),
      )
      .filter((index) => index >= 0);
    const endIndex =
      nextStars.length > 0
        ? startIndex + Math.min(...nextStars)
        : Math.min(normalizedHtml.length, startIndex + 1200);
    const chunk = stripTags(normalizedHtml.slice(startIndex, endIndex));
    const parenNumbers = [...chunk.matchAll(/[（(]\s*([0-9][0-9,]*)\s*[)）]/g)]
      .map((match) => toNumber(match[1]))
      .filter((value): value is number => value !== undefined);

    if (parenNumbers.length > 0) {
      byStar[star] = Math.max(
        0,
        Math.floor(parenNumbers[parenNumbers.length - 1]),
      );
    }
  }

  return normalizeExplicitRatingBreakdown(byStar);
}

function extractRatingBreakdownFromRatingRows(
  html: string,
): ProductRatingBreakdown[] | undefined {
  return extractRatingBreakdownFromDlsiteRatingMap(html);
}

function findClosingTagEnd(
  html: string,
  startIndex: number,
  tagName: string,
): number | undefined {
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

function extractRatingBreakdownFromRatingPopup(
  html: string,
): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));
  const popupPattern =
    /<([a-z][a-z0-9]*)\b[^>]*(?:(?:class|id)=['"][^'"]*\brating_popup\b[^'"]*['"])[^>]*>/gi;

  for (const match of normalizedHtml.matchAll(popupPattern)) {
    const tagName = match[1];
    if (!tagName) continue;
    const startIndex = match.index ?? 0;
    const endIndex =
      findClosingTagEnd(normalizedHtml, startIndex, tagName) ??
      Math.min(normalizedHtml.length, startIndex + 8000);
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

function extractRatingBreakdownFromEmbeddedRatingPopupFragments(
  html: string,
): ProductRatingBreakdown[] | undefined {
  const normalizedHtml = decodeHtml(decodeJsEscapedUrl(html));

  // hover時にDOMへ挿入されるHTMLが、script内の文字列/templateとして埋まっているケース用。
  // rating_popup / rating_map を含む周辺だけを切り出して、同じパーサにかける。
  const markerPatterns = [
    /rating_popup/gi,
    /rating_map_label/gi,
    /rating_map_body/gi,
  ];
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

function extractRatingBreakdownFromHtmlAttributes(
  html: string,
): ProductRatingBreakdown[] | undefined {
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

function extractRatingBreakdown(
  html: string,
  text: string,
  rating?: number,
): ProductRatingBreakdown[] | undefined {
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
        const parsed = JSON.parse(
          decodeJsEscapedUrl(rawJson).replace(/'/g, '"'),
        ) as unknown;
        const found = extractRatingBreakdownFromObject(parsed, rating);
        if (found) return found;
      } catch {
        // HTML本文からの抽出へフォールバックする。
      }
    }
  }

  const scriptPattern =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
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

function extractLabeledSalesCountFromHtml(html: string): number | undefined {
  const normalizedHtml = decodeHtml(html);

  // 販売数はDLsiteのVue/JSテンプレート内に似たキーが多く、ページ全体をJSON風に拾うと
  // 別の数値を販売数として誤検知しやすい。
  // ここでは「販売数/DL数」ラベルの直後に表示されている数値だけをHTML fallbackとして採用する。
  const labelThenValuePatterns = [
    /<(?:th|dt|span|div|li)[^>]*>\s*(?:販売数|販売本数|DL数|ダウンロード数)\s*<\/(?:th|dt|span|div|li)>[\s\S]{0,300}?<(?:td|dd|span|div|li)[^>]*>\s*([0-9][0-9,]*)\s*(?:本|DL|ダウンロード)?\s*<\/(?:td|dd|span|div|li)>/i,
    /(?:販売数|販売本数|DL数|ダウンロード数)\s*[:：]\s*(?:<[^>]+>\s*){0,6}([0-9][0-9,]*)\s*(?:本|DL|ダウンロード)?/i,
  ];

  for (const pattern of labelThenValuePatterns) {
    const value = toNumber(normalizedHtml.match(pattern)?.[1]);
    if (value !== undefined) return value;
  }

  return undefined;
}

function extractLabeledSalesCountFromText(text: string): number | undefined {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const patterns = [
    /(?:販売数|販売本数|DL数|ダウンロード数)\s*[:：]\s*([0-9][0-9,]*)\s*(?:本|DL|ダウンロード)?/i,
    /(?:販売数|販売本数|DL数|ダウンロード数)\s+([0-9][0-9,]*)\s*(?:本|DL|ダウンロード)?/i,
  ];

  for (const pattern of patterns) {
    const value = toNumber(normalizedText.match(pattern)?.[1]);
    if (value !== undefined) return value;
  }

  return undefined;
}

function extractSalesCount(html: string, text: string): number | undefined {
  return (
    extractLabeledSalesCountFromHtml(html) ??
    extractLabeledSalesCountFromText(text)
  );
}

function extractPriceCurrent(html: string, text: string): number | undefined {
  return (
    toNumber(
      matchFirst(html, [
        /class=["'][^"']*(?:work_price|discount_price|price)[^"']*["'][^>]*>([\s\S]*?)<\//i,
        /itemprop=["']price["'][^>]+content=["']([^"']+)["']/i,
      ]),
    ) ??
    toNumber(text.match(/(?:販売価格|価格)\s*[:：]?\s*([0-9,]+)\s*円/)?.[1]) ??
    toNumber(text.match(/([0-9,]+)\s*円/)?.[1])
  );
}

type HtmlOnlyProbeResult = {
  priceCurrentFound: boolean;
  priceOriginalFound: boolean;
  discountRateFound: boolean;
  salesCountFound: boolean;
  salesCount?: number;
  ratingFound: boolean;
  reviewCountFound: boolean;
  releaseDateFound: boolean;
};

function buildHtmlOnlyProbeResult(
  html: string,
  text: string,
): HtmlOnlyProbeResult {
  const priceCurrent = extractPriceCurrent(html, text);
  const priceOriginal =
    toNumber(
      matchFirst(html, [
        /class=["'][^"']*(?:base_price|default_price|strike|regular_price)[^"']*["'][^>]*>([\s\S]*?)<\//i,
      ]),
    ) ??
    toNumber(text.match(/(?:通常価格|定価)\s*[:：]?\s*([0-9,]+)\s*円/)?.[1]);
  const discountRate =
    toNumber(text.match(/([0-9]{1,2})\s*%\s*OFF/i)?.[1]) ??
    toNumber(text.match(/([0-9]{1,2})\s*％\s*OFF/i)?.[1]);
  const salesCount = extractSalesCount(html, text);
  const rating = extractRating(html, text);
  const reviewCount = extractEvaluationCount(html, text);
  const releaseDate = normalizeReleaseDate(
    text.match(
      /(?:販売日|発売日)\s*[:：]?\s*(\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2})/,
    )?.[1] ??
      matchFirst(html, [
        /itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
      ]),
  );

  return {
    priceCurrentFound: priceCurrent !== undefined,
    priceOriginalFound: priceOriginal !== undefined,
    discountRateFound: discountRate !== undefined,
    salesCountFound: salesCount !== undefined,
    salesCount,
    ratingFound: rating !== undefined,
    reviewCountFound: reviewCount !== undefined,
    releaseDateFound: releaseDate !== undefined,
  };
}

function addHtmlOnlyProbeResultToTiming(
  timing: Required<ProductDetailParseTiming>,
  probe: HtmlOnlyProbeResult,
): void {
  timing.htmlProbeExecuted += 1;
  timing.htmlProbePriceCurrentFound += probe.priceCurrentFound ? 1 : 0;
  timing.htmlProbePriceOriginalFound += probe.priceOriginalFound ? 1 : 0;
  timing.htmlProbeDiscountRateFound += probe.discountRateFound ? 1 : 0;
  timing.htmlProbeSalesCountFound += probe.salesCountFound ? 1 : 0;
  timing.htmlProbeRatingFound += probe.ratingFound ? 1 : 0;
  timing.htmlProbeReviewCountFound += probe.reviewCountFound ? 1 : 0;
  timing.htmlProbeReleaseDateFound += probe.releaseDateFound ? 1 : 0;
}

function buildHtmlSalesCountAjaxComparison(
  htmlSalesCount: number | undefined,
  ajaxSalesCount: number | undefined,
): HtmlSalesCountAjaxComparison {
  if (htmlSalesCount === undefined && ajaxSalesCount === undefined) {
    return { status: "both_missing" };
  }
  if (htmlSalesCount === undefined) {
    return { status: "html_missing", ajaxSalesCount };
  }
  if (ajaxSalesCount === undefined) {
    return { status: "ajax_missing", htmlSalesCount };
  }
  return {
    status: htmlSalesCount === ajaxSalesCount ? "match" : "mismatch",
    htmlSalesCount,
    ajaxSalesCount,
  };
}

function addHtmlSalesCountAjaxComparisonToTiming(
  timing: Required<ProductDetailParseTiming>,
  comparison: HtmlSalesCountAjaxComparison,
): void {
  timing.htmlProbeSalesCountAjaxCompared += 1;
  switch (comparison.status) {
    case "match":
      timing.htmlProbeSalesCountAjaxMatch += 1;
      return;
    case "mismatch":
      timing.htmlProbeSalesCountAjaxMismatch += 1;
      return;
    case "html_missing":
      timing.htmlProbeSalesCountAjaxHtmlMissing += 1;
      return;
    case "ajax_missing":
      timing.htmlProbeSalesCountAjaxAjaxMissing += 1;
      return;
    case "both_missing":
      timing.htmlProbeSalesCountAjaxBothMissing += 1;
      return;
  }
}

async function extractProductDetail(
  html: string,
  sourceProductId: string,
  sourceUrl = buildSourceUrl(sourceProductId),
  options?: {
    parseMode?: ProductParseMode;
    htmlOnlyProbe?: boolean;
    onParseTiming?: (timing: ProductDetailParseTiming) => void;
    onHtmlSalesCountAjaxComparison?: (
      comparison: HtmlSalesCountAjaxComparison,
    ) => void;
  },
): Promise<RawProductDetail> {
  const parseMode = options?.parseMode ?? "full";
  const timing = createProductDetailParseTiming();

  const text = measureParseStep(timing, "parseBasicInfoMs", () =>
    stripTags(html),
  );
  const basicInfo = measureParseStep(timing, "parseBasicInfoMs", () => {
    const title =
      cleanText(
        findMetaContent(html, "og:title")?.replace(/\s*\|\s*DLsite.*$/i, ""),
      ) ??
      cleanText(
        matchFirst(html, [
          /<h1[^>]*id=["']work_name["'][^>]*>([\s\S]*?)<\/h1>/i,
          /<h1[^>]*>([\s\S]*?)<\/h1>/i,
        ]),
      ) ??
      sourceProductId;

    const seller = extractSeller(html);
    const hintTypes =
      sourceProductIdHints.get(sourceProductId) ?? new Set<RankingType>();
    const isAdult = /R18|18禁|成人向け|年齢確認/.test(text);
    const workTypeInfo = extractDlsiteWorkType(html, text);
    const contentTypeInfos = extractDlsiteContentTypes(html);
    const hintedContentType =
      sourceProductIdContentTypeHints.get(sourceProductId);
    const resolvedContentTypeInfos =
      contentTypeInfos.length > 0
        ? contentTypeInfos
        : hintedContentType
          ? [
              {
                contentType: hintedContentType,
                contentTypeLabel: hintedContentType === "bl" ? "BL" : "TL",
              },
            ]
          : [];

    return {
      title,
      seller,
      hintTypes,
      isAdult,
      workTypeInfo,
      resolvedContentTypeInfos,
    };
  });

  let htmlOnlyProbeSalesCount: number | undefined;
  if (options?.htmlOnlyProbe) {
    const probe = measureParseStep(timing, "htmlOnlyProbeMs", () =>
      buildHtmlOnlyProbeResult(html, text),
    );
    htmlOnlyProbeSalesCount = probe.salesCount;
    addHtmlOnlyProbeResultToTiming(timing, probe);
  }

  const ajaxInfo = await measureParseStepAsync(timing, "ajaxInfoFetchMs", () =>
    fetchProductInfoAjax(sourceProductId, { parseMode, sourceUrl }),
  );

  if (options?.htmlOnlyProbe) {
    const comparison = buildHtmlSalesCountAjaxComparison(
      htmlOnlyProbeSalesCount,
      ajaxInfo.salesCount,
    );
    addHtmlSalesCountAjaxComparisonToTiming(timing, comparison);
    options.onHtmlSalesCountAjaxComparison?.(comparison);
  }

  const images = await measureParseStepAsync(timing, "parseImagesMs", () =>
    extractImages(html, sourceProductId),
  );
  if (images.length === 0) {
    logger.warn("DLsite product images not found", {
      sourceProductId,
      sourceUrl,
      hasOgImage: Boolean(findMetaContent(html, "og:image")),
      hasWorkLeft: /id=["']work_left["']/i.test(html),
      hasProductSlider: /class=["'][^"']*\bproduct-slider\b/i.test(html),
      hasWorkSlider: /class=["'][^"']*\bwork_slider\b/i.test(html),
      containsSourceProductId: html
        .toLowerCase()
        .includes(sourceProductId.toLowerCase()),
    });
  }

  const priceInfo = measureParseStep(timing, "parsePriceMs", () => {
    const priceCurrent =
      ajaxInfo.priceCurrent ?? extractPriceCurrent(html, text);
    const priceOriginal =
      ajaxInfo.priceOriginal ??
      toNumber(
        matchFirst(html, [
          /class=["'][^"']*(?:base_price|default_price|strike|regular_price)[^"']*["'][^>]*>([\s\S]*?)<\//i,
        ]),
      ) ??
      toNumber(text.match(/(?:通常価格|定価)\s*[:：]?\s*([0-9,]+)\s*円/)?.[1]);
    const discountRate =
      ajaxInfo.discountRate ??
      toNumber(text.match(/([0-9]{1,2})\s*%\s*OFF/i)?.[1]) ??
      toNumber(text.match(/([0-9]{1,2})\s*％\s*OFF/i)?.[1]);

    return { priceCurrent, priceOriginal, discountRate };
  });

  const salesCount = measureParseStep(
    timing,
    "parseSalesMs",
    () => ajaxInfo.salesCount ?? extractSalesCount(html, text),
  );

  const ratingInfo = measureParseStep(timing, "parseRatingMs", () => {
    // DLsiteの評価内訳はpopup/template/埋め込み断片を広く走査するため重い。
    // 画面からは評価内訳を外しているため、初回全量取得向けfastでは平均評価・評価数までに留める。
    const reviewCount =
      ajaxInfo.reviewCount ?? extractEvaluationCount(html, text);
    const rating = ajaxInfo.rating ?? extractRating(html, text);
    const ratingBreakdown =
      parseMode === "fast"
        ? []
        : (ajaxInfo.ratingBreakdown ??
          extractRatingBreakdown(html, text, rating) ??
          []);

    return { reviewCount, rating, ratingBreakdown };
  });

  const releaseDate = measureParseStep(
    timing,
    "parseReleaseDateMs",
    () =>
      ajaxInfo.releaseDate ??
      normalizeReleaseDate(
        text.match(
          /(?:販売日|発売日)\s*[:：]?\s*(\d{4}[/.年-]\d{1,2}[/.月-]\d{1,2})/,
        )?.[1] ??
          matchFirst(html, [
            /itemprop=["']datePublished["'][^>]+content=["']([^"']+)["']/i,
          ]),
      ),
  );

  const genres = measureParseStep(timing, "parseGenresMs", () =>
    extractDlsiteMainGenres(html),
  );
  // DLsiteの keyword/tag/options 系リンクは「作品をもっと見る」「PDF同梱」など
  // 作品分類として使いづらいノイズが混ざりやすいため、MVPでは取得しない。
  // ジャンル導線は main_genre 由来の genres / genreIds に一本化する。
  const tags: string[] = [];

  const description = measureParseStep(timing, "parseDescriptionMs", () =>
    cleanText(findMetaContent(html, "description"))?.slice(0, 500),
  );

  const detail: RawProductDetail = {
    sourceProductId,
    title: basicInfo.title,
    sellerId: basicInfo.seller.sellerId,
    sellerName: basicInfo.seller.sellerName,
    sellerType: "circle",
    sellerUrl: basicInfo.seller.sellerUrl,
    priceCurrent: priceInfo.priceCurrent,
    priceOriginal: priceInfo.priceOriginal,
    discountRate: priceInfo.discountRate,
    salesCount,
    rating: ratingInfo.rating,
    ratingAverage: ratingInfo.rating,
    reviewCount: ratingInfo.reviewCount,
    ratingBreakdown: ratingInfo.ratingBreakdown,
    releaseDate,
    ageRating: basicInfo.isAdult ? "r18" : "all",
    workType: basicInfo.workTypeInfo.workType,
    workTypeLabel: basicInfo.workTypeInfo.workTypeLabel,
    contentTypes: basicInfo.resolvedContentTypeInfos.map(
      (item) => item.contentTypeLabel,
    ),
    contentTypeIds: basicInfo.resolvedContentTypeInfos.map(
      (item) => `dlsite:${item.contentType}`,
    ),
    thumbnailUrl: images[0]?.url,
    mainImageUrl: images[0]?.url,
    images,
    sourceUrl,
    affiliateUrl: "",
    description,
    genres,
    tags,
    genreIds: genres.map((genre) => `dlsite:${genre.toLowerCase()}`),
    tagIds: [],
    isNew: basicInfo.hintTypes.has("new"),
    isOnSale:
      basicInfo.hintTypes.has("sale") ||
      Boolean(priceInfo.discountRate && priceInfo.discountRate > 0),
  };

  options?.onParseTiming?.(timing);
  return detail;
}
function errorToDiagnostic(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const fields: string[] = [`name=${error.name}`, `message=${error.message}`];
  const cause = (error as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    fields.push(`causeName=${cause.name}`);
    fields.push(`causeMessage=${cause.message}`);
    const causeRecord = cause as Error & {
      code?: unknown;
      errno?: unknown;
      syscall?: unknown;
      hostname?: unknown;
      address?: unknown;
      port?: unknown;
    };
    for (const key of [
      "code",
      "errno",
      "syscall",
      "hostname",
      "address",
      "port",
    ] as const) {
      const value = causeRecord[key];
      if (value !== undefined) fields.push(`cause.${key}=${String(value)}`);
    }
  } else if (cause !== undefined) {
    fields.push(`cause=${String(cause)}`);
  }

  return fields.join(" ");
}

function isRetryableFetchError(error: unknown): boolean {
  if (error instanceof BlockedAccessError) return false;
  if (!(error instanceof Error)) return true;

  const statusMatch = error.message.match(/status=(\d{3})/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }

  const cause = (error as { cause?: unknown }).cause as
    { code?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? cause.code : undefined;
  return (
    !code ||
    [
      "ECONNRESET",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_HEADERS_TIMEOUT",
      "EAI_AGAIN",
      "ENOTFOUND",
      "ENETUNREACH",
      "EHOSTUNREACH",
    ].includes(code)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function fetchPublicHtml(url: string): Promise<string> {
  const failures: string[] = [];

  for (let attempt = 1; attempt <= FETCH_RETRY_COUNT; attempt += 1) {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: abortController.signal,
        headers: {
          "user-agent": USER_AGENT,
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "ja,en;q=0.8",
          "cache-control": "no-cache",
          pragma: "no-cache",
          referer: "https://www.dlsite.com/",
          "upgrade-insecure-requests": "1",
        },
      });

      if (response.status === 403 || response.status === 429) {
        throw new BlockedAccessError(
          `DLsite access blocked or rate limited: status=${response.status} url=${url}`,
        );
      }

      if (!response.ok) {
        throw new Error(
          `DLsite fetch failed: status=${response.status} url=${url}`,
        );
      }

      const html = await response.text();
      if (
        /captcha|reCAPTCHA|アクセスが集中|ただいま大変混み合って/.test(html)
      ) {
        throw new BlockedAccessError(
          `DLsite returned a block/captcha-like page: url=${url}`,
        );
      }

      return html;
    } catch (error) {
      const diagnostic = errorToDiagnostic(error);
      failures.push(`attempt=${attempt} ${diagnostic}`);

      if (error instanceof BlockedAccessError) {
        throw error;
      }

      if (attempt >= FETCH_RETRY_COUNT || !isRetryableFetchError(error)) {
        throw new Error(
          `DLsite fetch request failed: url=${url} failures=[${failures.join(" | ")}]`,
        );
      }

      logger.warn("DLsite fetch attempt failed; retrying", {
        url,
        attempt,
        diagnostic,
      });
      await delay(600 * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(
    `DLsite fetch request failed: url=${url} failures=[${failures.join(" | ")}]`,
  );
}

export type DlsiteProductDebugFloor = "auto" | "girls" | "tl" | "bl";

export type DlsiteProductDebugFetchResult = {
  sourceProductId: string;
  requestedFloor: DlsiteProductDebugFloor;
  selectedFloor: DlsiteFloor;
  sourceUrl: string;
  html: string;
  htmlLength: number;
  parsedImageCount: number;
  htmlImageCandidateCount: number;
  hasProductSlider: boolean;
  hasWorkSlider: boolean;
  rawProductDetail: RawProductDetail;
};

function normalizeDlsiteProductId(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^RJ\d{6,10}$/.test(normalized)) {
    throw new Error(`invalid DLsite productId: ${value}`);
  }
  return normalized;
}

function buildSourceUrlForDebugFloor(
  sourceProductId: string,
  floor: DlsiteProductDebugFloor,
): string {
  if (floor === "bl") return buildBlSourceUrl(sourceProductId);
  return buildSourceUrl(sourceProductId);
}

function selectedFloorFromUrl(url: string): DlsiteFloor {
  return /\/bl(?:-touch)?\/work\//i.test(url) ? "bl" : "girls";
}

export async function fetchDlsiteProductDetailForDebug(params: {
  sourceProductId: string;
  floor?: DlsiteProductDebugFloor;
}): Promise<DlsiteProductDebugFetchResult> {
  const sourceProductId = normalizeDlsiteProductId(params.sourceProductId);
  const requestedFloor = params.floor ?? "auto";
  const candidate =
    requestedFloor === "auto"
      ? await fetchBestProductDetailHtml(sourceProductId)
      : await (async (): Promise<ProductDetailHtmlCandidate> => {
          const url = buildSourceUrlForDebugFloor(
            sourceProductId,
            requestedFloor,
          );
          const html = await fetchPublicHtml(url);
          return {
            url,
            html,
            imageCount: countExtractedProductImages(html, sourceProductId),
            hasProductSlider: /class=["'][^"']*\bproduct-slider\b/i.test(html),
            hasWorkSlider: /class=["'][^"']*\bwork_slider\b/i.test(html),
          };
        })();

  const selectedFloor = selectedFloorFromUrl(candidate.url);
  sourceProductIdContentTypeHints.set(
    sourceProductId,
    selectedFloor === "bl" ? "bl" : "tl",
  );

  const rawProductDetail = await extractProductDetail(
    candidate.html,
    sourceProductId,
    candidate.url,
  );
  const rawImages =
    (rawProductDetail as { images?: ProductImage[] }).images ?? [];

  return {
    sourceProductId,
    requestedFloor,
    selectedFloor,
    sourceUrl: candidate.url,
    html: candidate.html,
    htmlLength: candidate.html.length,
    parsedImageCount: rawImages.length,
    htmlImageCandidateCount: candidate.imageCount,
    hasProductSlider: candidate.hasProductSlider,
    hasWorkSlider: candidate.hasWorkSlider,
    rawProductDetail,
  };
}

export const dlsiteFemaleDoujinAdapter: SourceAdapter = {
  key: "dlsite_female_doujin",
  target,

  async fetchRankingWorkIds(fetchTarget, options): Promise<RankingFetchResult> {
    const sourceUrls = buildListUrls(fetchTarget);
    if (!sourceUrls || sourceUrls.length === 0) {
      return { sourceProductIds: [], products: [], sourceUrl: undefined };
    }

    const listLimit = getListLimit(options);
    const failedMessages: string[] = [];
    let bestResult: ListCandidateFetchResult | undefined;

    for (const candidateUrl of sourceUrls) {
      try {
        const result = await fetchProductIdsFromListCandidate({
          candidateUrl,
          rankingType: fetchTarget.rankingType,
          listLimit,
        });

        if (
          !bestResult ||
          result.sourceProductIds.length > bestResult.sourceProductIds.length
        ) {
          bestResult = result;
        }

        if (result.sourceProductIds.length > 0) {
          logger.info("DLsite list candidate selected", {
            rankingType: fetchTarget.rankingType,
            candidateUrl,
            fetchedPageCount: result.fetchedPageCount,
            totalCount: result.sourceProductIds.length,
            listLimit,
          });
          break;
        }

        failedMessages.push(`no product ids found: ${candidateUrl}`);
      } catch (error) {
        if (error instanceof BlockedAccessError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : String(error);
        failedMessages.push(`${candidateUrl}: ${message}`);
      }
    }

    if (!bestResult || bestResult.sourceProductIds.length === 0) {
      throw new Error(
        `DLsite list fetch failed: ${fetchTarget.rankingType}: ${failedMessages.join(" / ")}`,
      );
    }

    const sourceProductIds = bestResult.sourceProductIds.slice(0, listLimit);
    for (const sourceProductId of sourceProductIds) {
      const hints =
        sourceProductIdHints.get(sourceProductId) ?? new Set<RankingType>();
      hints.add(fetchTarget.rankingType);
      sourceProductIdHints.set(sourceProductId, hints);
      if (fetchTarget.contentType) {
        sourceProductIdContentTypeHints.set(
          sourceProductId,
          fetchTarget.contentType,
        );
      }
    }

    logger.info("DLsite list ids fetched", {
      rankingType: fetchTarget.rankingType,
      totalCount: sourceProductIds.length,
      listLimit,
      sourceUrl: bestResult.sourceUrl,
    });

    return {
      sourceProductIds,
      products: bestResult.products.slice(0, listLimit),
      sourceUrl: bestResult.sourceUrl,
    };
  },

  async fetchProductDetail(
    sourceProductId: string,
    options?: ProductDetailFetchOptions,
  ): Promise<RawProductDetail> {
    const fetchHtmlStartedAt = Date.now();
    const candidate = await fetchBestProductDetailHtml(
      sourceProductId,
      options?.sourceUrl,
    );
    const fetchHtmlMs = Date.now() - fetchHtmlStartedAt;

    let parseTiming: ProductDetailParseTiming | undefined;
    let htmlSalesCountAjaxComparison: HtmlSalesCountAjaxComparison | undefined;
    const parseHtmlStartedAt = Date.now();
    const detail = await extractProductDetail(
      candidate.html,
      sourceProductId,
      candidate.url,
      {
        parseMode: options?.parseMode,
        htmlOnlyProbe: options?.htmlOnlyProbe,
        onParseTiming: (timing) => {
          parseTiming = timing;
        },
        onHtmlSalesCountAjaxComparison: (comparison) => {
          htmlSalesCountAjaxComparison = comparison;
        },
      },
    );
    const parseHtmlMs = Date.now() - parseHtmlStartedAt;

    options?.onTiming?.({
      fetchHtmlMs,
      parseHtmlMs,
      selectedUrl: candidate.url,
      htmlLength: candidate.html.length,
      parse: parseTiming,
      htmlSalesCountAjaxComparison,
    });

    return detail;
  },

  normalizeProduct,

  buildSourceUrl,

  buildAffiliateUrl(url: string) {
    return url;
  },
};
