import "server-only";
import { getAdminDb } from "./admin";

const RUNTIME_COLLECTION = "contentVisibilityRuntime";
const RUNTIME_DOCUMENT = "current";
const CACHE_TTL_MS = 60_000;
const MAX_KEYS = 5_000;

export type ContentVisibilityRuntime = {
  revision: number;
  hiddenProductIds: ReadonlySet<string>;
  hiddenSellerProductIds: ReadonlySet<string>;
  hiddenSellerKeys: ReadonlySet<string>;
};

type ProductIdentity = {
  productId: string;
  platform: string;
  isActive?: boolean;
  seller?: { sellerId?: string };
};

type SellerIdentity = {
  platform: string;
  sellerId?: string;
};

const EMPTY_RUNTIME: ContentVisibilityRuntime = {
  revision: 0,
  hiddenProductIds: new Set<string>(),
  hiddenSellerProductIds: new Set<string>(),
  hiddenSellerKeys: new Set<string>(),
};

let cached:
  | { runtime: ContentVisibilityRuntime; expiresAt: number }
  | undefined;
let pending: Promise<ContentVisibilityRuntime> | undefined;

function parseKeys(value: unknown, fieldName: string): ReadonlySet<string> {
  if (value === undefined) return new Set<string>();
  if (!Array.isArray(value)) throw new Error(`Invalid visibility runtime ${fieldName}`);
  const keys = value.filter(
    (item): item is string => typeof item === "string" && item.trim().length > 0,
  );
  if (keys.length !== value.length || keys.length > MAX_KEYS) {
    throw new Error(`Invalid visibility runtime key count: ${fieldName}`);
  }
  return new Set(keys);
}

async function readRuntime(): Promise<ContentVisibilityRuntime> {
  const snapshot = await getAdminDb()
    .collection(RUNTIME_COLLECTION)
    .doc(RUNTIME_DOCUMENT)
    .get();
  if (!snapshot.exists) return EMPTY_RUNTIME;
  const data = snapshot.data() ?? {};
  if (data.schemaVersion !== 1 || !Number.isInteger(data.revision) || data.revision < 0) {
    throw new Error("Invalid visibility runtime metadata");
  }
  return {
    revision: data.revision,
    hiddenProductIds: parseKeys(data.hiddenProductIds, "hiddenProductIds"),
    hiddenSellerProductIds: parseKeys(data.hiddenSellerProductIds, "hiddenSellerProductIds"),
    hiddenSellerKeys: parseKeys(data.hiddenSellerKeys, "hiddenSellerKeys"),
  };
}

export async function getContentVisibilityRuntime(): Promise<ContentVisibilityRuntime> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.runtime;
  if (pending) return pending;

  const load = readRuntime().then((runtime) => {
    cached = { runtime, expiresAt: Date.now() + CACHE_TTL_MS };
    return runtime;
  });
  pending = load;
  try {
    return await load;
  } finally {
    if (pending === load) pending = undefined;
  }
}

export function clearContentVisibilityRuntimeCache(): void {
  cached = undefined;
  pending = undefined;
}

export function buildSellerVisibilityKey(platform: string, sellerId: string): string {
  return `${platform}:${sellerId.trim()}`;
}

export function runtimeAllowsProduct(
  product: ProductIdentity,
  runtime: ContentVisibilityRuntime,
): boolean {
  if (
    runtime.hiddenProductIds.has(product.productId) ||
    runtime.hiddenSellerProductIds.has(product.productId)
  ) return false;
  const sellerId = product.seller?.sellerId?.trim();
  return !sellerId || !runtime.hiddenSellerKeys.has(
    buildSellerVisibilityKey(product.platform, sellerId),
  );
}

export async function isProductPublic(product: ProductIdentity): Promise<boolean> {
  if (product.isActive !== true) return false;
  return runtimeAllowsProduct(product, await getContentVisibilityRuntime());
}

export async function filterPublicProducts<T extends ProductIdentity>(
  products: T[],
  options: { requireMaterializedActive?: boolean } = {},
): Promise<T[]> {
  const requireActive = options.requireMaterializedActive !== false;
  const runtime = await getContentVisibilityRuntime();
  return products.filter(
    (product) =>
      (!requireActive || product.isActive === true) &&
      runtimeAllowsProduct(product, runtime),
  );
}

export async function filterPublicProductReferences<T extends { productId: string }>(
  products: T[],
): Promise<T[]> {
  const runtime = await getContentVisibilityRuntime();
  return products.filter((product) =>
    !runtime.hiddenProductIds.has(product.productId) &&
    !runtime.hiddenSellerProductIds.has(product.productId),
  );
}

export function runtimeAllowsSeller(
  seller: SellerIdentity,
  runtime: ContentVisibilityRuntime,
): boolean {
  const sellerId = seller.sellerId?.trim();
  return !sellerId || !runtime.hiddenSellerKeys.has(
    buildSellerVisibilityKey(seller.platform, sellerId),
  );
}

export async function isSellerPublic(seller: SellerIdentity): Promise<boolean> {
  return runtimeAllowsSeller(seller, await getContentVisibilityRuntime());
}

export async function filterPublicSellers<T extends SellerIdentity>(sellers: T[]): Promise<T[]> {
  const runtime = await getContentVisibilityRuntime();
  return sellers.filter((seller) => runtimeAllowsSeller(seller, runtime));
}
