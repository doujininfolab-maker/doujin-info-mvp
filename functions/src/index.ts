import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getEnabledFetchTargets } from "./adapters";
import { fetchDailyProducts } from "./batch/fetchDailyProducts";
export { seedDummyProducts } from "./seed/seedDummyProducts";

function parsePositiveInt(value: unknown, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function parseStringParam(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isEmulator(): boolean {
  return process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST != null;
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
    const targets = getEnabledFetchTargets(process.env.DLSITE_RANKING_TYPES ?? "daily");
    const result = await fetchDailyProducts({
      targets,
      minIntervalMs: 2000,
      maxProductIdsPerTarget: 10,
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

    if (!isEmulator() && (!expected || key !== expected)) {
      res.status(403).json({ ok: false, message: "invalid manual fetch key" });
      return;
    }

    const maxProductIdsPerTarget = parsePositiveInt(req.query.detailLimit ?? req.query.limit, 10, 30);
    const listLimit = parsePositiveInt(req.query.listLimit, 20, 50);
    const minIntervalMs = parsePositiveInt(req.query.minIntervalMs, isEmulator() ? 1000 : 1500, 5000);

    process.env.DLSITE_LIST_LIMIT = String(listLimit);

    // デフォルトは安定取得できている daily のみ。
    // new / sale はDLsite側URL確認中のため、検証時だけ rankingTypes=daily,new,sale または rankingTypes=all で有効化する。
    const rankingTypes = parseStringParam(req.query.rankingTypes ?? req.query.types) ?? process.env.DLSITE_RANKING_TYPES ?? "daily";

    const result = await fetchDailyProducts({
      targets: getEnabledFetchTargets(rankingTypes),
      minIntervalMs,
      maxProductIdsPerTarget,
    });

    const ok = result.status === "success" || result.status === "partial";
    res.status(ok ? 200 : 500).json({
      ok,
      status: result.status,
      fetchedCount: result.fetchedCount ?? result.fetchedProductCount ?? 0,
      savedCount: result.savedCount ?? result.updatedProductCount ?? 0,
      skippedCount: result.skippedCount ?? result.skippedProductCount ?? 0,
      errorCount: result.errorCount ?? result.errorMessages.length,
      errors: result.errors ?? result.errorMessages,
      durationMs: result.durationMs,
      result,
    });
  },
);
