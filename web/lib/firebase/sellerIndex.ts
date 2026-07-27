import type {
  ProductListFilter,
  SellerIndexChunkDocument,
  SellerIndexItem,
  SellerIndexRootDocument,
  SellerIndexVersionDocument,
} from "../types";
import { getAdminDb } from "./admin";

const COLLECTION = "sellerIndexes";
const SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 60_000;

type CacheEntry = { activeVersion: string; items: SellerIndexItem[]; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const loading = new Map<string, Promise<SellerIndexItem[] | undefined>>();

function indexId(filter: Pick<ProductListFilter, "platform" | "audience" | "category">): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

async function load(filter: Pick<ProductListFilter, "platform" | "audience" | "category">): Promise<SellerIndexItem[] | undefined> {
  const id = indexId(filter);
  const rootRef = getAdminDb().collection(COLLECTION).doc(id);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) return undefined;
  const root = rootSnapshot.data() as Partial<SellerIndexRootDocument>;
  if (root.schemaVersion !== SCHEMA_VERSION || typeof root.activeVersion !== "string" || !Array.isArray(root.chunkIds)) return undefined;

  const cached = cache.get(id);
  if (cached?.activeVersion === root.activeVersion) {
    cached.expiresAt = Date.now() + CACHE_TTL_MS;
    return cached.items;
  }

  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) return undefined;
  const version = versionSnapshot.data() as Partial<SellerIndexVersionDocument>;
  if (version.status !== "ready" || version.schemaVersion !== SCHEMA_VERSION || version.versionId !== root.activeVersion || !Array.isArray(version.chunkIds)) return undefined;
  const refs = version.chunkIds.map((chunkId) => versionRef.collection("chunks").doc(chunkId));
  const snapshots = refs.length ? await getAdminDb().getAll(...refs) : [];
  const items: SellerIndexItem[] = [];
  for (let index = 0; index < snapshots.length; index += 1) {
    const snapshot = snapshots[index];
    if (!snapshot.exists) throw new Error(`Seller index chunk missing: ${id}/${root.activeVersion}/${version.chunkIds[index]}`);
    const chunk = snapshot.data() as Partial<SellerIndexChunkDocument>;
    if (chunk.versionId !== root.activeVersion || !Array.isArray(chunk.items)) throw new Error(`Seller index chunk invalid: ${id}/${root.activeVersion}/${version.chunkIds[index]}`);
    items.push(...chunk.items);
  }
  if (typeof version.itemCount === "number" && items.length !== version.itemCount) throw new Error(`Seller index count mismatch: ${id}`);
  cache.set(id, { activeVersion: root.activeVersion, items, expiresAt: Date.now() + CACHE_TTL_MS });
  return items;
}

export async function getSellerIndexItems(filter: ProductListFilter): Promise<SellerIndexItem[] | undefined> {
  const id = indexId(filter);
  const cached = cache.get(id);
  if (cached && cached.expiresAt > Date.now()) return cached.items;
  const current = loading.get(id);
  if (current) return current;
  const promise = load(filter)
    .catch((error) => {
      console.error("Failed to load seller index; falling back to sellers/products", {
        id,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    })
    .finally(() => loading.delete(id));
  loading.set(id, promise);
  return promise;
}
