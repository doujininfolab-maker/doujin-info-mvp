import { Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type { Platform, Product } from "../types";

export const CONTENT_VISIBILITY_RUNTIME_COLLECTION = "contentVisibilityRuntime";
export const CONTENT_VISIBILITY_RUNTIME_DOCUMENT = "current";
export const CONTENT_VISIBILITY_RUNTIME_CACHE_TTL_MS = 60_000;
export const CONTENT_VISIBILITY_RUNTIME_MAX_KEYS = 5_000;

export type ContentVisibilityRuntimeSnapshot = {
  schemaVersion: 1;
  revision: number;
  hiddenProductIds: ReadonlySet<string>;
  hiddenSellerProductIds: ReadonlySet<string>;
  hiddenSellerKeys: ReadonlySet<string>;
};

export type ProductVisibilityBlocker = "product" | "seller" | "source";

const EMPTY_RUNTIME: ContentVisibilityRuntimeSnapshot = {
  schemaVersion: 1,
  revision: 0,
  hiddenProductIds: new Set<string>(),
  hiddenSellerProductIds: new Set<string>(),
  hiddenSellerKeys: new Set<string>(),
};

let cachedRuntime:
  | { value: ContentVisibilityRuntimeSnapshot; expiresAt: number }
  | undefined;
let runtimeLoadPromise: Promise<ContentVisibilityRuntimeSnapshot> | undefined;

function parseStringSet(value: unknown, fieldName: string): ReadonlySet<string> {
  if (value === undefined) return new Set<string>();
  if (!Array.isArray(value)) {
    throw new Error(`Invalid content visibility runtime field: ${fieldName}`);
  }
  const values = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (values.length !== value.length || values.length > CONTENT_VISIBILITY_RUNTIME_MAX_KEYS) {
    throw new Error(`Invalid content visibility runtime key count: ${fieldName}`);
  }
  return new Set(values);
}

function parseRuntime(data: FirebaseFirestore.DocumentData): ContentVisibilityRuntimeSnapshot {
  if (data.schemaVersion !== 1 || !Number.isInteger(data.revision) || data.revision < 0) {
    throw new Error("Invalid content visibility runtime metadata");
  }
  return {
    schemaVersion: 1,
    revision: data.revision,
    hiddenProductIds: parseStringSet(data.hiddenProductIds, "hiddenProductIds"),
    hiddenSellerProductIds: parseStringSet(data.hiddenSellerProductIds, "hiddenSellerProductIds"),
    hiddenSellerKeys: parseStringSet(data.hiddenSellerKeys, "hiddenSellerKeys"),
  };
}

async function readRuntime(): Promise<ContentVisibilityRuntimeSnapshot> {
  const snapshot = await db
    .collection(CONTENT_VISIBILITY_RUNTIME_COLLECTION)
    .doc(CONTENT_VISIBILITY_RUNTIME_DOCUMENT)
    .get();
  return snapshot.exists ? parseRuntime(snapshot.data() ?? {}) : EMPTY_RUNTIME;
}

export async function getContentVisibilityRuntime(
  options: { forceRefresh?: boolean } = {},
): Promise<ContentVisibilityRuntimeSnapshot> {
  const now = Date.now();
  if (!options.forceRefresh && cachedRuntime && cachedRuntime.expiresAt > now) {
    return cachedRuntime.value;
  }
  if (!options.forceRefresh && runtimeLoadPromise) return runtimeLoadPromise;

  const load = readRuntime().then((value) => {
    cachedRuntime = {
      value,
      expiresAt: Date.now() + CONTENT_VISIBILITY_RUNTIME_CACHE_TTL_MS,
    };
    return value;
  });
  runtimeLoadPromise = load;
  try {
    return await load;
  } finally {
    if (runtimeLoadPromise === load) runtimeLoadPromise = undefined;
  }
}

export function clearContentVisibilityRuntimeCache(): void {
  cachedRuntime = undefined;
  runtimeLoadPromise = undefined;
}

export function buildSellerVisibilityKey(
  platform: Platform,
  sourceSellerId: string,
): string {
  return `${platform}:${sourceSellerId.trim()}`;
}

export function resolveSourceIsActive(
  product: Pick<Product, "sourceIsActive" | "isActive">,
): boolean {
  return product.sourceIsActive ?? product.isActive ?? true;
}

export function getProductVisibilityBlockers(
  product: Pick<Product, "productId" | "platform" | "seller" | "sourceIsActive" | "isActive">,
  runtime: ContentVisibilityRuntimeSnapshot,
): ProductVisibilityBlocker[] {
  const blockers: ProductVisibilityBlocker[] = [];
  if (!resolveSourceIsActive(product)) blockers.push("source");
  if (runtime.hiddenProductIds.has(product.productId)) blockers.push("product");
  const sellerId = product.seller?.sellerId?.trim();
  if (
    runtime.hiddenSellerProductIds.has(product.productId) ||
    (sellerId && runtime.hiddenSellerKeys.has(
      buildSellerVisibilityKey(product.platform, sellerId),
    ))
  ) {
    blockers.push("seller");
  }
  return blockers;
}

export function materializeProductVisibility(
  product: Product,
  runtime: ContentVisibilityRuntimeSnapshot,
  evaluatedAt: Timestamp = Timestamp.now(),
): Product {
  const sourceIsActive = resolveSourceIsActive(product);
  const blockers = getProductVisibilityBlockers(
    { ...product, sourceIsActive },
    runtime,
  );
  return {
    ...product,
    sourceIsActive,
    isActive: blockers.length === 0,
    visibility: {
      status: blockers.length === 0 ? "visible" : "hidden",
      blockers,
      controlRevision: runtime.revision,
      evaluatedAt,
    },
  };
}

export async function applyContentVisibility(product: Product): Promise<Product> {
  return materializeProductVisibility(product, await getContentVisibilityRuntime());
}
