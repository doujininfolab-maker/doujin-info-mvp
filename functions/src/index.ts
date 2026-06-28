import { onSchedule } from "firebase-functions/v2/scheduler";
import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import { getEnabledFetchTargets } from "./adapters";
import { fetchDailyProducts } from "./batch/fetchDailyProducts";
export { seedDummyProducts } from "./seed/seedDummyProducts";

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

    const result = await fetchDailyProducts({
      targets: getEnabledFetchTargets(),
      minIntervalMs: isEmulator ? 0 : 500,
    });
    res.json({ ok: true, result });
  },
);
