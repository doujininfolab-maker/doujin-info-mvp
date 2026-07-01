import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getEnabledFetchTargets } from "./adapters";
import { fetchDailyProducts } from "./batch/fetchDailyProducts";
import { rebuildSiteStatsForTargets } from "./batch/rebuildSiteStats";
export { seedDummyProducts } from "./seed/seedDummyProducts";


function firstQueryValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

function parseIntegerQuery(value: unknown, options: { min: number; max: number }): number | undefined {
  const raw = firstQueryValue(value);
  if (!raw) return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return undefined;

  const integer = Math.floor(parsed);
  if (integer < options.min) return options.min;
  if (integer > options.max) return options.max;
  return integer;
}

function buildManualFetchOptions(query: Record<string, unknown>, isEmulator: boolean) {
  return {
    listLimit: parseIntegerQuery(query.listLimit, { min: 1, max: 200 }),
    detailLimit: parseIntegerQuery(query.detailLimit, { min: 1, max: 200 }),
    minIntervalMs:
      parseIntegerQuery(query.minIntervalMs, { min: 0, max: 60_000 }) ?? (isEmulator ? 0 : 500),
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
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST != null;

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
    const isEmulator = process.env.FUNCTIONS_EMULATOR === "true" || process.env.FIRESTORE_EMULATOR_HOST != null;

    if (!isEmulator && (!expected || key !== expected)) {
      res.status(403).json({ ok: false, message: "invalid manual fetch key" });
      return;
    }

    const siteStatsIds = await rebuildSiteStatsForTargets(getEnabledFetchTargets());
    res.json({ ok: true, siteStatsIds });
  },
);
