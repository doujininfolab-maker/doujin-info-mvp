import type {
  ProductListFilter,
  SearchIndexChunkDocument,
  SearchIndexItem,
  SearchIndexRootDocument,
  SearchIndexVersionDocument,
} from "../types";
import { getAdminDb } from "./admin";

const SEARCH_INDEXES_COLLECTION = "searchIndexes";
const SEARCH_INDEX_SCHEMA_VERSION = 2;
const SEARCH_INDEX_CACHE_TTL_MS = 60_000;

type SearchIndexCacheEntry = {
  activeVersion: string;
  candidates: SearchIndexItem[];
  expiresAt: number;
};

const searchIndexCache = new Map<string, SearchIndexCacheEntry>();
const searchIndexLoadPromises = new Map<string, Promise<SearchIndexItem[] | undefined>>();

function buildSegmentId(filter: Pick<ProductListFilter, "platform" | "audience" | "category">): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSearchIndexItem(value: unknown): value is SearchIndexItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SearchIndexItem>;
  return typeof item.productId === "string" && item.productId.length > 0;
}

async function loadSearchIndex(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): Promise<SearchIndexItem[] | undefined> {
  const segmentId = buildSegmentId(filter);
  const rootRef = getAdminDb().collection(SEARCH_INDEXES_COLLECTION).doc(segmentId);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) return undefined;

  const root = rootSnapshot.data() as Partial<SearchIndexRootDocument>;
  if (
    root.schemaVersion !== SEARCH_INDEX_SCHEMA_VERSION ||
    typeof root.activeVersion !== "string" ||
    !isStringArray(root.chunkIds)
  ) {
    console.warn("Search index metadata is invalid; falling back to products scan", { segmentId });
    return undefined;
  }

  const cached = searchIndexCache.get(segmentId);
  if (cached?.activeVersion === root.activeVersion) {
    cached.expiresAt = Date.now() + SEARCH_INDEX_CACHE_TTL_MS;
    return cached.candidates;
  }

  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) {
    console.warn("Search index version is missing; falling back to products scan", {
      segmentId,
      activeVersion: root.activeVersion,
    });
    return undefined;
  }

  const version = versionSnapshot.data() as Partial<SearchIndexVersionDocument>;
  if (
    version.status !== "ready" ||
    version.schemaVersion !== SEARCH_INDEX_SCHEMA_VERSION ||
    version.versionId !== root.activeVersion ||
    !isStringArray(version.chunkIds)
  ) {
    console.warn("Search index version is not ready; falling back to products scan", {
      segmentId,
      activeVersion: root.activeVersion,
      status: version.status,
    });
    return undefined;
  }

  const chunkIds = version.chunkIds;
  const chunkRefs = chunkIds.map((chunkId) => versionRef.collection("chunks").doc(chunkId));
  const chunkSnapshots = chunkRefs.length > 0
    ? await getAdminDb().getAll(...chunkRefs)
    : [];
  const candidates: SearchIndexItem[] = [];

  for (let index = 0; index < chunkSnapshots.length; index += 1) {
    const chunkSnapshot = chunkSnapshots[index];
    const expectedChunkId = chunkIds[index];
    if (!chunkSnapshot.exists) {
      throw new Error(`Search index chunk is missing: ${segmentId}/${root.activeVersion}/${expectedChunkId}`);
    }

    const chunk = chunkSnapshot.data() as Partial<SearchIndexChunkDocument>;
    if (
      chunk.versionId !== root.activeVersion ||
      chunk.chunkId !== expectedChunkId ||
      !Array.isArray(chunk.items)
    ) {
      throw new Error(`Search index chunk is invalid: ${segmentId}/${root.activeVersion}/${expectedChunkId}`);
    }

    for (const item of chunk.items) {
      if (!isSearchIndexItem(item)) {
        throw new Error(`Search index item is invalid: ${segmentId}/${root.activeVersion}/${expectedChunkId}`);
      }
      candidates.push(item);
    }
  }

  const expectedProductCount = typeof version.productCount === "number"
    ? version.productCount
    : root.productCount;
  if (typeof expectedProductCount === "number" && candidates.length !== expectedProductCount) {
    throw new Error(
      `Search index product count mismatch: expected=${expectedProductCount}, actual=${candidates.length}`,
    );
  }

  const duplicateProductIds = new Set<string>();
  const seenProductIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenProductIds.has(candidate.productId)) duplicateProductIds.add(candidate.productId);
    seenProductIds.add(candidate.productId);
  }
  if (duplicateProductIds.size > 0) {
    throw new Error(`Search index contains duplicate product IDs: ${[...duplicateProductIds].slice(0, 5).join(",")}`);
  }

  searchIndexCache.set(segmentId, {
    activeVersion: root.activeVersion,
    candidates,
    expiresAt: Date.now() + SEARCH_INDEX_CACHE_TTL_MS,
  });
  return candidates;
}

export async function getSearchIndexCandidates(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): Promise<SearchIndexItem[] | undefined> {
  const segmentId = buildSegmentId(filter);
  const cached = searchIndexCache.get(segmentId);
  if (cached && cached.expiresAt > Date.now()) return cached.candidates;

  const loading = searchIndexLoadPromises.get(segmentId);
  if (loading) return loading;

  const promise = loadSearchIndex(filter)
    .catch((error) => {
      console.error("Failed to load search index; falling back to products scan", {
        segmentId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    })
    .finally(() => {
      searchIndexLoadPromises.delete(segmentId);
    });
  searchIndexLoadPromises.set(segmentId, promise);
  return promise;
}
