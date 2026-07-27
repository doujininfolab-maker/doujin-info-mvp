import { getEnabledFetchTargets } from "../adapters";
import { fetchDailyPriorityProducts } from "../batch/fetchDailyPriorityProducts";
import { rebuildAllListViewsForTargets } from "../batch/rebuildAllListViews";
import { rebuildSiteStatsForTargetsDetailed } from "../batch/rebuildSiteStats";

type CloudRunJobMode =
  | "collect-tl"
  | "collect-bl"
  | "rebuild-indexes"
  | "rebuild-list-views";

const COLLECTION_SUCCESS_STATUSES = new Set(["success", "partial"]);

function resolveJobMode(value: string | undefined): CloudRunJobMode {
  if (
    value === "collect-tl" ||
    value === "collect-bl" ||
    value === "rebuild-indexes" ||
    value === "rebuild-list-views"
  ) {
    return value;
  }

  throw new Error(
    `JOB_MODE must be one of collect-tl, collect-bl, rebuild-indexes, rebuild-list-views; received ${value ?? "(not set)"}`,
  );
}

function parseOptionalInteger(
  name: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return defaultValue;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}; received ${raw}`,
    );
  }
  return parsed;
}

function parseOptionalBatchDate(): string | undefined {
  const value = process.env.BATCH_DATE?.trim();
  if (!value) return undefined;
  if (!/^\d{8}$/.test(value)) {
    throw new Error(`BATCH_DATE must use YYYYMMDD format; received ${value}`);
  }
  return value;
}

function executionId(): string {
  return (
    process.env.CLOUD_RUN_EXECUTION ??
    process.env.CLOUD_RUN_TASK_ID ??
    `local-${Date.now()}`
  );
}

async function runCollection(contentType: "tl" | "bl"): Promise<void> {
  const result = await fetchDailyPriorityProducts({
    contentTypes: [contentType],
    contentTypeSleepMs: 0,
    delayMs: parseOptionalInteger("DLSITE_DELAY_MS", 30, 0, 60_000),
    retryCount: parseOptionalInteger("DLSITE_RETRY_COUNT", 1, 0, 5),
    retrySleepMs: parseOptionalInteger(
      "DLSITE_RETRY_SLEEP_MS",
      90_000,
      0,
      60 * 60 * 1000,
    ),
    parseMode: "fast",
    rebuildStats: false,
    batchDate: parseOptionalBatchDate(),
  });

  const status = result.run.status;
  const summary = {
    mode: `collect-${contentType}`,
    runId: result.run.runId,
    status,
    batchDate: result.batchDate,
    fetchedProductCount: result.run.fetchedProductCount,
    failedProductCount: result.run.failedProductCount,
    skippedProductCount: result.run.skippedProductCount,
    rankingSnapshotIds: result.rankingSnapshotIds,
    errorMessages: result.run.errorMessages,
  };

  if (!COLLECTION_SUCCESS_STATUSES.has(status)) {
    console.error("Cloud Run collection job failed", summary);
    throw new Error(`${contentType.toUpperCase()} collection failed: ${status}`);
  }

  if (status === "partial") {
    console.warn("Cloud Run collection job completed partially", summary);
  } else {
    console.log("Cloud Run collection job completed", summary);
  }
}

async function runIndexRebuild(): Promise<void> {
  const result = await rebuildSiteStatsForTargetsDetailed(
    getEnabledFetchTargets(),
  );

  if (result.status !== "success") {
    console.error("Cloud Run index rebuild completed partially", result);
    throw new Error("siteStats and index rebuild did not fully succeed");
  }

  console.log("Cloud Run index rebuild completed", {
    status: result.status,
    siteStatsIds: result.siteStatsIds,
    segments: result.segments.map((segment) => ({
      segmentId: segment.segmentId,
      productCount: segment.productCount,
      components: Object.fromEntries(
        Object.entries(segment.components).map(([name, component]) => [
          name,
          component.status,
        ]),
      ),
    })),
  });
}

async function runListViewRebuild(): Promise<void> {
  const triggerId = `cloud-run-job:${executionId()}`;
  const result = await rebuildAllListViewsForTargets(
    getEnabledFetchTargets(),
    {
      triggerType: "schedule",
      triggerId,
      resumeFailedComponents: false,
      includeDetails: false,
      lockTtlMs: 2 * 60 * 60 * 1000,
    },
  );

  if (result.status !== "success") {
    console.error("Cloud Run list-view rebuild failed", {
      triggerId,
      status: result.status,
      blockedReason: result.blockedReason,
      retryComponents: result.retryComponents,
      activeSourceBatchRuns: result.activeSourceBatchRuns,
      components: result.components,
    });
    throw new Error(
      `list-view rebuild ${result.status}: ${
        result.blockedReason ?? result.retryComponents.join(",")
      }`,
    );
  }

  console.log("Cloud Run list-view rebuild completed", {
    triggerId,
    runId: result.runId,
    elapsedMs: result.elapsedMs,
    selectedComponents: result.selectedComponents,
  });
}

async function main(): Promise<void> {
  const mode = resolveJobMode(process.env.JOB_MODE);
  const startedAt = Date.now();

  console.log("Doujin Info Cloud Run job started", {
    mode,
    executionId: executionId(),
    startedAt: new Date(startedAt).toISOString(),
  });

  switch (mode) {
    case "collect-tl":
      await runCollection("tl");
      break;
    case "collect-bl":
      await runCollection("bl");
      break;
    case "rebuild-indexes":
      await runIndexRebuild();
      break;
    case "rebuild-list-views":
      await runListViewRebuild();
      break;
  }

  console.log("Doujin Info Cloud Run job finished", {
    mode,
    elapsedMs: Date.now() - startedAt,
  });
}

void main().catch((error: unknown) => {
  console.error("Doujin Info Cloud Run job terminated with an error", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
