import { withGenreSourceMutation } from "../batch/genreDetailView";
import { createHash, randomUUID } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type { FetchTarget, Platform, Product } from "../types";
import { rebuildSiteStatsForTargetsDetailed } from "../batch/rebuildSiteStats";
import { rebuildAllListViewsForTargets } from "../batch/rebuildAllListViews";
import {
  buildSellerVisibilityKey,
  clearContentVisibilityRuntimeCache,
  CONTENT_VISIBILITY_RUNTIME_COLLECTION,
  CONTENT_VISIBILITY_RUNTIME_DOCUMENT,
  CONTENT_VISIBILITY_RUNTIME_MAX_KEYS,
  getContentVisibilityRuntime,
  materializeProductVisibility,
} from "./contentVisibility";

const CONTROLS_COLLECTION = "contentVisibilityControls";
const EVENTS_COLLECTION = "contentVisibilityEvents";
const STATE_COLLECTION = "contentVisibilityState";
const STATE_DOCUMENT = "current";

export type VisibilityEntityType = "product" | "seller";
export type VisibilityAction = "hide" | "restore";
export type VisibilityControlState = "hidden" | "visible";

export type VisibilityTarget = {
  entityType: VisibilityEntityType;
  platform: Platform;
  productId?: string;
  sourceSellerId?: string;
};

export type VisibilityPlan = VisibilityTarget & {
  action: VisibilityAction;
  controlId: string;
  currentState: VisibilityControlState | "unset";
  runtimeRevision: number;
  sellerName?: string;
  affectedProductCount: number;
  affectedProductIds: string[];
  affectedSegments: string[];
  planHash: string;
};

export type VisibilityOperationResult = {
  operationId: string;
  controlId: string;
  action: VisibilityAction;
  revision: number;
  affectedProductCount: number;
  affectedSegments: string[];
  status: "materialized" | "rebuilt";
  rebuildSkipped: boolean;
};

type ProductDocument = { ref: FirebaseFirestore.DocumentReference; product: Product };

function nonEmpty(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function controlIdFor(target: VisibilityTarget): string {
  const stableKey = target.entityType === "product"
    ? nonEmpty(target.productId, "productId")
    : nonEmpty(target.sourceSellerId, "sellerId");
  return createHash("sha256")
    .update(`${target.entityType}|${target.platform}|${stableKey}`, "utf8")
    .digest("hex");
}

function segmentId(product: Product): string {
  return `${product.platform}_${product.audience}_${product.category}`;
}

function targetsFromProducts(products: Product[]): FetchTarget[] {
  const targets = new Map<string, FetchTarget>();
  for (const product of products) {
    const id = segmentId(product);
    if (!targets.has(id)) {
      targets.set(id, {
        platform: product.platform,
        audience: product.audience,
        category: product.category,
        rankingType: "daily",
      });
    }
  }
  return [...targets.values()];
}

async function loadTargetProducts(target: VisibilityTarget): Promise<ProductDocument[]> {
  if (target.entityType === "seller") {
    const sellerId = nonEmpty(target.sourceSellerId, "sellerId");
    const snapshot = await db
      .collection("products")
      .where("platform", "==", target.platform)
      .where("seller.sellerId", "==", sellerId)
      .get();
    return snapshot.docs.map((doc) => ({
      ref: doc.ref,
      product: { ...doc.data(), productId: doc.id } as Product,
    }));
  }

  const requestedId = nonEmpty(target.productId, "productId");
  const direct = await db.collection("products").doc(requestedId).get();
  if (direct.exists) {
    const product = { ...direct.data(), productId: direct.id } as Product;
    if (product.platform !== target.platform) {
      throw new Error(`Product platform mismatch: ${requestedId}`);
    }
    return [{ ref: direct.ref, product }];
  }

  const bySource = await db
    .collection("products")
    .where("platform", "==", target.platform)
    .where("sourceProductId", "==", requestedId)
    .limit(2)
    .get();
  if (bySource.size > 1) {
    throw new Error(`Product ID is ambiguous: ${requestedId}`);
  }
  return bySource.docs.map((doc) => ({
    ref: doc.ref,
    product: { ...doc.data(), productId: doc.id } as Product,
  }));
}

function timestampValue(value: unknown): number | null {
  return value && typeof value === "object" && "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
    ? (value as { toMillis(): number }).toMillis()
    : null;
}

function hashPlan(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function buildVisibilityPlan(
  target: VisibilityTarget,
  action: VisibilityAction,
): Promise<VisibilityPlan> {
  const documents = await loadTargetProducts(target);
  if (documents.length === 0) {
    throw new Error(`No products found for ${target.entityType}`);
  }
  const canonicalTarget: VisibilityTarget = target.entityType === "product"
    ? { ...target, productId: documents[0]?.product.productId }
    : target;
  const controlId = controlIdFor(canonicalTarget);
  const [controlSnapshot, runtime] = await Promise.all([
    db.collection(CONTROLS_COLLECTION).doc(controlId).get(),
    getContentVisibilityRuntime({ forceRefresh: true }),
  ]);
  const controlState = controlSnapshot.get("state");
  const currentState = controlState === "hidden" || controlState === "visible"
    ? controlState
    : "unset";
  const products = documents.map((item) => item.product);
  const affectedProductIds = products.map((product) => product.productId).sort();
  const affectedSegments = [...new Set(products.map(segmentId))].sort();
  const sellerNames = [...new Set(products
    .map((product) => product.seller?.sellerName?.trim())
    .filter((value): value is string => Boolean(value)))];
  const productVersions = products
    .map((product) => ({
      productId: product.productId,
      isActive: product.isActive,
      sourceIsActive: product.sourceIsActive ?? null,
      updatedAt: timestampValue(product.updatedAt),
    }))
    .sort((left, right) => left.productId.localeCompare(right.productId));
  const planHash = hashPlan({
    action,
    target: canonicalTarget,
    controlId,
    currentState,
    runtimeRevision: runtime.revision,
    affectedProductIds,
    productVersions,
  });

  return {
    ...canonicalTarget,
    action,
    controlId,
    currentState,
    runtimeRevision: runtime.revision,
    sellerName: sellerNames.length === 1 ? sellerNames[0] : undefined,
    affectedProductCount: products.length,
    affectedProductIds,
    affectedSegments,
    planHash,
  };
}

function validateRuntimeKeys(
  hiddenProductIds: string[],
  hiddenSellerProductIds: string[],
  hiddenSellerKeys: string[],
): void {
  if (
    hiddenProductIds.length > CONTENT_VISIBILITY_RUNTIME_MAX_KEYS ||
    hiddenSellerProductIds.length > CONTENT_VISIBILITY_RUNTIME_MAX_KEYS ||
    hiddenSellerKeys.length > CONTENT_VISIBILITY_RUNTIME_MAX_KEYS
  ) {
    throw new Error("Content visibility runtime must be sharded before this operation");
  }
}

async function updateControlAndRuntime(params: {
  plan: VisibilityPlan;
  caseId: string;
  performedBy: string;
  operationId: string;
}): Promise<number> {
  const now = Timestamp.now();
  const nextState: VisibilityControlState = params.plan.action === "hide" ? "hidden" : "visible";
  const controlRef = db.collection(CONTROLS_COLLECTION).doc(params.plan.controlId);
  const stateRef = db.collection(STATE_COLLECTION).doc(STATE_DOCUMENT);
  const runtimeRef = db
    .collection(CONTENT_VISIBILITY_RUNTIME_COLLECTION)
    .doc(CONTENT_VISIBILITY_RUNTIME_DOCUMENT);
  const eventRef = db.collection(EVENTS_COLLECTION).doc(params.operationId);

  return db.runTransaction(async (transaction) => {
    const [controlSnapshot, stateSnapshot, runtimeSnapshot] = await Promise.all([
      transaction.get(controlRef),
      transaction.get(stateRef),
      transaction.get(runtimeRef),
    ]);
    const previousState = controlSnapshot.get("state");
    const normalizedPreviousState = previousState === "hidden" || previousState === "visible"
      ? previousState
      : "unset";
    const previousRevision = Math.max(
      Number(stateSnapshot.get("revision") ?? 0),
      Number(runtimeSnapshot.get("revision") ?? 0),
    );
    if (
      normalizedPreviousState !== params.plan.currentState ||
      previousRevision !== params.plan.runtimeRevision
    ) {
      throw new Error("visibility state changed after preview; run preview again");
    }
    const revision = previousState === nextState ? previousRevision : previousRevision + 1;
    const hiddenProductIds = new Set<string>(
      Array.isArray(runtimeSnapshot.get("hiddenProductIds"))
        ? runtimeSnapshot.get("hiddenProductIds")
        : [],
    );
    const hiddenSellerKeys = new Set<string>(
      Array.isArray(runtimeSnapshot.get("hiddenSellerKeys"))
        ? runtimeSnapshot.get("hiddenSellerKeys")
        : [],
    );
    const hiddenSellerProductIds = new Set<string>(
      Array.isArray(runtimeSnapshot.get("hiddenSellerProductIds"))
        ? runtimeSnapshot.get("hiddenSellerProductIds")
        : [],
    );

    if (params.plan.entityType === "product") {
      const productId = nonEmpty(params.plan.productId, "productId");
      if (nextState === "hidden") hiddenProductIds.add(productId);
      else hiddenProductIds.delete(productId);
    } else {
      const sellerKey = buildSellerVisibilityKey(
        params.plan.platform,
        nonEmpty(params.plan.sourceSellerId, "sellerId"),
      );
      if (nextState === "hidden") hiddenSellerKeys.add(sellerKey);
      else hiddenSellerKeys.delete(sellerKey);
      for (const productId of params.plan.affectedProductIds) {
        if (nextState === "hidden") hiddenSellerProductIds.add(productId);
        else hiddenSellerProductIds.delete(productId);
      }
    }
    const hiddenProducts = [...hiddenProductIds].sort();
    const hiddenSellerProducts = [...hiddenSellerProductIds].sort();
    const hiddenSellers = [...hiddenSellerKeys].sort();
    validateRuntimeKeys(hiddenProducts, hiddenSellerProducts, hiddenSellers);

    transaction.set(controlRef, {
      schemaVersion: 1,
      entityType: params.plan.entityType,
      platform: params.plan.platform,
      productId: params.plan.productId ?? null,
      sourceSellerId: params.plan.sourceSellerId ?? null,
      sellerNameAtRequest: params.plan.sellerName ?? null,
      state: nextState,
      reasonCode: "deletion_request",
      caseId: params.caseId,
      revision,
      requestedAt: controlSnapshot.exists
        ? controlSnapshot.get("requestedAt") ?? now
        : now,
      requestedBy: controlSnapshot.exists
        ? controlSnapshot.get("requestedBy") ?? params.performedBy
        : params.performedBy,
      updatedAt: now,
      updatedBy: params.performedBy,
    }, { merge: false });
    transaction.set(stateRef, {
      schemaVersion: 1,
      revision,
      updatedAt: now,
    }, { merge: false });
    transaction.set(runtimeRef, {
      schemaVersion: 1,
      revision,
      hiddenProductIds: hiddenProducts,
      hiddenSellerProductIds: hiddenSellerProducts,
      hiddenSellerKeys: hiddenSellers,
      updatedAt: now,
    }, { merge: false });
    transaction.set(eventRef, {
      schemaVersion: 1,
      operationId: params.operationId,
      controlId: params.plan.controlId,
      entityType: params.plan.entityType,
      action: params.plan.action,
      previousState: normalizedPreviousState,
      nextState,
      caseId: params.caseId,
      affectedProductCount: params.plan.affectedProductCount,
      affectedSegments: params.plan.affectedSegments,
      status: "started",
      performedAt: now,
      performedBy: params.performedBy,
      updatedAt: now,
    }, { merge: false });
    return revision;
  });
}

async function materializeProducts(
  documents: ProductDocument[],
): Promise<void> {
  clearContentVisibilityRuntimeCache();
  const runtime = await getContentVisibilityRuntime({ forceRefresh: true });
  const evaluatedAt = Timestamp.now();
  const writer = db.bulkWriter();
  for (const { ref, product } of documents) {
    const materialized = materializeProductVisibility(product, runtime, evaluatedAt);
    writer.set(ref, {
      sourceIsActive: materialized.sourceIsActive,
      isActive: materialized.isActive,
      visibility: materialized.visibility,
      updatedAt: evaluatedAt,
    }, { merge: true });
  }
  await writer.close();
}

function rebuildSucceeded(result: Awaited<ReturnType<typeof rebuildSiteStatsForTargetsDetailed>>): boolean {
  return result.status === "success" && result.segments.every((segment) =>
    Object.values(segment.components).every((component) => component.status === "success"),
  );
}

export async function executeVisibilityChange(params: {
  target: VisibilityTarget;
  action: VisibilityAction;
  confirmPlanHash: string;
  caseId: string;
  performedBy: string;
  skipRebuild?: boolean;
}): Promise<VisibilityOperationResult> {
  const caseId = nonEmpty(params.caseId, "caseId");
  const performedBy = nonEmpty(params.performedBy, "performedBy");
  const plan = await buildVisibilityPlan(params.target, params.action);
  if (plan.planHash !== params.confirmPlanHash.trim()) {
    throw new Error("planHash mismatch; run preview again");
  }
  const documents = await loadTargetProducts(params.target);
  const actualProductIds = documents.map((item) => item.product.productId).sort();
  if (JSON.stringify(actualProductIds) !== JSON.stringify(plan.affectedProductIds)) {
    throw new Error("target products changed after preview; run preview again");
  }
  return withGenreSourceMutation(async () => {
    const operationId = `visibility_${Date.now()}_${randomUUID().slice(0, 8)}`;
    let materialized = false;
    try {
      const revision = await updateControlAndRuntime({
        plan,
        caseId,
        performedBy,
        operationId,
      });
      await materializeProducts(documents);
      materialized = true;
      await db.collection(EVENTS_COLLECTION).doc(operationId).set({
        status: "materialized",
        materializedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });

      if (params.skipRebuild) {
        return {
          operationId,
          controlId: plan.controlId,
          action: params.action,
          revision,
          affectedProductCount: plan.affectedProductCount,
          affectedSegments: plan.affectedSegments,
          status: "materialized",
          rebuildSkipped: true,
        };
      }

      const targets = targetsFromProducts(documents.map((item) => item.product));
      const statsResult = await rebuildSiteStatsForTargetsDetailed(targets);
      if (!rebuildSucceeded(statsResult)) {
        throw new Error("One or more site/index rebuild components failed");
      }
      const listResult = await rebuildAllListViewsForTargets(targets, {
        triggerType: "manual",
        triggerId: operationId,
      });
      if (listResult.status !== "success") {
        throw new Error(`List-view rebuild did not complete: ${listResult.status}`);
      }
      await db.collection(EVENTS_COLLECTION).doc(operationId).set({
        status: "rebuilt",
        rebuiltAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        rebuildSummary: {
          siteStats: statsResult.status,
          listViews: listResult.status,
          listViewRunId: listResult.runId,
        },
      }, { merge: true });
      return {
        operationId,
        controlId: plan.controlId,
        action: params.action,
        revision,
        affectedProductCount: plan.affectedProductCount,
        affectedSegments: plan.affectedSegments,
        status: "rebuilt",
        rebuildSkipped: false,
      };
    } catch (error) {
      await db.collection(EVENTS_COLLECTION).doc(operationId).set({
        status: materialized ? "partial" : "failed",
        errorSummary: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
        updatedAt: Timestamp.now(),
      }, { merge: true }).catch(() => undefined);
      throw error;
    }
  });
}

export async function getVisibilityOperation(operationId: string): Promise<Record<string, unknown> | null> {
  const snapshot = await db.collection(EVENTS_COLLECTION).doc(nonEmpty(operationId, "operationId")).get();
  return snapshot.exists ? { operationId: snapshot.id, ...snapshot.data() } : null;
}
