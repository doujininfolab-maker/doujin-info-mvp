import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getEnabledFetchTargets } from "./adapters";
import {
  dlsiteFemaleDoujinAdapter,
  fetchDlsiteProductDetailForDebug,
  type DlsiteProductDebugFloor,
} from "./adapters/dlsite/dlsiteFemaleDoujinAdapter";
import { fetchDailyProducts } from "./batch/fetchDailyProducts";
import { fetchGirlsReleaseOldProducts } from "./batch/fetchGirlsReleaseOldProducts";
import { db } from "./firebaseAdmin";
import { rebuildSiteStatsForTargets } from "./batch/rebuildSiteStats";
import { nowTimestamp } from "./util";
import type { FetchTarget, ProductContentType } from "./types";
export { seedDummyProducts } from "./seed/seedDummyProducts";

function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parseIntegerQuery(
  value: unknown,
  options: { min: number; max: number },
): number | undefined {
  const raw = firstQueryValue(value);
  if (!raw) return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;

  const integer = Math.floor(parsed);
  if (integer < options.min) return options.min;
  if (integer > options.max) return options.max;
  return integer;
}

function buildManualFetchOptions(
  query: Record<string, unknown>,
  isEmulator: boolean,
) {
  return {
    listLimit: parseIntegerQuery(query.listLimit, { min: 1, max: 200 }),
    detailLimit: parseIntegerQuery(query.detailLimit, { min: 0, max: 200 }),
    minIntervalMs:
      parseIntegerQuery(query.minIntervalMs, { min: 0, max: 60_000 }) ??
      (isEmulator ? 0 : 500),
    listOnly: parseBooleanQuery(query.listOnly, false),
    skipFreshHours: parseIntegerQuery(query.skipFreshHours, {
      min: 0,
      max: 24 * 30,
    }),
  };
}

function buildGirlsReleaseOldFetchOptions(
  query: Record<string, unknown>,
  isEmulator: boolean,
) {
  const delayMs =
    parseIntegerQuery(query.delayMs ?? query.minIntervalMs, {
      min: 0,
      max: 60_000,
    }) ?? (isEmulator ? 0 : 500);

  return {
    maxPages: parseIntegerQuery(query.maxPages, { min: 1, max: 500 }),
    startPage: parseIntegerQuery(query.startPage, { min: 1, max: 500 }),
    delayMs,
    dryRun: parseBooleanQuery(query.dryRun, false),
    detailLimit: parseIntegerQuery(query.detailLimit, { min: 0, max: 5000 }),
    skipFreshHours: parseIntegerQuery(query.skipFreshHours, {
      min: 0,
      max: 24 * 30,
    }),
    saveDiscovery: parseBooleanQuery(query.saveDiscovery, true),
    saveDailyMetrics: parseBooleanQuery(query.saveDailyMetrics, true),
    saveDailySalesDelta: parseBooleanQuery(query.saveDailySalesDelta, false),
    progressLogEvery: parseIntegerQuery(query.progressLogEvery, {
      min: 0,
      max: 5000,
    }),
    parseMode: parseProductParseModeQuery(query.parseMode),
    contentType: parseProductContentTypeQuery(
      query.contentType ?? query.floor ?? query.target ?? query.site,
    ),
    pageChunkSize: parseIntegerQuery(query.pageChunkSize, { min: 1, max: 50 }),
  };
}

function parseBooleanQuery(value: unknown, defaultValue: boolean): boolean {
  const raw = firstQueryValue(value)?.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "y", "on"].includes(raw)) return true;
  if (["0", "false", "no", "n", "off"].includes(raw)) return false;
  return defaultValue;
}

function parseProductParseModeQuery(
  value: unknown,
): "full" | "fast" | undefined {
  const raw = firstQueryValue(value)?.trim().toLowerCase();
  if (raw === "fast") return "fast";
  if (raw === "full") return "full";
  return undefined;
}

function parseProductContentTypeQuery(
  value: unknown,
): ProductContentType | undefined {
  const raw = firstQueryValue(value)?.trim().toLowerCase();
  if (raw === "bl" || raw === "boyslove") return "bl";
  if (raw === "tl" || raw === "girls" || raw === "girl" || raw === "otome")
    return "tl";
  return undefined;
}

function parseDlsiteDebugFloor(value: unknown): DlsiteProductDebugFloor {
  const raw = firstQueryValue(value)?.trim().toLowerCase();
  if (raw === "bl") return "bl";
  if (raw === "girls" || raw === "tl") return raw;
  return "auto";
}

function normalizeDlsiteDebugProductId(value: unknown): string | undefined {
  const raw = firstQueryValue(value)?.trim().toUpperCase();
  if (!raw) return undefined;
  return /^RJ\d{6,10}$/.test(raw) ? raw : undefined;
}

function inferContentTypeForDebug(
  floor: "girls" | "bl",
  contentTypeIds?: string[],
): ProductContentType {
  if (contentTypeIds?.some((value) => value.toLowerCase() === "dlsite:bl"))
    return "bl";
  if (contentTypeIds?.some((value) => value.toLowerCase() === "dlsite:tl"))
    return "tl";
  return floor === "bl" ? "bl" : "tl";
}

function buildDebugTarget(contentType: ProductContentType): FetchTarget {
  return {
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    rankingType: "daily",
    contentType,
  };
}

function errorToDebugPayload(error: unknown): {
  message: string;
  name?: string;
  cause?: string;
} {
  if (!(error instanceof Error)) return { message: String(error) };

  const cause = (error as { cause?: unknown }).cause;
  return {
    message: error.message,
    name: error.name,
    cause:
      cause instanceof Error
        ? `${cause.name}: ${cause.message}`
        : cause === undefined
          ? undefined
          : String(cause),
  };
}

export const scheduledFetchDailyAllSources = onSchedule(
  {
    schedule: "every day 03:00",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (): Promise<void> => {
    const targets = getEnabledFetchTargets();
    const result = await fetchDailyProducts({
      targets,
      minIntervalMs: 500,
    });
    logger.info("scheduledFetchDailyAllSources finished", result);
  },
);

export const fetchDailyAllSourcesNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (req, res): Promise<void> => {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const expected = process.env.MANUAL_FETCH_KEY;
    const isEmulator =
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIRESTORE_EMULATOR_HOST != null;

    if (!isEmulator && (!expected || key !== expected)) {
      res.status(403).json({ ok: false, message: "invalid manual fetch key" });
      return;
    }

    const fetchOptions = buildManualFetchOptions(req.query, isEmulator);
    const result = await fetchDailyProducts({
      targets: getEnabledFetchTargets(),
      ...fetchOptions,
    });
    res.json({ ok: true, options: fetchOptions, result });
  },
);

export const fetchGirlsReleaseOldNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 3600,
  },
  async (req, res): Promise<void> => {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const expected = process.env.MANUAL_FETCH_KEY;
    const isEmulator =
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIRESTORE_EMULATOR_HOST != null;

    if (!isEmulator && (!expected || key !== expected)) {
      res.status(403).json({ ok: false, message: "invalid manual fetch key" });
      return;
    }

    const fetchOptions = buildGirlsReleaseOldFetchOptions(
      req.query,
      isEmulator,
    );
    const result = await fetchGirlsReleaseOldProducts(fetchOptions);
    res.json({
      ok: result.run.status === "success" || result.run.status === "partial",
      options: fetchOptions,
      result,
    });
  },
);

export const fetchDlsiteProductDebug = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async (req, res): Promise<void> => {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const expected = process.env.MANUAL_FETCH_KEY;
    const isEmulator =
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIRESTORE_EMULATOR_HOST != null;

    if (!isEmulator && (!expected || key !== expected)) {
      res.status(403).json({ ok: false, message: "invalid manual fetch key" });
      return;
    }

    const sourceProductId = normalizeDlsiteDebugProductId(
      req.query.productId ?? req.query.sourceProductId,
    );
    if (!sourceProductId) {
      res
        .status(400)
        .json({ ok: false, message: "productId must be like RJ01234567" });
      return;
    }

    const floor = parseDlsiteDebugFloor(req.query.floor);
    const saveProduct = parseBooleanQuery(req.query.saveProduct, true);
    const saveHtml = parseBooleanQuery(req.query.saveHtml, false);

    try {
      const debugResult = await fetchDlsiteProductDetailForDebug({
        sourceProductId,
        floor,
      });
      const rawForType = debugResult.rawProductDetail as {
        contentTypeIds?: string[];
        images?: unknown[];
      };
      const contentType = inferContentTypeForDebug(
        debugResult.selectedFloor,
        rawForType.contentTypeIds,
      );
      const target = buildDebugTarget(contentType);
      const product = dlsiteFemaleDoujinAdapter.normalizeProduct(
        debugResult.rawProductDetail,
        target,
      );

      let debugHtmlDocId: string | undefined;
      if (saveHtml) {
        const createdAt = nowTimestamp();
        debugHtmlDocId = `${sourceProductId}_${Date.now()}`;
        const maxHtmlLength = 850_000;
        await db
          .collection("debugDlsiteProductHtml")
          .doc(debugHtmlDocId)
          .set({
            debugHtmlDocId,
            sourceProductId,
            requestedFloor: debugResult.requestedFloor,
            selectedFloor: debugResult.selectedFloor,
            sourceUrl: debugResult.sourceUrl,
            htmlLength: debugResult.htmlLength,
            storedHtmlLength: Math.min(debugResult.html.length, maxHtmlLength),
            isHtmlTruncated: debugResult.html.length > maxHtmlLength,
            html: debugResult.html.slice(0, maxHtmlLength),
            parsedImageCount: debugResult.parsedImageCount,
            htmlImageCandidateCount: debugResult.htmlImageCandidateCount,
            hasProductSlider: debugResult.hasProductSlider,
            hasWorkSlider: debugResult.hasWorkSlider,
            createdAt,
          });
      }

      if (saveProduct) {
        await db
          .collection("products")
          .doc(product.productId)
          .set(product, { merge: true });
      }

      logger.info("fetchDlsiteProductDebug finished", {
        sourceProductId,
        floor,
        selectedFloor: debugResult.selectedFloor,
        sourceUrl: debugResult.sourceUrl,
        saveProduct,
        saveHtml,
        productId: product.productId,
        parsedImageCount: debugResult.parsedImageCount,
        htmlImageCandidateCount: debugResult.htmlImageCandidateCount,
      });

      res.json({
        ok: true,
        options: {
          productId: sourceProductId,
          floor,
          saveProduct,
          saveHtml,
        },
        debug: {
          sourceProductId,
          selectedFloor: debugResult.selectedFloor,
          sourceUrl: debugResult.sourceUrl,
          htmlLength: debugResult.htmlLength,
          parsedImageCount: debugResult.parsedImageCount,
          htmlImageCandidateCount: debugResult.htmlImageCandidateCount,
          hasProductSlider: debugResult.hasProductSlider,
          hasWorkSlider: debugResult.hasWorkSlider,
          debugHtmlDocId,
        },
        product: {
          productId: product.productId,
          title: product.title,
          sourceUrl: product.sourceUrl,
          contentTypes: product.contentTypes,
          contentTypeIds: product.contentTypeIds,
          workType: product.workType,
          workTypeLabel: product.workTypeLabel,
          imageCount: product.images.length,
          images: product.images.slice(0, 20),
          seller: product.seller,
          priceCurrent: product.priceCurrent,
          salesCount: product.salesCount,
          rating: product.rating,
          reviewCount: product.reviewCount,
          releaseDate: product.releaseDate,
          genres: product.genres,
        },
      });
    } catch (error) {
      const errorPayload = errorToDebugPayload(error);
      logger.error("fetchDlsiteProductDebug failed", {
        sourceProductId,
        floor,
        ...errorPayload,
      });
      res
        .status(500)
        .json({
          ok: false,
          productId: sourceProductId,
          floor,
          ...errorPayload,
        });
    }
  },
);

export const rebuildSiteStatsNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (req, res): Promise<void> => {
    const key = typeof req.query.key === "string" ? req.query.key : undefined;
    const expected = process.env.MANUAL_FETCH_KEY;
    const isEmulator =
      process.env.FUNCTIONS_EMULATOR === "true" ||
      process.env.FIRESTORE_EMULATOR_HOST != null;

    if (!isEmulator && (!expected || key !== expected)) {
      res.status(403).json({ ok: false, message: "invalid manual fetch key" });
      return;
    }

    const siteStatsIds = await rebuildSiteStatsForTargets(
      getEnabledFetchTargets(),
    );
    res.json({ ok: true, siteStatsIds });
  },
);
