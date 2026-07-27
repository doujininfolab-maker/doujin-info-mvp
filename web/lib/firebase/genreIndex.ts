import type {
  GenreIndexChunkDocument,
  GenreIndexEntry,
  GenreIndexListDocument,
  GenreIndexRootDocument,
  GenreIndexVersionDocument,
  ProductListFilter,
} from "../types";
import { getAdminDb } from "./admin";

const COLLECTION = "genreIndexes";
const SCHEMA_VERSION = 1;
const CACHE_TTL_MS = 60_000;

type CacheEntry = {
  activeVersion: string;
  listId: string;
  sourceDate?: string;
  entries: GenreIndexEntry[];
  expiresAt: number;
};

const cache = new Map<string, CacheEntry>();
const loading = new Map<string, Promise<CacheEntry | undefined>>();

function segmentId(filter: Pick<ProductListFilter, "platform" | "audience" | "category">): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function listId(filter: Pick<ProductListFilter, "contentType" | "workType">): string {
  return `${filter.contentType ?? "all"}_${filter.workType ?? "all"}`;
}

async function load(filter: ProductListFilter): Promise<CacheEntry | undefined> {
  const id = segmentId(filter);
  const requestedListId = listId(filter);
  const rootRef = getAdminDb().collection(COLLECTION).doc(id);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) return undefined;
  const root = rootSnapshot.data() as Partial<GenreIndexRootDocument>;
  if (root.schemaVersion !== SCHEMA_VERSION || typeof root.activeVersion !== "string") return undefined;

  const cacheKey = `${id}:${requestedListId}`;
  const cached = cache.get(cacheKey);
  if (cached?.activeVersion === root.activeVersion) {
    cached.expiresAt = Date.now() + CACHE_TTL_MS;
    return cached;
  }

  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const listRef = versionRef.collection("lists").doc(requestedListId);
  const [versionSnapshot, listSnapshot] = await Promise.all([
    versionRef.get(),
    listRef.get(),
  ]);
  if (!versionSnapshot.exists || !listSnapshot.exists) return undefined;
  const version = versionSnapshot.data() as Partial<GenreIndexVersionDocument>;
  const list = listSnapshot.data() as Partial<GenreIndexListDocument>;
  if (
    version.status !== "ready" ||
    version.schemaVersion !== SCHEMA_VERSION ||
    version.versionId !== root.activeVersion ||
    list.versionId !== root.activeVersion ||
    list.listId !== requestedListId ||
    !Array.isArray(list.chunkIds)
  ) return undefined;

  const chunkRefs = list.chunkIds.map((chunkId) => listRef.collection("chunks").doc(chunkId));
  const chunkSnapshots = chunkRefs.length ? await getAdminDb().getAll(...chunkRefs) : [];
  const entries: GenreIndexEntry[] = [];
  for (let index = 0; index < chunkSnapshots.length; index += 1) {
    const snapshot = chunkSnapshots[index];
    if (!snapshot.exists) throw new Error(`Genre index chunk missing: ${id}/${root.activeVersion}/${requestedListId}/${list.chunkIds[index]}`);
    const chunk = snapshot.data() as Partial<GenreIndexChunkDocument>;
    if (chunk.versionId !== root.activeVersion || chunk.listId !== requestedListId || !Array.isArray(chunk.entries)) {
      throw new Error(`Genre index chunk invalid: ${id}/${root.activeVersion}/${requestedListId}/${list.chunkIds[index]}`);
    }
    entries.push(...chunk.entries);
  }
  if (typeof list.itemCount === "number" && entries.length !== list.itemCount) {
    throw new Error(`Genre index item count mismatch: ${id}/${root.activeVersion}/${requestedListId}`);
  }

  const entry: CacheEntry = {
    activeVersion: root.activeVersion,
    listId: requestedListId,
    sourceDate: list.sourceDate,
    entries,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  cache.set(cacheKey, entry);
  return entry;
}

export async function getGenreIndexEntries(filter: ProductListFilter): Promise<CacheEntry | undefined> {
  const key = `${segmentId(filter)}:${listId(filter)}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const current = loading.get(key);
  if (current) return current;
  const promise = load(filter)
    .catch((error) => {
      console.error("Failed to load genre index; falling back to legacy genre ranking", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    })
    .finally(() => loading.delete(key));
  loading.set(key, promise);
  return promise;
}
