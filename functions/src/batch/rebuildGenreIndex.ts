import { randomBytes } from "node:crypto";
import type { DocumentReference, Timestamp } from "firebase-admin/firestore";
import { db } from "../firebaseAdmin";
import type {
  FetchTarget,
  GenreIndexChunkDocument,
  GenreIndexEntry,
  GenreIndexListDocument,
  GenreIndexProductSummary,
  GenreIndexRootDocument,
  GenreIndexVersionDocument,
  GenrePeriodMetrics,
  Product,
  ProductContentType,
  ProductWorkType,
} from "../types";

const GENRE_INDEXES_COLLECTION = "genreIndexes";
const GENRE_INDEX_SCHEMA_VERSION = 1;
const TARGET_CHUNK_BYTES = 300 * 1024;
const MAX_ENTRIES_PER_CHUNK = 150;
const CONTENT_SCOPES = ["all", "tl", "bl"] as const;
const WORK_TYPES: Array<"all" | ProductWorkType> = [
  "all",
  "comic",
  "novel",
  "cg",
  "movie",
  "game",
  "voice",
  "other",
];

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type ContentScope = (typeof CONTENT_SCOPES)[number];
type PeriodName = "daily" | "weekly" | "monthly" | "cumulative";

type GenreAccumulator = {
  genreId: string;
  name: string;
  daily: GenrePeriodMetrics;
  weekly: GenrePeriodMetrics;
  monthly: GenrePeriodMetrics;
  cumulative: GenrePeriodMetrics;
  topCandidates: Record<PeriodName, Array<{ product: Product; sales: number; revenue: number }>>;
};

export type RebuildGenreIndexResult = {
  segmentId: string;
  versionId: string;
  sourceDate?: string;
  listCount: number;
};

function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;
  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.toDate === "function" && typeof timestampLike.seconds === "number") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value.map((item) => removeUndefinedDeep(item)).filter((item) => item !== undefined) as T;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cleanedItem = removeUndefinedDeep(item);
    if (cleanedItem !== undefined) cleaned[key] = cleanedItem;
  }
  return cleaned as T;
}

function buildSegmentId(segment: SiteSegmentKey): string {
  return `${segment.platform}_${segment.audience}_${segment.category}`;
}

function buildVersionId(date: Date): string {
  const timestamp = date.toISOString().replace(/[-:.TZ]/g, "");
  return `${timestamp}_${randomBytes(4).toString("hex")}`;
}

function buildListId(contentScope: ContentScope, workType: "all" | ProductWorkType): string {
  return `${contentScope}_${workType}`;
}

function normalizeStoredContentType(value: string | undefined): ProductContentType | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

function productHasContentScope(product: Product, contentScope: ContentScope): boolean {
  if (contentScope === "all") return true;
  const ids = (product.contentTypeIds ?? []).map(normalizeStoredContentType);
  if (ids.includes(contentScope)) return true;
  const labels = (product.contentTypes ?? []).map(normalizeStoredContentType);
  return labels.includes(contentScope);
}

function resolveSourceDate(products: Product[]): string | undefined {
  const counts = new Map<string, number>();
  for (const product of products) {
    const date = product.rankingMetrics?.sourceDate;
    if (!date || !/^\d{8}$/.test(date)) continue;
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0];
}

function emptyMetrics(): GenrePeriodMetrics {
  return { productCount: 0, salesCount: 0, revenue: 0 };
}

function getGenrePairs(product: Product): Array<{ genreId: string; name: string }> {
  const names = product.genres ?? [];
  const ids = product.genreIds ?? [];
  const maxLength = Math.max(names.length, ids.length);
  const seen = new Set<string>();
  const pairs: Array<{ genreId: string; name: string }> = [];
  for (let index = 0; index < maxLength; index += 1) {
    const rawId = ids[index]?.trim();
    const rawName = names[index]?.trim() || rawId?.replace(/^dlsite:/, "").trim();
    if (!rawName) continue;
    const genreId = rawId || (rawName.startsWith("dlsite:") ? rawName : `dlsite:${rawName}`);
    if (seen.has(genreId)) continue;
    seen.add(genreId);
    pairs.push({ genreId, name: rawName.replace(/^dlsite:/, "") });
  }
  return pairs;
}

function compactProduct(product: Product): GenreIndexProductSummary {
  return removeUndefinedDeep({
    productId: product.productId,
    title: product.title,
    thumbnailUrl: product.thumbnailUrl,
    mainImageUrl: product.mainImageUrl,
  });
}

function periodValues(product: Product, sourceDate: string | undefined): Record<PeriodName, { sales?: number; revenue?: number }> {
  const price = typeof product.priceCurrent === "number" && Number.isFinite(product.priceCurrent)
    ? product.priceCurrent
    : undefined;
  if (price === undefined || price <= 0 || product.isActive === false) {
    return { daily: {}, weekly: {}, monthly: {}, cumulative: {} };
  }
  const metrics = product.rankingMetrics;
  const usableMetrics = metrics && sourceDate && metrics.sourceDate === sourceDate ? metrics : undefined;
  const daily = usableMetrics?.dailyAvailable && typeof usableMetrics.dailySalesCount === "number"
    ? Math.max(0, usableMetrics.dailySalesCount)
    : undefined;
  const weekly = usableMetrics?.weeklyAvailable && typeof usableMetrics.weeklySalesCount === "number"
    ? Math.max(0, usableMetrics.weeklySalesCount)
    : undefined;
  const monthly = usableMetrics?.monthlyAvailable && typeof usableMetrics.monthlySalesCount === "number"
    ? Math.max(0, usableMetrics.monthlySalesCount)
    : undefined;
  const cumulative = typeof product.salesCount === "number" && Number.isFinite(product.salesCount)
    ? Math.max(0, product.salesCount)
    : undefined;
  return {
    daily: { sales: daily, revenue: daily === undefined ? undefined : daily * price },
    weekly: { sales: weekly, revenue: weekly === undefined ? undefined : weekly * price },
    monthly: { sales: monthly, revenue: monthly === undefined ? undefined : monthly * price },
    cumulative: { sales: cumulative, revenue: cumulative === undefined ? undefined : cumulative * price },
  };
}

function buildEntries(products: Product[], sourceDate: string | undefined): GenreIndexEntry[] {
  const groups = new Map<string, GenreAccumulator>();
  for (const product of products) {
    const values = periodValues(product, sourceDate);
    if (Object.values(values).every((value) => value.sales === undefined)) continue;
    for (const genre of getGenrePairs(product)) {
      const current = groups.get(genre.genreId) ?? {
        genreId: genre.genreId,
        name: genre.name,
        daily: emptyMetrics(),
        weekly: emptyMetrics(),
        monthly: emptyMetrics(),
        cumulative: emptyMetrics(),
        topCandidates: { daily: [], weekly: [], monthly: [], cumulative: [] },
      };
      for (const period of ["daily", "weekly", "monthly", "cumulative"] as const) {
        const sales = values[period].sales;
        const revenue = values[period].revenue;
        if (sales === undefined || revenue === undefined) continue;
        current[period].salesCount += sales;
        current[period].revenue += revenue;
        if (sales > 0) {
          current[period].productCount += 1;
          current.topCandidates[period].push({ product, sales, revenue });
        }
      }
      groups.set(genre.genreId, current);
    }
  }

  return [...groups.values()]
    .map((group) => {
      const topProducts = Object.fromEntries(
        (["daily", "weekly", "monthly", "cumulative"] as const).map((period) => [
          period,
          group.topCandidates[period]
            .sort((a, b) => b.sales - a.sales || b.revenue - a.revenue || a.product.productId.localeCompare(b.product.productId))
            .slice(0, 3)
            .map((candidate) => compactProduct(candidate.product)),
        ]),
      ) as GenreIndexEntry["topProducts"];
      return removeUndefinedDeep({
        genreId: group.genreId,
        name: group.name,
        daily: group.daily,
        weekly: group.weekly,
        monthly: group.monthly,
        cumulative: group.cumulative,
        topProducts,
      });
    })
    .sort((a, b) => b.cumulative.salesCount - a.cumulative.salesCount || a.name.localeCompare(b.name, "ja"));
}

function getEntryBytes(entry: GenreIndexEntry): number {
  return Buffer.byteLength(JSON.stringify(entry), "utf8") + 2;
}

function chunkEntries(entries: GenreIndexEntry[]): GenreIndexEntry[][] {
  const chunks: GenreIndexEntry[][] = [];
  let current: GenreIndexEntry[] = [];
  let currentBytes = 0;
  for (const entry of entries) {
    const bytes = getEntryBytes(entry);
    if (current.length > 0 && (currentBytes + bytes > TARGET_CHUNK_BYTES || current.length >= MAX_ENTRIES_PER_CHUNK)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(entry);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function deleteVersion(versionRef: DocumentReference): Promise<void> {
  const snapshot = await versionRef.get();
  if (!snapshot.exists) return;
  const version = snapshot.data() as Partial<GenreIndexVersionDocument>;
  const listIds = Array.isArray(version.listIds)
    ? version.listIds.filter((value): value is string => typeof value === "string")
    : [];

  for (const listId of listIds) {
    const listRef = versionRef.collection("lists").doc(listId);
    const listSnapshot = await listRef.get();
    const list = listSnapshot.exists
      ? listSnapshot.data() as Partial<GenreIndexListDocument>
      : undefined;
    const chunkIds = Array.isArray(list?.chunkIds)
      ? list.chunkIds.filter((value): value is string => typeof value === "string")
      : [];

    for (const chunkId of chunkIds) {
      await listRef.collection("chunks").doc(chunkId).delete();
    }
    await listRef.delete();
  }

  await versionRef.delete();
}

export async function rebuildGenreIndex(
  segment: SiteSegmentKey,
  products: Product[],
  generatedAt: Timestamp,
): Promise<RebuildGenreIndexResult> {
  const segmentId = buildSegmentId(segment);
  const versionId = buildVersionId(generatedAt.toDate());
  const sourceDate = resolveSourceDate(products);
  const rootRef = db.collection(GENRE_INDEXES_COLLECTION).doc(segmentId);
  const versionsRef = rootRef.collection("versions");
  const versionRef = versionsRef.doc(versionId);
  const previousSnapshot = await rootRef.get();
  const previous = previousSnapshot.exists ? previousSnapshot.data() as Partial<GenreIndexRootDocument> : undefined;
  const previousActiveVersion = typeof previous?.activeVersion === "string" ? previous.activeVersion : undefined;
  const versionToDelete = typeof previous?.previousVersion === "string" ? previous.previousVersion : undefined;
  const lists: Array<{ document: GenreIndexListDocument; chunks: GenreIndexEntry[][] }> = [];

  for (const contentScope of CONTENT_SCOPES) {
    const scopeProducts = products.filter((product) => productHasContentScope(product, contentScope));
    for (const workType of WORK_TYPES) {
      const listProducts = workType === "all"
        ? scopeProducts
        : scopeProducts.filter((product) => product.workType === workType);
      const listId = buildListId(contentScope, workType);
      const entries = buildEntries(listProducts, sourceDate);
      const chunks = chunkEntries(entries);
      const chunkIds = chunks.map((_, index) => index.toString().padStart(4, "0"));
      lists.push({
        document: {
          segmentId,
          versionId,
          listId,
          contentScope,
          workType,
          sourceDate,
          itemCount: entries.length,
          chunkCount: chunks.length,
          chunkIds,
          generatedAt,
        },
        chunks,
      });
    }
  }

  const listIds = lists.map((list) => list.document.listId);
  const totalEntryCount = lists.reduce(
    (sum, list) => sum + list.document.itemCount,
    0,
  );
  if (totalEntryCount === 0 && previousActiveVersion) {
    throw new Error(
      `genre index rebuild produced no entries for ${segmentId}; keeping ${previousActiveVersion}`,
    );
  }
  let activated = false;
  try {
    const building: GenreIndexVersionDocument = {
      segmentId,
      versionId,
      schemaVersion: GENRE_INDEX_SCHEMA_VERSION,
      status: "building",
      listIds,
      generatedAt,
      updatedAt: generatedAt,
    };
    await versionRef.set(removeUndefinedDeep(building), { merge: false });
    for (const list of lists) {
      const listRef = versionRef.collection("lists").doc(list.document.listId);
      await listRef.set(removeUndefinedDeep(list.document), { merge: false });

      for (let index = 0; index < list.chunks.length; index += 1) {
        const entries = list.chunks[index];
        const chunkId = list.document.chunkIds[index];
        const chunk: GenreIndexChunkDocument = {
          segmentId,
          versionId,
          listId: list.document.listId,
          chunkId,
          index,
          itemCount: entries.length,
          entries,
          generatedAt,
        };
        await listRef
          .collection("chunks")
          .doc(chunkId)
          .set(removeUndefinedDeep(chunk), { merge: false });
      }
    }
    await versionRef.set(removeUndefinedDeep({ ...building, status: "ready", updatedAt: generatedAt }), { merge: false });
    const root: GenreIndexRootDocument = {
      segmentId,
      schemaVersion: GENRE_INDEX_SCHEMA_VERSION,
      activeVersion: versionId,
      previousVersion: previousActiveVersion,
      listIds,
      generatedAt,
      updatedAt: generatedAt,
    };
    await rootRef.set(removeUndefinedDeep(root), { merge: false });
    activated = true;
    if (versionToDelete && versionToDelete !== previousActiveVersion && versionToDelete !== versionId) {
      try { await deleteVersion(versionsRef.doc(versionToDelete)); } catch (error) {
        console.warn("Failed to delete old genre index version", { segmentId, versionToDelete, error });
      }
    }
    return { segmentId, versionId, sourceDate, listCount: lists.length };
  } catch (error) {
    if (!activated) {
      try { await deleteVersion(versionRef); } catch (cleanupError) {
        console.warn("Failed to clean up incomplete genre index", { segmentId, versionId, cleanupError });
      }
    }
    throw error;
  }
}
