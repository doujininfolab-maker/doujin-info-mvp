import { getAdminDb } from "./admin";
import type {
  ProductListFilter,
  ProductRankingMode,
  RankingIndexEntry,
  RankingIndexListDocument,
  RankingIndexRootDocument,
} from "../types";

const RANKING_INDEXES_COLLECTION = "rankingIndexes";
const RANKING_INDEX_CACHE_TTL_MS = 60_000;

type RankingIndexResult = {
  sourceDate?: string;
  entries: RankingIndexEntry[];
};

type CacheEntry = {
  value: RankingIndexResult | null;
  expiresAt: number;
};

const rankingIndexCache = new Map<string, CacheEntry>();
const loadingPromises = new Map<string, Promise<RankingIndexResult | undefined>>();

function buildSegmentId(filter: ProductListFilter): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function buildListId(
  filter: ProductListFilter,
  rankingMode: ProductRankingMode,
): string {
  const contentScope = filter.contentType ?? "all";
  const workType = filter.workType ?? "all";
  return `${contentScope}_${rankingMode}_${workType}`;
}

function normalizeEntry(value: unknown): RankingIndexEntry | undefined {
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Partial<RankingIndexEntry>;
  if (
    typeof entry.productId !== "string" ||
    typeof entry.rank !== "number" ||
    typeof entry.rankingValue !== "number" ||
    typeof entry.salesCount !== "number" ||
    typeof entry.priceCurrent !== "number"
  ) {
    return undefined;
  }

  return {
    rank: entry.rank,
    productId: entry.productId,
    rankingValue: entry.rankingValue,
    salesCount: entry.salesCount,
    revenue: typeof entry.revenue === "number" ? entry.revenue : undefined,
    priceCurrent: entry.priceCurrent,
  };
}

async function loadRankingIndex(
  filter: ProductListFilter,
  rankingMode: ProductRankingMode,
): Promise<RankingIndexResult | undefined> {
  const db = getAdminDb();
  const segmentId = buildSegmentId(filter);
  const listId = buildListId(filter, rankingMode);
  const rootSnapshot = await db.collection(RANKING_INDEXES_COLLECTION).doc(segmentId).get();
  if (!rootSnapshot.exists) return undefined;

  const root = rootSnapshot.data() as Partial<RankingIndexRootDocument>;
  if (typeof root.activeVersion !== "string" || root.activeVersion.length === 0) {
    return undefined;
  }

  const listSnapshot = await db
    .collection(RANKING_INDEXES_COLLECTION)
    .doc(segmentId)
    .collection("versions")
    .doc(root.activeVersion)
    .collection("lists")
    .doc(listId)
    .get();
  if (!listSnapshot.exists) return undefined;

  const list = listSnapshot.data() as Partial<RankingIndexListDocument>;
  if (list.status !== "ready" || !Array.isArray(list.entries)) return undefined;

  const entries = list.entries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is RankingIndexEntry => Boolean(entry));
  if (entries.length !== list.itemCount) return undefined;

  return {
    sourceDate: list.sourceDate,
    entries,
  };
}

export async function getRankingIndexEntries(
  filter: ProductListFilter,
  rankingMode: ProductRankingMode,
): Promise<RankingIndexResult | undefined> {
  const cacheKey = `${buildSegmentId(filter)}:${buildListId(filter, rankingMode)}`;
  const cached = rankingIndexCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value ?? undefined;
  }

  const loading = loadingPromises.get(cacheKey);
  if (loading) return loading;

  const promise = loadRankingIndex(filter, rankingMode)
    .then((value) => {
      rankingIndexCache.set(cacheKey, {
        value: value ?? null,
        expiresAt: Date.now() + RANKING_INDEX_CACHE_TTL_MS,
      });
      return value;
    })
    .finally(() => {
      loadingPromises.delete(cacheKey);
    });
  loadingPromises.set(cacheKey, promise);
  return promise;
}
