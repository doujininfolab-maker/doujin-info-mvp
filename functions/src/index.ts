import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";
import { getEnabledFetchTargets } from "./adapters";
import {
  dlsiteFemaleDoujinAdapter,
  fetchDlsiteProductDetailForDebug,
  type DlsiteProductDebugFloor,
} from "./adapters/dlsite/dlsiteFemaleDoujinAdapter";
import { fetchGirlsReleaseOldProducts } from "./batch/fetchGirlsReleaseOldProducts";
import { fetchDailyPriorityProducts } from "./batch/fetchDailyPriorityProducts";
import { db } from "./firebaseAdmin";
import {
  analyzeListViewDryRunForTargets,
  rebuildSiteStatsForTargetsDetailed,
} from "./batch/rebuildSiteStats";
import { backfillRankingMetrics } from "./batch/backfillRankingMetrics";
import { rebuildNewListViewsForTargets } from "./batch/rebuildNewListView";
import { rebuildRankingListViewsForTargets } from "./batch/rebuildRankingListView";
import { rebuildSellerListViewsForTargets } from "./batch/rebuildSellerListView";
import { rebuildHomeDashboardListViewsForTargets } from "./batch/rebuildHomeDashboardListView";
import { rebuildSaleListViewsForTargets } from "./batch/rebuildSaleListView";
import {
  LIST_VIEW_COMPONENTS,
  rebuildAllListViewsForTargets,
  type ListViewComponentName,
} from "./batch/rebuildAllListViews";
import { addDaysToDateKey } from "./batch/rankingMetrics";
import { nowTimestamp, toYyyyMMdd } from "./util";
import type { FetchTarget, ProductContentType } from "./types";

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

function parseIntegerListQuery(
  value: unknown,
  options: { min: number; max: number },
): number[] | undefined {
  const raw = firstQueryValue(value);
  if (!raw) return undefined;

  const values = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item))
    .map((item) => Math.min(options.max, Math.max(options.min, item)));

  return values.length > 0 ? [...new Set(values)] : undefined;
}

function parseListViewComponentsQuery(
  value: unknown,
): ListViewComponentName[] | undefined {
  const raw = firstQueryValue(value)?.trim().toLowerCase();
  if (!raw || raw === "all") return undefined;

  const allowed = new Set<ListViewComponentName>(LIST_VIEW_COMPONENTS);
  const components = raw
    .split(/[,.|+\s]+/)
    .filter((part): part is ListViewComponentName =>
      allowed.has(part as ListViewComponentName),
    );
  return components.length > 0 ? [...new Set(components)] : undefined;
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
    htmlOnlyProbe: parseBooleanQuery(query.htmlOnlyProbe, false),
    contentType: parseProductContentTypeQuery(
      query.contentType ?? query.floor ?? query.target ?? query.site,
    ),
    pageChunkSize: parseIntegerQuery(query.pageChunkSize, { min: 1, max: 50 }),
  };
}

function buildDailyPriorityFetchOptions(
  query: Record<string, unknown>,
  isEmulator: boolean,
) {
  const delayMs =
    parseIntegerQuery(query.delayMs ?? query.minIntervalMs, {
      min: 0,
      max: 60_000,
    }) ?? (isEmulator ? 10 : 30);

  return {
    delayMs,
    newReleaseLimit: parseIntegerQuery(query.newReleaseLimit, {
      min: 1,
      max: 20_000,
    }),
    popularLimit: parseIntegerQuery(query.popularLimit, {
      min: 1,
      max: 20_000,
    }),
    salesCountLimit: parseIntegerQuery(query.salesCountLimit, {
      min: 1,
      max: 20_000,
    }),
    commitProductCount: parseIntegerQuery(query.commitProductCount, {
      min: 1,
      max: 500,
    }),
    existingProductReadCount: parseIntegerQuery(query.existingProductReadCount, {
      min: 1,
      max: 2000,
    }),
    contentTypeSleepMs: parseIntegerQuery(query.contentTypeSleepMs, {
      min: 0,
      max: 60 * 60 * 1000,
    }),
    retrySleepMs: parseIntegerQuery(query.retrySleepMs, {
      min: 0,
      max: 60 * 60 * 1000,
    }),
    retryCount: parseIntegerQuery(query.retryCount, { min: 0, max: 5 }),
    dryRun: parseBooleanQuery(query.dryRun, false),
    parseMode: parseProductParseModeQuery(query.parseMode),
    rebuildStats: parseBooleanQuery(query.rebuildStats, true),
    contentTypes: parseProductContentTypesQuery(
      query.contentTypes ?? query.contentType ?? query.target,
    ),
    batchDate: parseYyyyMMddQuery(query.batchDate),
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

function parseProductContentTypesQuery(
  value: unknown,
): ProductContentType[] | undefined {
  const raw = firstQueryValue(value)?.trim().toLowerCase();
  if (!raw || raw === "all") return undefined;
  const contentTypes = raw
    .split(/[,.|+\s]+/)
    .map((part) => parseProductContentTypeQuery(part))
    .filter((part): part is ProductContentType => part !== undefined);
  return contentTypes.length > 0 ? [...new Set(contentTypes)] : undefined;
}

function parseYyyyMMddQuery(value: unknown): string | undefined {
  const raw = firstQueryValue(value)?.trim();
  return raw && /^\d{8}$/.test(raw) ? raw : undefined;
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

export const scheduledFetchDailyPriorityProducts = onRequest(
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

    const queryOptions = buildDailyPriorityFetchOptions(req.query, isEmulator);
    const rebuildStats = parseBooleanQuery(req.query.rebuildStats, false);
    const result = await fetchDailyPriorityProducts({
      ...queryOptions,
      contentTypes: ["tl"],
      contentTypeSleepMs: 0,
      rebuildStats,
      statsTargets: getEnabledFetchTargets(),
    });

    logger.info("scheduledFetchDailyPriorityProducts TL HTTP finished", result);
    res.json({
      ok: result.run.status === "success" || result.run.status === "partial",
      options: { ...queryOptions, contentTypes: ["tl"], rebuildStats },
      result,
    });
  },
);

export const scheduledFetchDailyPriorityProductsBl = onRequest(
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

    const queryOptions = buildDailyPriorityFetchOptions(req.query, isEmulator);
    const rebuildStats = parseBooleanQuery(req.query.rebuildStats, true);
    const result = await fetchDailyPriorityProducts({
      ...queryOptions,
      contentTypes: ["bl"],
      contentTypeSleepMs: 0,
      rebuildStats,
      statsTargets: getEnabledFetchTargets(),
    });

    logger.info("scheduledFetchDailyPriorityProducts BL HTTP finished", result);
    res.json({
      ok: result.run.status === "success" || result.run.status === "partial",
      options: { ...queryOptions, contentTypes: ["bl"], rebuildStats },
      result,
    });
  },
);

export const fetchDailyPriorityProductsNow = onRequest(
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

    const fetchOptions = buildDailyPriorityFetchOptions(req.query, isEmulator);
    const result = await fetchDailyPriorityProducts({
      ...fetchOptions,
      statsTargets: getEnabledFetchTargets(),
    });
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
    const saveProduct = parseBooleanQuery(req.query.saveProduct, false);
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

export const analyzeListViewDryRunNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
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

    const confirmReads = parseBooleanQuery(req.query.confirmReads, false);
    if (!isEmulator && !confirmReads) {
      res.status(400).json({
        ok: false,
        message: "confirmReads=true is required outside the emulator because this dry-run reads all active products once",
      });
      return;
    }

    const includeLists = parseBooleanQuery(req.query.includeLists, false);
    const blockSizes = parseIntegerListQuery(req.query.blockSizes, {
      min: 10,
      max: 2000,
    });
    const selectedBlockSize = parseIntegerQuery(req.query.selectedBlockSize, {
      min: 10,
      max: 2000,
    });
    const targetFunctionMemoryMiB = parseIntegerQuery(req.query.targetMemoryMiB, {
      min: 128,
      max: 32_768,
    });
    const result = await analyzeListViewDryRunForTargets(
      getEnabledFetchTargets(),
      {
        includeLists,
        blockSizes,
        selectedBlockSize,
        targetFunctionMemoryMiB,
      },
    );
    res.json({
      ok: true,
      ...result,
    });
  },
);

export const rebuildNewListViewNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 540,
    concurrency: 1,
    maxInstances: 1,
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

    const confirmWrites = parseBooleanQuery(req.query.confirmWrites, false);
    if (!isEmulator && !confirmWrites) {
      res.status(400).json({
        ok: false,
        message: "confirmWrites=true is required outside the emulator because this function writes new-list view versions",
      });
      return;
    }

    const includeLists = parseBooleanQuery(req.query.includeLists, false);
    try {
      const results = await rebuildNewListViewsForTargets(
        getEnabledFetchTargets(),
        { includeLists },
      );
      const rejectedListCount = results.reduce(
        (sum, result) => sum + result.rejectedListCount,
        0,
      );
      res.json({
        ok: rejectedListCount === 0,
        phase: 1,
        domain: "new",
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("rebuildNewListViewNow failed", { error: message });
      res.status(500).json({
        ok: false,
        phase: 1,
        domain: "new",
        message,
      });
    }
  },
);

export const rebuildRankingListViewNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 540,
    concurrency: 1,
    maxInstances: 1,
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

    const confirmWrites = parseBooleanQuery(req.query.confirmWrites, false);
    if (!isEmulator && !confirmWrites) {
      res.status(400).json({
        ok: false,
        message: "confirmWrites=true is required outside the emulator because this function writes ranking-list view versions",
      });
      return;
    }

    const includeLists = parseBooleanQuery(req.query.includeLists, false);
    try {
      const results = await rebuildRankingListViewsForTargets(
        getEnabledFetchTargets(),
        { includeLists },
      );
      const rejectedListCount = results.reduce(
        (sum, result) => sum + result.rejectedListCount,
        0,
      );
      res.json({
        ok: rejectedListCount === 0,
        phase: 2,
        domain: "ranking",
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("rebuildRankingListViewNow failed", { error: message });
      res.status(500).json({
        ok: false,
        phase: 2,
        domain: "ranking",
        message,
      });
    }
  },
);

export const rebuildSellerListViewNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 540,
    concurrency: 1,
    maxInstances: 1,
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

    const confirmWrites = parseBooleanQuery(req.query.confirmWrites, false);
    if (!isEmulator && !confirmWrites) {
      res.status(400).json({
        ok: false,
        message: "confirmWrites=true is required outside the emulator because this function writes seller-list view versions",
      });
      return;
    }

    const includeLists = parseBooleanQuery(req.query.includeLists, false);
    try {
      const results = await rebuildSellerListViewsForTargets(
        getEnabledFetchTargets(),
        { includeLists },
      );
      const rejectedListCount = results.reduce(
        (sum, result) => sum + result.rejectedListCount,
        0,
      );
      res.json({
        ok: rejectedListCount === 0,
        phase: 3,
        domain: "seller",
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("rebuildSellerListViewNow failed", { error: message });
      res.status(500).json({
        ok: false,
        phase: 3,
        domain: "seller",
        message,
      });
    }
  },
);

export const rebuildHomeDashboardListViewNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 540,
    concurrency: 1,
    maxInstances: 1,
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

    const confirmWrites = parseBooleanQuery(req.query.confirmWrites, false);
    if (!isEmulator && !confirmWrites) {
      res.status(400).json({
        ok: false,
        message: "confirmWrites=true is required outside the emulator because this function writes home-dashboard list view versions",
      });
      return;
    }

    const includeScopes = parseBooleanQuery(req.query.includeScopes, false);
    try {
      const results = await rebuildHomeDashboardListViewsForTargets(
        getEnabledFetchTargets(),
        { includeScopes },
      );
      const rejectedScopeCount = results.reduce(
        (sum, result) => sum + result.rejectedScopeCount,
        0,
      );
      res.json({
        ok: rejectedScopeCount === 0,
        phase: 4,
        domain: "home",
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("rebuildHomeDashboardListViewNow failed", { error: message });
      res.status(500).json({
        ok: false,
        phase: 4,
        domain: "home",
        message,
      });
    }
  },
);

export const rebuildSaleListViewNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 540,
    concurrency: 1,
    maxInstances: 1,
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

    const confirmWrites = parseBooleanQuery(req.query.confirmWrites, false);
    if (!isEmulator && !confirmWrites) {
      res.status(400).json({
        ok: false,
        message: "confirmWrites=true is required outside the emulator because this function writes sale-list view versions",
      });
      return;
    }

    const includeLists = parseBooleanQuery(req.query.includeLists, false);
    try {
      const results = await rebuildSaleListViewsForTargets(
        getEnabledFetchTargets(),
        { includeLists },
      );
      const rejectedListCount = results.reduce(
        (sum, result) => sum + result.rejectedListCount,
        0,
      );
      res.json({
        ok: rejectedListCount === 0,
        phase: 5,
        domain: "sale",
        results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("rebuildSaleListViewNow failed", { error: message });
      res.status(500).json({
        ok: false,
        phase: 5,
        domain: "sale",
        message,
      });
    }
  },
);

export const rebuildAllListViewsNow = onRequest(
  {
    region: "asia-northeast1",
    cors: true,
    memory: "1GiB",
    timeoutSeconds: 1800,
    concurrency: 1,
    maxInstances: 1,
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

    const confirmWrites = parseBooleanQuery(req.query.confirmWrites, false);
    if (!isEmulator && !confirmWrites) {
      res.status(400).json({
        ok: false,
        message:
          "confirmWrites=true is required outside the emulator because this function rebuilds all list-view versions",
      });
      return;
    }

    const includeDetails = parseBooleanQuery(req.query.includeDetails, false);
    const components = parseListViewComponentsQuery(req.query.components);

    try {
      const result = await rebuildAllListViewsForTargets(
        getEnabledFetchTargets(),
        {
          includeDetails,
          components,
          triggerType: "manual",
        },
      );
      if (result.status === "blocked") {
        res.status(409).json({ ok: false, phase: 6, domain: "all", ...result });
        return;
      }
      res.json({
        ok: result.status === "success",
        phase: 6,
        domain: "all",
        ...result,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("rebuildAllListViewsNow failed", { error: message });
      res.status(500).json({
        ok: false,
        phase: 6,
        domain: "all",
        message,
      });
    }
  },
);

export const scheduledRebuildAllListViews = onSchedule(
  {
    schedule: "0 4 * * *",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    memory: "1GiB",
    timeoutSeconds: 1800,
    concurrency: 1,
    maxInstances: 1,
    retryCount: 8,
    maxRetrySeconds: 4 * 60 * 60,
    minBackoffSeconds: 10 * 60,
    maxBackoffSeconds: 30 * 60,
    maxDoublings: 2,
  },
  async (event): Promise<void> => {
    const triggerId = `schedule:${event.scheduleTime}`;
    const result = await rebuildAllListViewsForTargets(
      getEnabledFetchTargets(),
      {
        triggerType: "schedule",
        triggerId,
        resumeFailedComponents: true,
      },
    );

    if (result.status !== "success") {
      logger.error("scheduledRebuildAllListViews did not complete successfully", {
        triggerId,
        status: result.status,
        blockedReason: result.blockedReason,
        retryComponents: result.retryComponents,
        activeSourceBatchRuns: result.activeSourceBatchRuns,
      });
      throw new Error(
        `scheduled list-view rebuild ${result.status}: ${
          result.blockedReason ?? result.retryComponents.join(",")
        }`,
      );
    }

    logger.info("scheduledRebuildAllListViews finished", {
      triggerId,
      runId: result.runId,
      elapsedMs: result.elapsedMs,
      selectedComponents: result.selectedComponents,
    });
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

    const result = await rebuildSiteStatsForTargetsDetailed(
      getEnabledFetchTargets(),
    );
    res.json({
      ok: result.status === "success",
      ...result,
    });
  },
);

export const backfillRankingMetricsNow = onRequest(
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

    const sourceDate = parseYyyyMMddQuery(req.query.sourceDate) ??
      addDaysToDateKey(toYyyyMMdd(), -1);
    const maxProducts = parseIntegerQuery(req.query.maxProducts, {
      min: 1,
      max: 20_000,
    }) ?? 20_000;
    const startAfterProductId = firstQueryValue(req.query.startAfterProductId)?.trim() || undefined;
    const rebuildStats = parseBooleanQuery(req.query.rebuildStats, true);
    const uniqueSegments = new Map<string, Pick<FetchTarget, "platform" | "audience" | "category">>();

    for (const target of getEnabledFetchTargets()) {
      const segment = {
        platform: target.platform,
        audience: target.audience,
        category: target.category,
      };
      uniqueSegments.set(`${segment.platform}_${segment.audience}_${segment.category}`, segment);
    }

    const results = [];
    for (const segment of uniqueSegments.values()) {
      results.push(await backfillRankingMetrics(segment, {
        sourceDate,
        maxProducts,
        startAfterProductId,
      }));
    }

    const complete = results.every((result) => result.complete);
    const siteStatsRebuild = rebuildStats && complete
      ? await rebuildSiteStatsForTargetsDetailed(
          [...uniqueSegments.values()].map((segment) => ({
            ...segment,
            rankingType: "daily" as const,
          })),
        )
      : undefined;

    res.json({
      ok: complete && (!siteStatsRebuild || siteStatsRebuild.status === "success"),
      sourceDate,
      maxProducts,
      rebuildStats,
      complete,
      results,
      siteStatsIds: siteStatsRebuild?.siteStatsIds ?? [],
      siteStatsRebuild,
    });
  },
);
