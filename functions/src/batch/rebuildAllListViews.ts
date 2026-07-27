import { logger } from "firebase-functions";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type { FetchTarget } from "../types";
import { createRunId } from "../util";
import {
  rebuildNewListViewsForTargets,
  type RebuildNewListViewResult,
} from "./rebuildNewListView";
import {
  rebuildRankingListViewsForTargets,
  type RebuildRankingListViewResult,
} from "./rebuildRankingListView";
import {
  rebuildSellerListViewsForTargets,
  type RebuildSellerListViewResult,
} from "./rebuildSellerListView";
import {
  rebuildHomeDashboardListViewsForTargets,
  type RebuildHomeDashboardListViewResult,
} from "./rebuildHomeDashboardListView";
import {
  rebuildSaleListViewsForTargets,
  type RebuildSaleListViewResult,
} from "./rebuildSaleListView";

const STATE_COLLECTION = "systemJobs";
const STATE_DOCUMENT = "listViewRebuild";
const RUNS_COLLECTION = "listViewRebuildRuns";
const DEFAULT_LOCK_TTL_MS = 45 * 60 * 1000;
const ACTIVE_SOURCE_BATCH_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export const LIST_VIEW_COMPONENTS = [
  "new",
  "ranking",
  "seller",
  "home",
  "sale",
] as const;

export type ListViewComponentName = (typeof LIST_VIEW_COMPONENTS)[number];
export type ListViewComponentStatus = "success" | "partial" | "failed";

export type RebuildAllListViewsOptions = {
  includeDetails?: boolean;
  components?: ListViewComponentName[];
  triggerType?: "manual" | "schedule";
  triggerId?: string;
  resumeFailedComponents?: boolean;
  lockTtlMs?: number;
};

export type ListViewComponentRunResult = {
  status: ListViewComponentStatus;
  elapsedMs: number;
  summary?: Record<string, unknown>;
  details?: unknown;
  error?: string;
};

export type RebuildAllListViewsResult = {
  runId: string;
  triggerType: "manual" | "schedule";
  triggerId?: string;
  status: "success" | "partial" | "failed" | "blocked";
  partial: boolean;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  selectedComponents: ListViewComponentName[];
  retryComponents: ListViewComponentName[];
  activeSourceBatchRuns?: Array<{
    runId: string;
    jobName?: string;
    startedAt?: string;
  }>;
  blockedReason?: "list_view_rebuild_running" | "source_batch_running";
  activeRunId?: string;
  components: Partial<Record<ListViewComponentName, ListViewComponentRunResult>>;
};

type JobStateDocument = {
  status?: string;
  activeRunId?: string | null;
  lockExpiresAt?: Timestamp;
  lastTriggerId?: string;
  retryComponents?: unknown;
};

class RebuildLockBusyError extends Error {
  constructor(readonly activeRunId?: string) {
    super("list-view rebuild is already running");
    this.name = "RebuildLockBusyError";
  }
}

function normalizeComponents(values: unknown): ListViewComponentName[] {
  if (!Array.isArray(values)) return [];
  const allowed = new Set<ListViewComponentName>(LIST_VIEW_COMPONENTS);
  return [
    ...new Set(
      values.filter(
        (value): value is ListViewComponentName =>
          typeof value === "string" && allowed.has(value as ListViewComponentName),
      ),
    ),
  ];
}

function uniqueSegments(targets: FetchTarget[]): FetchTarget[] {
  const bySegment = new Map<string, FetchTarget>();
  for (const target of targets) {
    const key = `${target.platform}_${target.audience}_${target.category}`;
    if (!bySegment.has(key)) {
      bySegment.set(key, {
        platform: target.platform,
        audience: target.audience,
        category: target.category,
        rankingType: "daily",
      });
    }
  }
  return [...bySegment.values()];
}

function timestampToIso(value: unknown): string | undefined {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (
    value &&
    typeof value === "object" &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  ) {
    const date = (value as { toDate(): Date }).toDate();
    return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
  }
  return undefined;
}

async function findActiveSourceBatchRuns(): Promise<
  RebuildAllListViewsResult["activeSourceBatchRuns"]
> {
  const snapshot = await db
    .collection("batchRuns")
    .where("status", "==", "running")
    .limit(50)
    .get();
  const now = Date.now();
  const relevantJobs = new Set([
    "fetchDailyPriorityProducts",
    "fetchDailyProducts",
    "fetchGirlsReleaseOldProducts",
  ]);

  return snapshot.docs
    .map((doc) => {
      const data = doc.data() as {
        jobName?: unknown;
        startedAt?: unknown;
      };
      const jobName = typeof data.jobName === "string" ? data.jobName : undefined;
      const startedAt = timestampToIso(data.startedAt);
      const startedAtMillis = startedAt ? Date.parse(startedAt) : Number.NaN;
      return {
        runId: doc.id,
        jobName,
        startedAt,
        isRelevant: jobName ? relevantJobs.has(jobName) : false,
        isRecent:
          Number.isFinite(startedAtMillis) &&
          now - startedAtMillis <= ACTIVE_SOURCE_BATCH_MAX_AGE_MS,
      };
    })
    .filter((run) => run.isRelevant && run.isRecent)
    .map(({ runId, jobName, startedAt }) => ({ runId, jobName, startedAt }));
}

async function resolveSelectedComponents(
  requested: ListViewComponentName[] | undefined,
  triggerId: string | undefined,
  resumeFailedComponents: boolean,
): Promise<ListViewComponentName[]> {
  if (requested?.length) return normalizeComponents(requested);
  if (!resumeFailedComponents || !triggerId) return [...LIST_VIEW_COMPONENTS];

  const stateSnapshot = await db
    .collection(STATE_COLLECTION)
    .doc(STATE_DOCUMENT)
    .get();
  const state = stateSnapshot.data() as JobStateDocument | undefined;
  if (state?.lastTriggerId !== triggerId) return [...LIST_VIEW_COMPONENTS];

  const retryComponents = normalizeComponents(state.retryComponents);
  if (retryComponents.length > 0) return retryComponents;
  if (state.status === "success") return [];
  return [...LIST_VIEW_COMPONENTS];
}

async function acquireRunLock(params: {
  runId: string;
  triggerType: "manual" | "schedule";
  triggerId?: string;
  selectedComponents: ListViewComponentName[];
  startedAt: Timestamp;
  lockTtlMs: number;
}): Promise<void> {
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT);
  const runRef = db.collection(RUNS_COLLECTION).doc(params.runId);
  const lockExpiresAt = Timestamp.fromMillis(
    params.startedAt.toMillis() + params.lockTtlMs,
  );

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(stateRef);
    const state = snapshot.data() as JobStateDocument | undefined;
    const existingExpiry = state?.lockExpiresAt?.toMillis?.() ?? 0;
    if (
      state?.status === "running" &&
      state.activeRunId &&
      state.activeRunId !== params.runId &&
      existingExpiry > params.startedAt.toMillis()
    ) {
      throw new RebuildLockBusyError(state.activeRunId);
    }

    transaction.set(
      stateRef,
      {
        status: "running",
        activeRunId: params.runId,
        triggerType: params.triggerType,
        triggerId: params.triggerId ?? null,
        selectedComponents: params.selectedComponents,
        startedAt: params.startedAt,
        updatedAt: params.startedAt,
        lockExpiresAt,
      },
      { merge: true },
    );
    transaction.set(runRef, {
      runId: params.runId,
      status: "running",
      triggerType: params.triggerType,
      triggerId: params.triggerId ?? null,
      selectedComponents: params.selectedComponents,
      startedAt: params.startedAt,
      createdAt: params.startedAt,
      updatedAt: params.startedAt,
    });
  });
}

function summarizeNew(results: RebuildNewListViewResult[]): Record<string, unknown> {
  return {
    segmentCount: results.length,
    listCount: results.reduce((sum, value) => sum + value.listCount, 0),
    activatedListCount: results.reduce(
      (sum, value) => sum + value.activatedListCount,
      0,
    ),
    rejectedListCount: results.reduce(
      (sum, value) => sum + value.rejectedListCount,
      0,
    ),
    blockCount: results.reduce((sum, value) => sum + value.totalBlockCount, 0),
    compressedBytes: results.reduce(
      (sum, value) => sum + value.totalCompressedBytes,
      0,
    ),
  };
}

function summarizeRanking(
  results: RebuildRankingListViewResult[],
): Record<string, unknown> {
  return {
    segmentCount: results.length,
    listCount: results.reduce((sum, value) => sum + value.listCount, 0),
    activatedListCount: results.reduce(
      (sum, value) => sum + value.activatedListCount,
      0,
    ),
    preservedListCount: results.reduce(
      (sum, value) => sum + value.preservedListCount,
      0,
    ),
    rejectedListCount: results.reduce(
      (sum, value) => sum + value.rejectedListCount,
      0,
    ),
    blockCount: results.reduce((sum, value) => sum + value.totalBlockCount, 0),
    compressedBytes: results.reduce(
      (sum, value) => sum + value.totalCompressedBytes,
      0,
    ),
  };
}

function summarizeSeller(
  results: RebuildSellerListViewResult[],
): Record<string, unknown> {
  return {
    segmentCount: results.length,
    listCount: results.reduce((sum, value) => sum + value.listCount, 0),
    activatedListCount: results.reduce(
      (sum, value) => sum + value.activatedListCount,
      0,
    ),
    rejectedListCount: results.reduce(
      (sum, value) => sum + value.rejectedListCount,
      0,
    ),
    blockCount: results.reduce((sum, value) => sum + value.totalBlockCount, 0),
    compressedBytes: results.reduce(
      (sum, value) => sum + value.totalCompressedBytes,
      0,
    ),
  };
}

function summarizeHome(
  results: RebuildHomeDashboardListViewResult[],
): Record<string, unknown> {
  return {
    segmentCount: results.length,
    scopeCount: results.reduce((sum, value) => sum + value.scopeCount, 0),
    activatedScopeCount: results.reduce(
      (sum, value) => sum + value.activatedScopeCount,
      0,
    ),
    rejectedScopeCount: results.reduce(
      (sum, value) => sum + value.rejectedScopeCount,
      0,
    ),
    sectionCount: results.reduce(
      (sum, value) => sum + value.totalSectionCount,
      0,
    ),
    compressedBytes: results.reduce(
      (sum, value) => sum + value.totalCompressedBytes,
      0,
    ),
  };
}

function summarizeSale(results: RebuildSaleListViewResult[]): Record<string, unknown> {
  return {
    segmentCount: results.length,
    listCount: results.reduce((sum, value) => sum + value.listCount, 0),
    activatedListCount: results.reduce(
      (sum, value) => sum + value.activatedListCount,
      0,
    ),
    rejectedListCount: results.reduce(
      (sum, value) => sum + value.rejectedListCount,
      0,
    ),
    blockCount: results.reduce((sum, value) => sum + value.totalBlockCount, 0),
    compressedBytes: results.reduce(
      (sum, value) => sum + value.totalCompressedBytes,
      0,
    ),
  };
}

function statusFromRejectedCount(rejectedCount: number): ListViewComponentStatus {
  return rejectedCount === 0 ? "success" : "partial";
}

async function runComponent<T>(
  name: ListViewComponentName,
  task: () => Promise<T>,
  summarize: (value: T) => Record<string, unknown>,
  statusOf: (value: T) => ListViewComponentStatus,
  includeDetails: boolean,
): Promise<ListViewComponentRunResult> {
  const startedAt = Date.now();
  try {
    const value = await task();
    const result: ListViewComponentRunResult = {
      status: statusOf(value),
      elapsedMs: Date.now() - startedAt,
      summary: summarize(value),
      ...(includeDetails ? { details: value } : {}),
    };
    logger.info("List-view rebuild component finished", {
      component: name,
      ...result,
      details: undefined,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("List-view rebuild component failed", {
      component: name,
      error: message,
    });
    return {
      status: "failed",
      elapsedMs: Date.now() - startedAt,
      error: message,
    };
  }
}

async function finalizeRun(params: {
  runId: string;
  triggerId?: string;
  status: "success" | "partial" | "failed";
  retryComponents: ListViewComponentName[];
  components: RebuildAllListViewsResult["components"];
  startedAt: Timestamp;
  finishedAt: Timestamp;
}): Promise<void> {
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT);
  const runRef = db.collection(RUNS_COLLECTION).doc(params.runId);
  const storedComponents = Object.fromEntries(
    Object.entries(params.components).map(([name, value]) => [
      name,
      value
        ? {
            status: value.status,
            elapsedMs: value.elapsedMs,
            summary: value.summary,
            error: value.error,
          }
        : null,
    ]),
  );

  await db.runTransaction(async (transaction) => {
    const stateSnapshot = await transaction.get(stateRef);
    const state = stateSnapshot.data() as JobStateDocument | undefined;
    if (state?.activeRunId === params.runId) {
      transaction.set(
        stateRef,
        {
          status: params.status,
          activeRunId: null,
          lockExpiresAt: params.finishedAt,
          lastRunId: params.runId,
          lastTriggerId: params.triggerId ?? null,
          retryComponents: params.retryComponents,
          lastFinishedAt: params.finishedAt,
          updatedAt: params.finishedAt,
          ...(params.status === "success"
            ? {
                lastSuccessfulRunId: params.runId,
                lastSuccessfulAt: params.finishedAt,
              }
            : {}),
        },
        { merge: true },
      );
    }

    transaction.set(
      runRef,
      {
        status: params.status,
        retryComponents: params.retryComponents,
        components: storedComponents,
        finishedAt: params.finishedAt,
        elapsedMs: params.finishedAt.toMillis() - params.startedAt.toMillis(),
        updatedAt: params.finishedAt,
      },
      { merge: true },
    );
  });
}

export async function rebuildAllListViewsForTargets(
  targets: FetchTarget[],
  options: RebuildAllListViewsOptions = {},
): Promise<RebuildAllListViewsResult> {
  const triggerType = options.triggerType ?? "manual";
  const triggerId = options.triggerId;
  const startedAtTimestamp = Timestamp.now();
  const startedAtMillis = startedAtTimestamp.toMillis();
  const runId = createRunId("list_view_rebuild");
  const includeDetails = options.includeDetails === true;
  const segments = uniqueSegments(targets);
  const selectedComponents = await resolveSelectedComponents(
    options.components,
    triggerId,
    options.resumeFailedComponents === true,
  );

  if (selectedComponents.length === 0) {
    const finishedAt = new Date().toISOString();
    logger.info("Scheduled list-view rebuild already completed", {
      triggerId,
    });
    return {
      runId,
      triggerType,
      triggerId,
      status: "success",
      partial: false,
      startedAt: startedAtTimestamp.toDate().toISOString(),
      finishedAt,
      elapsedMs: Date.now() - startedAtMillis,
      selectedComponents: [],
      retryComponents: [],
      components: {},
    };
  }

  const activeSourceBatchRuns = await findActiveSourceBatchRuns();
  if (activeSourceBatchRuns && activeSourceBatchRuns.length > 0) {
    const finishedAt = new Date().toISOString();
    return {
      runId,
      triggerType,
      triggerId,
      status: "blocked",
      partial: false,
      startedAt: startedAtTimestamp.toDate().toISOString(),
      finishedAt,
      elapsedMs: Date.now() - startedAtMillis,
      selectedComponents,
      retryComponents: selectedComponents,
      activeSourceBatchRuns,
      blockedReason: "source_batch_running",
      components: {},
    };
  }

  try {
    await acquireRunLock({
      runId,
      triggerType,
      triggerId,
      selectedComponents,
      startedAt: startedAtTimestamp,
      lockTtlMs: Math.max(10 * 60 * 1000, options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS),
    });
  } catch (error) {
    if (error instanceof RebuildLockBusyError) {
      const finishedAt = new Date().toISOString();
      return {
        runId,
        triggerType,
        triggerId,
        status: "blocked",
        partial: false,
        startedAt: startedAtTimestamp.toDate().toISOString(),
        finishedAt,
        elapsedMs: Date.now() - startedAtMillis,
        selectedComponents,
        retryComponents: selectedComponents,
        blockedReason: "list_view_rebuild_running",
        activeRunId: error.activeRunId,
        components: {},
      };
    }
    throw error;
  }

  const components: RebuildAllListViewsResult["components"] = {};

  for (const component of selectedComponents) {
    switch (component) {
      case "new":
        components.new = await runComponent(
          "new",
          () => rebuildNewListViewsForTargets(segments, { includeLists: includeDetails }),
          summarizeNew,
          (results) =>
            statusFromRejectedCount(
              results.reduce((sum, value) => sum + value.rejectedListCount, 0),
            ),
          includeDetails,
        );
        break;
      case "ranking":
        components.ranking = await runComponent(
          "ranking",
          () =>
            rebuildRankingListViewsForTargets(segments, {
              includeLists: includeDetails,
            }),
          summarizeRanking,
          (results) =>
            statusFromRejectedCount(
              results.reduce((sum, value) => sum + value.rejectedListCount, 0),
            ),
          includeDetails,
        );
        break;
      case "seller":
        components.seller = await runComponent(
          "seller",
          () =>
            rebuildSellerListViewsForTargets(segments, {
              includeLists: includeDetails,
            }),
          summarizeSeller,
          (results) =>
            statusFromRejectedCount(
              results.reduce((sum, value) => sum + value.rejectedListCount, 0),
            ),
          includeDetails,
        );
        break;
      case "home":
        components.home = await runComponent(
          "home",
          () =>
            rebuildHomeDashboardListViewsForTargets(segments, {
              includeScopes: includeDetails,
            }),
          summarizeHome,
          (results) =>
            statusFromRejectedCount(
              results.reduce((sum, value) => sum + value.rejectedScopeCount, 0),
            ),
          includeDetails,
        );
        break;
      case "sale":
        components.sale = await runComponent(
          "sale",
          () => rebuildSaleListViewsForTargets(segments, { includeLists: includeDetails }),
          summarizeSale,
          (results) =>
            statusFromRejectedCount(
              results.reduce((sum, value) => sum + value.rejectedListCount, 0),
            ),
          includeDetails,
        );
        break;
    }
  }

  const retryComponents = selectedComponents.filter(
    (component) => components[component]?.status !== "success",
  );
  const status: "success" | "partial" | "failed" =
    retryComponents.length === 0
      ? "success"
      : retryComponents.length === selectedComponents.length &&
          retryComponents.every((component) => components[component]?.status === "failed")
        ? "failed"
        : "partial";
  const finishedAtTimestamp = Timestamp.now();

  await finalizeRun({
    runId,
    triggerId,
    status,
    retryComponents,
    components,
    startedAt: startedAtTimestamp,
    finishedAt: finishedAtTimestamp,
  });

  const result: RebuildAllListViewsResult = {
    runId,
    triggerType,
    triggerId,
    status,
    partial: status === "partial",
    startedAt: startedAtTimestamp.toDate().toISOString(),
    finishedAt: finishedAtTimestamp.toDate().toISOString(),
    elapsedMs: finishedAtTimestamp.toMillis() - startedAtTimestamp.toMillis(),
    selectedComponents,
    retryComponents,
    components,
  };

  logger.info("All list-view rebuild finished", {
    ...result,
    components: Object.fromEntries(
      Object.entries(result.components).map(([name, value]) => [
        name,
        value
          ? {
              status: value.status,
              elapsedMs: value.elapsedMs,
              summary: value.summary,
              error: value.error,
            }
          : undefined,
      ]),
    ),
  });

  return result;
}
