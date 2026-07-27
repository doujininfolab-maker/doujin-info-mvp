import { gzipSync } from "node:zlib";
import type {
  FetchTarget,
  Product,
  ProductContentType,
  ProductRankingMode,
  ProductWorkType,
  SaleSortMode,
  SellerSortMode,
} from "../types";

const DEFAULT_BLOCK_SIZE = 1000;
const DEFAULT_BLOCK_SIZE_CANDIDATES = [200, 500, 1000] as const;
const DEFAULT_TARGET_FUNCTION_MEMORY_MIB = 512;
const PAGE_LIMITS = [30, 50, 100, 200] as const;
const MAX_COMPRESSED_DOCUMENT_BYTES = 700 * 1024;
const SEARCH_V2_TARGET_CHUNK_BYTES = 400 * 1024;
const SEARCH_V2_MAX_ITEMS_PER_CHUNK = 500;
const RANKING_LIMIT = 300;
const CONTENT_SCOPES: ContentScope[] = ["all", "tl", "bl"];
const WORK_TYPES: WorkTypeScope[] = [
  "all",
  "comic",
  "novel",
  "cg",
  "movie",
  "game",
  "voice",
  "other",
];
const SALE_THRESHOLDS = [0, 30, 50, 70, 90] as const;
const SALE_SORT_MODES: SaleSortMode[] = ["discountRate", "discountAmount", "newest"];
const RANKING_MODES: ProductRankingMode[] = [
  "dailyRevenue",
  "daily",
  "weekly",
  "monthly",
  "cumulative",
];
const SELLER_SORT_MODES: SellerSortMode[] = [
  "totalSales",
  "estimatedRevenue",
  "productCount",
  "latestRelease",
  "sellerName",
];

export const LIST_VIEW_DRY_RUN_PRODUCT_FIELDS = [
  "sourceProductId",
  "platform",
  "audience",
  "category",
  "title",
  "seller",
  "priceCurrent",
  "priceOriginal",
  "discountRate",
  "isDiscounted",
  "isOnSale",
  "salesCount",
  "rating",
  "ratingAverage",
  "releaseDate",
  "workType",
  "workTypeLabel",
  "contentType",
  "contentTypes",
  "contentTypeIds",
  "mainImageUrl",
  "thumbnailUrl",
  "images",
  "genres",
  "genreIds",
  "tags",
  "tagIds",
  "rankingMetrics",
  "isActive",
] as const;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;
type ContentScope = "all" | ProductContentType;
type WorkTypeScope = "all" | ProductWorkType;
type SearchSourceProduct = Product & { contentType?: string };

type ProductCardItem = {
  productId: string;
  sourceProductId: string;
  platform: Product["platform"];
  audience: Product["audience"];
  category: Product["category"];
  title: string;
  seller?: {
    sellerId?: string;
    sellerName?: string;
  };
  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  isDiscounted?: boolean;
  isOnSale?: boolean;
  salesCount?: number;
  rating?: number;
  ratingAverage?: number;
  releaseDate?: string;
  workType?: ProductWorkType;
  workTypeLabel?: string;
  contentTypes?: string[];
  contentTypeIds?: string[];
  cardImageUrl: string;
  genres: string[];
  genreIds: string[];
  tags: string[];
  rankingMetric?: {
    mode: ProductRankingMode;
    sourceDate?: string;
    salesCount: number;
    revenue: number;
    rankingValue: number;
    priceCurrent: number;
  };
};

type SellerCardItem = {
  sellerKey: string;
  sellerId?: string;
  sellerName: string;
  platform: Product["platform"];
  audience: Product["audience"];
  category: Product["category"];
  productCount: number;
  totalSalesCount: number;
  averageSalesCount: number;
  estimatedRevenue: number;
  latestReleaseDate?: string;
  newestProductTitle?: string;
  cardImageUrl: string;
  tags: Array<{ name: string; count: number }>;
};

type RankingCandidate = {
  product: Product;
  salesCount: number;
  revenue: number;
  rankingValue: number;
  priceCurrent: number;
};

type ListMetric = {
  listId: string;
  blockSize: number;
  status: "ready" | "empty" | "insufficient_data";
  itemCount: number;
  blockCount: number;
  totalUncompressedBytes: number;
  totalCompressedBytes: number;
  maxUncompressedBlockBytes: number;
  maxCompressedBlockBytes: number;
  oversizedBlockCount: number;
  metadata?: Record<string, unknown>;
};

type DomainReport = {
  blockSize: number;
  listCount: number;
  readyListCount: number;
  emptyListCount: number;
  insufficientDataListCount: number;
  itemOccurrences: number;
  uniqueItemCount: number;
  duplicationFactor: number;
  blockCount: number;
  totalUncompressedBytes: number;
  totalCompressedBytes: number;
  maxUncompressedBlockBytes: number;
  maxCompressedBlockBytes: number;
  oversizedBlockCount: number;
  estimatedCreateWrites: {
    listVersionDocuments: number;
    blockDocuments: number;
    activationDocuments: number;
    total: number;
  };
  estimatedPreviousGenerationCleanupDeletes: number;
  estimatedDailyMutationsWithCleanup: number;
  estimatedPageBlockReads: Record<string, number>;
  estimatedPageDocumentReads: Record<string, number>;
  largestLists: ListMetric[];
  lists?: ListMetric[];
};

type PhaseMetric = {
  phase: string;
  elapsedMs: number;
  memoryBefore: Omit<MemorySnapshot, "phase">;
  memoryAfter: Omit<MemorySnapshot, "phase">;
  memoryDelta: Omit<MemorySnapshot, "phase">;
};

type DomainComparisonReport = DomainReport & {
  selectedBlockSize: number;
  comparisons: DomainReport[];
  phase: PhaseMetric;
};

type SearchCorpusMetric = {
  corpusId: string;
  itemCount: number;
  uncompressedBytes: number;
  compressedBytes: number;
  compressionRatio: number;
  estimatedCompressedChunkCount: number;
  maxCompressedChunkBytes: number;
  oversizedChunkCount: number;
};

type MemorySnapshot = {
  phase: string;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
};

export type ListViewDryRunOptions = {
  includeLists?: boolean;
  blockSizes?: number[];
  selectedBlockSize?: number;
  targetFunctionMemoryMiB?: number;
};

export type ListViewDryRunReport = {
  schemaVersion: 2;
  dryRun: true;
  writesPerformed: false;
  segmentId: string;
  productCount: number;
  sourceFirestoreReadEstimate: number;
  startedAt: string;
  completedAt: string;
  elapsedMs: number;
  assumptions: {
    blockSizes: number[];
    selectedBlockSize: number;
    pageLimits: number[];
    maxCompressedDocumentBytes: number;
    compression: "gzip-json-v1";
    saleListOptimization: string;
    listVersionMetadataDocumentPerList: number;
    activationDocumentPerList: number;
    insufficientDataActivationDocuments: number;
    targetFunctionMemoryMiB: number;
  };
  sourceProjection: {
    fieldCount: number;
    fields: string[];
    totalJsonBytes: number;
    averageJsonBytes: number;
    maxJsonBytes: number;
  };
  contentScopeDistribution: {
    all: number;
    tl: number;
    bl: number;
    tlOnly: number;
    blOnly: number;
    both: number;
    unknown: number;
  };
  productCard: {
    itemCount: number;
    totalBytes: number;
    averageBytes: number;
    maxBytes: number;
  };
  domains: {
    new: DomainComparisonReport;
    sale: DomainComparisonReport & {
      saleProductCount: number;
      optimizedListCount: number;
      naiveListCount: number;
      listReductionRate: number;
      maximumPerProductOccurrence: number;
    };
    ranking: DomainComparisonReport & {
      sourceDates: Partial<Record<ContentScope, string>>;
    };
    seller: DomainComparisonReport & {
      sellerCounts: Record<ContentScope, number>;
    };
  };
  search: {
    currentV2: {
      itemCount: number;
      totalBytes: number;
      estimatedChunkCount: number;
    };
    proposedCorpora: {
      allOnly: SearchCorpusMetric;
      exactPartitioned: SearchCorpusMetric[];
      exactPartitionedTotalCompressedBytes: number;
      exactPartitionedTotalChunkCount: number;
    };
  };
  totals: {
    selectedBlockSize: number;
    listCount: number;
    blockCount: number;
    itemOccurrences: number;
    totalCompressedBytes: number;
    estimatedCreateWrites: number;
    estimatedCleanupDeletes: number;
    estimatedDailyMutationsWithCleanup: number;
    oversizedDocumentCount: number;
  };
  totalsByBlockSize: Array<{
    blockSize: number;
    listCount: number;
    blockCount: number;
    totalCompressedBytes: number;
    estimatedCreateWrites: number;
    estimatedCleanupDeletes: number;
    estimatedDailyMutationsWithCleanup: number;
    oversizedDocumentCount: number;
    maxPageDocumentReads: number;
  }>;
  recommendation: {
    recommendedBlockSize: number;
    rationale: string[];
  };
  phaseMetrics: PhaseMetric[];
  memorySnapshots: MemorySnapshot[];
  maxObservedMemory: Omit<MemorySnapshot, "phase">;
  warnings: string[];
};

function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (typeof timestampLike.seconds === "number" && typeof timestampLike.toDate === "function") {
    return value;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cleanedItem = removeUndefinedDeep(item);
    if (cleanedItem !== undefined) cleaned[key] = cleanedItem;
  }
  return cleaned as T;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function memorySnapshot(phase: string): MemorySnapshot {
  const memory = process.memoryUsage();
  return {
    phase,
    rss: memory.rss,
    heapTotal: memory.heapTotal,
    heapUsed: memory.heapUsed,
    external: memory.external,
    arrayBuffers: memory.arrayBuffers,
  };
}

function withoutPhase(snapshot: MemorySnapshot): Omit<MemorySnapshot, "phase"> {
  const { phase: _phase, ...memory } = snapshot;
  return memory;
}

function memoryDelta(
  before: MemorySnapshot,
  after: MemorySnapshot,
): Omit<MemorySnapshot, "phase"> {
  return {
    rss: after.rss - before.rss,
    heapTotal: after.heapTotal - before.heapTotal,
    heapUsed: after.heapUsed - before.heapUsed,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  };
}

function normalizeBlockSizes(values: number[] | undefined): number[] {
  const source = values?.length ? values : [...DEFAULT_BLOCK_SIZE_CANDIDATES];
  return [...new Set(source.map((value) => Math.floor(value)))]
    .filter((value) => Number.isFinite(value) && value >= 10 && value <= 2000)
    .sort((left, right) => left - right);
}

function estimatedWorstCaseBlockReads(blockSize: number, pageLimit: number): number {
  return 1 + Math.ceil(Math.max(0, pageLimit - 1) / blockSize);
}

function cardFor(
  product: Product,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): ProductCardItem {
  return cardsByProductId.get(product.productId) ?? toProductCardItem(product);
}

function normalizeContentType(value: string | undefined): ProductContentType | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

function getProductScopes(product: Product): Set<ProductContentType> {
  const scopes = new Set<ProductContentType>();
  for (const value of [...(product.contentTypeIds ?? []), ...(product.contentTypes ?? [])]) {
    const normalized = normalizeContentType(value);
    if (normalized) scopes.add(normalized);
  }
  return scopes;
}

function hasScope(product: Product, scope: ContentScope): boolean {
  return scope === "all" || getProductScopes(product).has(scope);
}

function matchesWorkType(product: Product, workType: WorkTypeScope): boolean {
  return workType === "all" || product.workType === workType;
}

function isSaleProduct(product: Product): boolean {
  return Boolean(product.isDiscounted || product.isOnSale || (product.discountRate ?? 0) > 0);
}

function getOptionalDiscountAmount(product: Product): number | undefined {
  return typeof product.priceOriginal === "number" && typeof product.priceCurrent === "number"
    ? Math.max(0, product.priceOriginal - product.priceCurrent)
    : undefined;
}

function getDiscountAmount(product: Product): number {
  return getOptionalDiscountAmount(product) ?? 0;
}

function getOptionalCardImageUrl(product: Product): string | undefined {
  return product.mainImageUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    product.images?.[0]?.thumbnailUrl ||
    undefined;
}

function getCardImageUrl(product: Product): string {
  return getOptionalCardImageUrl(product) || "/no-image.svg";
}

function pairGenres(product: Product, limit = 8): { genres: string[]; genreIds: string[] } {
  const genres = (product.genres ?? []).slice(0, limit);
  const sourceGenreIds = product.genreIds ?? [];
  return {
    genres,
    genreIds: genres.map((genre, index) => sourceGenreIds[index] || `dlsite:${genre}`),
  };
}

function toProductCardItem(product: Product): ProductCardItem {
  const pairedGenres = pairGenres(product);
  return removeUndefinedDeep({
    productId: product.productId,
    sourceProductId: product.sourceProductId,
    platform: product.platform,
    audience: product.audience,
    category: product.category,
    title: product.title,
    seller: product.seller
      ? {
          sellerId: product.seller.sellerId,
          sellerName: product.seller.sellerName,
        }
      : undefined,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    isDiscounted: product.isDiscounted,
    isOnSale: product.isOnSale,
    salesCount: product.salesCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    releaseDate: product.releaseDate,
    workType: product.workType,
    workTypeLabel: product.workTypeLabel,
    contentTypes: product.contentTypes ?? [],
    contentTypeIds: product.contentTypeIds ?? [],
    cardImageUrl: getCardImageUrl(product),
    genres: pairedGenres.genres,
    genreIds: pairedGenres.genreIds,
    tags: (product.tags ?? []).slice(0, 8),
  });
}

function compareReleaseDateOnlyDesc(left: Product, right: Product): number {
  return (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "");
}

function compareReleaseDateDesc(left: Product, right: Product): number {
  return compareReleaseDateOnlyDesc(left, right) || left.productId.localeCompare(right.productId);
}

function compareSaleCandidates(sortMode: SaleSortMode): (left: Product, right: Product) => number {
  if (sortMode === "discountAmount") {
    return (left, right) =>
      getDiscountAmount(right) - getDiscountAmount(left) ||
      (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
      compareReleaseDateDesc(left, right);
  }
  if (sortMode === "newest") {
    return (left, right) =>
      compareReleaseDateOnlyDesc(left, right) ||
      (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
      left.productId.localeCompare(right.productId);
  }
  return (left, right) =>
    (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
    getDiscountAmount(right) - getDiscountAmount(left) ||
    compareReleaseDateDesc(left, right);
}

function blockMetrics<T>(
  listId: string,
  items: T[],
  blockSize: number,
  metadata?: Record<string, unknown>,
): ListMetric {
  const blocks: T[][] = [];
  for (let index = 0; index < items.length; index += blockSize) {
    blocks.push(items.slice(index, index + blockSize));
  }
  let totalUncompressedBytes = 0;
  let totalCompressedBytes = 0;
  let maxUncompressedBlockBytes = 0;
  let maxCompressedBlockBytes = 0;
  let oversizedBlockCount = 0;
  for (const blockItems of blocks) {
    const payload = Buffer.from(JSON.stringify(blockItems), "utf8");
    const compressed = gzipSync(payload);
    totalUncompressedBytes += payload.byteLength;
    totalCompressedBytes += compressed.byteLength;
    maxUncompressedBlockBytes = Math.max(maxUncompressedBlockBytes, payload.byteLength);
    maxCompressedBlockBytes = Math.max(maxCompressedBlockBytes, compressed.byteLength);
    if (compressed.byteLength > MAX_COMPRESSED_DOCUMENT_BYTES) oversizedBlockCount += 1;
  }
  return {
    listId,
    blockSize,
    status: items.length > 0 ? "ready" : "empty",
    itemCount: items.length,
    blockCount: blocks.length,
    totalUncompressedBytes,
    totalCompressedBytes,
    maxUncompressedBlockBytes,
    maxCompressedBlockBytes,
    oversizedBlockCount,
    metadata,
  };
}

function domainReport(
  lists: ListMetric[],
  uniqueItemCount: number,
  blockSize: number,
  includeLists: boolean,
): DomainReport {
  const itemOccurrences = lists.reduce((sum, list) => sum + list.itemCount, 0);
  const blockCount = lists.reduce((sum, list) => sum + list.blockCount, 0);
  const activatableLists = lists.filter((list) => list.status !== "insufficient_data");
  const listVersionDocuments = activatableLists.length;
  const activationDocuments = activatableLists.length;
  const activatableBlockCount = activatableLists.reduce((sum, list) => sum + list.blockCount, 0);
  const createWrites = listVersionDocuments + activatableBlockCount + activationDocuments;
  const cleanupDeletes = listVersionDocuments + activatableBlockCount;
  const sortedLargest = [...lists]
    .sort((left, right) => right.totalCompressedBytes - left.totalCompressedBytes || left.listId.localeCompare(right.listId))
    .slice(0, 20);
  const estimatedPageBlockReads = Object.fromEntries(
    PAGE_LIMITS.map((limit) => [String(limit), estimatedWorstCaseBlockReads(blockSize, limit)]),
  );
  const estimatedPageDocumentReads = Object.fromEntries(
    PAGE_LIMITS.map((limit) => [String(limit), 1 + estimatedWorstCaseBlockReads(blockSize, limit)]),
  );
  return {
    blockSize,
    listCount: lists.length,
    readyListCount: lists.filter((list) => list.status === "ready").length,
    emptyListCount: lists.filter((list) => list.status === "empty").length,
    insufficientDataListCount: lists.filter((list) => list.status === "insufficient_data").length,
    itemOccurrences,
    uniqueItemCount,
    duplicationFactor: uniqueItemCount > 0 ? round(itemOccurrences / uniqueItemCount) : 0,
    blockCount,
    totalUncompressedBytes: lists.reduce((sum, list) => sum + list.totalUncompressedBytes, 0),
    totalCompressedBytes: lists.reduce((sum, list) => sum + list.totalCompressedBytes, 0),
    maxUncompressedBlockBytes: Math.max(0, ...lists.map((list) => list.maxUncompressedBlockBytes)),
    maxCompressedBlockBytes: Math.max(0, ...lists.map((list) => list.maxCompressedBlockBytes)),
    oversizedBlockCount: lists.reduce((sum, list) => sum + list.oversizedBlockCount, 0),
    estimatedCreateWrites: {
      listVersionDocuments,
      blockDocuments: blockCount,
      activationDocuments,
      total: createWrites,
    },
    estimatedPreviousGenerationCleanupDeletes: cleanupDeletes,
    estimatedDailyMutationsWithCleanup: createWrites + cleanupDeletes,
    estimatedPageBlockReads,
    estimatedPageDocumentReads,
    largestLists: sortedLargest,
    lists: includeLists ? lists : undefined,
  };
}

function buildNewLists(
  products: Product[],
  blockSize: number,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): ListMetric[] {
  const lists: ListMetric[] = [];
  for (const scope of CONTENT_SCOPES) {
    const sortedScopeProducts = products
      .filter((product) => product.isActive !== false && hasScope(product, scope))
      .sort(compareReleaseDateDesc);
    for (const workType of WORK_TYPES) {
      const items = sortedScopeProducts
        .filter((product) => matchesWorkType(product, workType))
        .map((product) => cardFor(product, cardsByProductId));
      lists.push(blockMetrics(`${scope}_${workType}`, items, blockSize, { scope, workType }));
    }
  }
  return lists;
}

function buildSaleLists(
  products: Product[],
  blockSize: number,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): ListMetric[] {
  const lists: ListMetric[] = [];
  for (const scope of CONTENT_SCOPES) {
    const scopeProducts = products.filter(
      (product) => product.isActive !== false && hasScope(product, scope) && isSaleProduct(product),
    );
    for (const workType of WORK_TYPES) {
      const workProducts = scopeProducts.filter((product) => matchesWorkType(product, workType));
      const discountRateSorted = [...workProducts].sort(compareSaleCandidates("discountRate"));
      const thresholdCounts = Object.fromEntries(
        SALE_THRESHOLDS.map((threshold) => [threshold, discountRateSorted.filter((product) => (product.discountRate ?? 0) >= threshold).length]),
      );
      lists.push(blockMetrics(
        `${scope}_${workType}_discountRate_all`,
        discountRateSorted.map((product) => cardFor(product, cardsByProductId)),
        blockSize,
        { scope, workType, sortMode: "discountRate", thresholdCounts },
      ));

      for (const sortMode of SALE_SORT_MODES.filter((mode) => mode !== "discountRate")) {
        const sorted = [...workProducts].sort(compareSaleCandidates(sortMode));
        for (const threshold of SALE_THRESHOLDS) {
          const items = sorted
            .filter((product) => (product.discountRate ?? 0) >= threshold)
            .map((product) => cardFor(product, cardsByProductId));
          lists.push(blockMetrics(
            `${scope}_${workType}_${sortMode}_${threshold}`,
            items,
            blockSize,
            { scope, workType, sortMode, threshold },
          ));
        }
      }
    }
  }
  return lists;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveSourceDate(products: Product[]): string | undefined {
  const counts = new Map<string, number>();
  for (const product of products) {
    const sourceDate = product.rankingMetrics?.sourceDate;
    if (!sourceDate || !/^\d{8}$/.test(sourceDate)) continue;
    counts.set(sourceDate, (counts.get(sourceDate) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  const maxCount = Math.max(0, ...entries.map(([, count]) => count));
  const minimumCoverageCount = Math.min(100, Math.max(2, Math.ceil(products.length * 0.01)));
  const minimumRepresentativeCount = Math.max(minimumCoverageCount, Math.ceil(maxCount * 0.25));
  return entries
    .filter(([, count]) => count >= minimumRepresentativeCount)
    .sort((left, right) => right[0].localeCompare(left[0]))[0]?.[0];
}

function resolveSourceDates(products: Product[]): Partial<Record<ContentScope, string>> {
  const active = products.filter((product) => product.isActive !== false);
  const tlProducts = active.filter((product) => hasScope(product, "tl"));
  const blProducts = active.filter((product) => hasScope(product, "bl"));
  const tl = tlProducts.length > 0 ? resolveSourceDate(tlProducts) : undefined;
  const bl = blProducts.length > 0 ? resolveSourceDate(blProducts) : undefined;
  let all: string | undefined;
  if (tl && bl) {
    if (tl === bl) all = tl;
  } else {
    all = tl ?? bl ?? resolveSourceDate(active);
  }
  return removeUndefinedDeep({ all, tl, bl });
}

function latestSourceDate(sourceDates: Partial<Record<ContentScope, string>>): string | undefined {
  return Object.values(sourceDates)
    .filter((value): value is string => typeof value === "string")
    .sort((left, right) => right.localeCompare(left))[0];
}

function toRankingCandidate(
  product: Product,
  rankingMode: ProductRankingMode,
  sourceDate: string | undefined,
): RankingCandidate | undefined {
  const priceCurrent = product.priceCurrent;
  if (!isFiniteNumber(priceCurrent) || priceCurrent <= 0) return undefined;
  const metrics = product.rankingMetrics;
  const cumulativeSalesCount = isFiniteNumber(product.salesCount)
    ? Math.max(0, product.salesCount)
    : metrics?.cumulativeSalesCount;
  if (rankingMode === "cumulative") {
    if (!isFiniteNumber(cumulativeSalesCount)) return undefined;
    return {
      product,
      salesCount: cumulativeSalesCount,
      revenue: cumulativeSalesCount * priceCurrent,
      rankingValue: cumulativeSalesCount,
      priceCurrent,
    };
  }
  if (!metrics || !sourceDate || metrics.sourceDate !== sourceDate) return undefined;
  if (rankingMode === "dailyRevenue" || rankingMode === "daily") {
    if (!metrics.dailyAvailable || !isFiniteNumber(metrics.dailySalesCount)) return undefined;
    const salesCount = Math.max(0, metrics.dailySalesCount);
    const revenue = salesCount * priceCurrent;
    return {
      product,
      salesCount,
      revenue,
      rankingValue: rankingMode === "dailyRevenue" ? revenue : salesCount,
      priceCurrent,
    };
  }
  if (rankingMode === "weekly") {
    if (!metrics.weeklyAvailable || !isFiniteNumber(metrics.weeklySalesCount)) return undefined;
    const salesCount = Math.max(0, metrics.weeklySalesCount);
    return {
      product,
      salesCount,
      revenue: salesCount * priceCurrent,
      rankingValue: salesCount,
      priceCurrent,
    };
  }
  if (!metrics.monthlyAvailable || !isFiniteNumber(metrics.monthlySalesCount)) return undefined;
  const salesCount = Math.max(0, metrics.monthlySalesCount);
  return {
    product,
    salesCount,
    revenue: salesCount * priceCurrent,
    rankingValue: salesCount,
    priceCurrent,
  };
}

function sortRankingCandidates(
  candidates: RankingCandidate[],
  rankingMode: ProductRankingMode,
): RankingCandidate[] {
  return [...candidates].sort((left, right) => {
    const rankingValueDiff = right.rankingValue - left.rankingValue;
    if (rankingValueDiff !== 0) return rankingValueDiff;
    if (rankingMode === "dailyRevenue") {
      const salesDiff = right.salesCount - left.salesCount;
      if (salesDiff !== 0) return salesDiff;
    } else {
      const revenueDiff = right.revenue - left.revenue;
      if (revenueDiff !== 0) return revenueDiff;
    }
    const cumulativeSalesDiff = (right.product.salesCount ?? 0) - (left.product.salesCount ?? 0);
    if (cumulativeSalesDiff !== 0) return cumulativeSalesDiff;
    const ratingDiff =
      (right.product.rating ?? right.product.ratingAverage ?? 0) -
      (left.product.rating ?? left.product.ratingAverage ?? 0);
    if (ratingDiff !== 0) return ratingDiff;
    return left.product.productId.localeCompare(right.product.productId);
  });
}

function buildRankingLists(
  products: Product[],
  blockSize: number,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): {
  lists: ListMetric[];
  sourceDates: Partial<Record<ContentScope, string>>;
} {
  const sourceDates = resolveSourceDates(products);
  const fallbackCumulativeSourceDate = sourceDates.all ?? latestSourceDate(sourceDates);
  const lists: ListMetric[] = [];
  for (const scope of CONTENT_SCOPES) {
    const scopeProducts = products.filter((product) => product.isActive !== false && hasScope(product, scope));
    const scopeSourceDate = sourceDates[scope];
    for (const mode of RANKING_MODES) {
      const listSourceDate = mode === "cumulative"
        ? scopeSourceDate ?? fallbackCumulativeSourceDate
        : scopeSourceDate;
      const modeCandidates = sortRankingCandidates(
        scopeProducts
          .map((product) => toRankingCandidate(product, mode, listSourceDate))
          .filter((candidate): candidate is RankingCandidate => Boolean(candidate)),
        mode,
      );
      for (const workType of WORK_TYPES) {
        const candidates = (workType === "all"
          ? modeCandidates
          : modeCandidates.filter((candidate) => candidate.product.workType === workType))
          .slice(0, RANKING_LIMIT);
        const items = candidates.map((candidate) => ({
          ...cardFor(candidate.product, cardsByProductId),
          rankingMetric: removeUndefinedDeep({
            mode,
            sourceDate: listSourceDate,
            salesCount: candidate.salesCount,
            revenue: candidate.revenue,
            rankingValue: candidate.rankingValue,
            priceCurrent: candidate.priceCurrent,
          }),
        }));
        const status = mode === "cumulative" || Boolean(listSourceDate)
          ? (items.length > 0 ? "ready" : "empty")
          : "insufficient_data";
        const metric = blockMetrics(`${scope}_${mode}_${workType}`, items, blockSize, {
          scope,
          mode,
          workType,
          sourceDate: listSourceDate,
        });
        metric.status = status;
        lists.push(metric);
      }
    }
  }
  return { lists, sourceDates };
}

function sellerKey(product: Product): string | undefined {
  return product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim() || undefined;
}

function buildSellerCards(products: Product[], scope: ContentScope): SellerCardItem[] {
  const groups = new Map<string, Product[]>();
  for (const product of products) {
    if (product.isActive === false || !hasScope(product, scope)) continue;
    const key = sellerKey(product);
    if (!key) continue;
    const current = groups.get(key) ?? [];
    current.push(product);
    groups.set(key, current);
  }
  const items: SellerCardItem[] = [];
  for (const [key, sellerProducts] of groups) {
    const bySales = [...sellerProducts].sort(
      (left, right) => (right.salesCount ?? 0) - (left.salesCount ?? 0) || left.productId.localeCompare(right.productId),
    );
    const byRelease = [...sellerProducts].sort(
      (left, right) =>
        (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") ||
        left.title.localeCompare(right.title, "ja") ||
        left.productId.localeCompare(right.productId),
    );
    const topProduct = bySales[0];
    const latestProduct = byRelease[0] ?? topProduct;
    if (!topProduct) continue;
    const totalSalesCount = sellerProducts.reduce((sum, product) => sum + (product.salesCount ?? 0), 0);
    const estimatedRevenue = sellerProducts.reduce(
      (sum, product) => sum + (product.salesCount ?? 0) * (product.priceCurrent ?? 0),
      0,
    );
    const tagCounts = new Map<string, number>();
    for (const product of sellerProducts) {
      for (const genre of product.genres ?? []) {
        if (genre) tagCounts.set(genre, (tagCounts.get(genre) ?? 0) + 1);
      }
    }
    items.push(removeUndefinedDeep({
      sellerKey: key,
      sellerId: topProduct.seller?.sellerId,
      sellerName: topProduct.seller?.sellerName ?? key,
      platform: topProduct.platform,
      audience: topProduct.audience,
      category: topProduct.category,
      productCount: sellerProducts.length,
      totalSalesCount,
      averageSalesCount: sellerProducts.length ? Math.round(totalSalesCount / sellerProducts.length) : 0,
      estimatedRevenue,
      latestReleaseDate: latestProduct?.releaseDate,
      newestProductTitle: latestProduct?.title,
      cardImageUrl:
        getOptionalCardImageUrl(topProduct) ||
        (latestProduct ? getOptionalCardImageUrl(latestProduct) : undefined) ||
        "/no-image.svg",
      tags: [...tagCounts.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ja"))
        .slice(0, 8)
        .map(([name, count]) => ({ name, count })),
    }));
  }
  return items;
}

function compareSellerCards(sortMode: SellerSortMode): (left: SellerCardItem, right: SellerCardItem) => number {
  if (sortMode === "estimatedRevenue") {
    return (left, right) =>
      right.estimatedRevenue - left.estimatedRevenue ||
      right.totalSalesCount - left.totalSalesCount ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "productCount") {
    return (left, right) =>
      right.productCount - left.productCount ||
      right.totalSalesCount - left.totalSalesCount ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "latestRelease") {
    return (left, right) =>
      (right.latestReleaseDate ?? "").localeCompare(left.latestReleaseDate ?? "") ||
      right.totalSalesCount - left.totalSalesCount ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "sellerName") {
    return (left, right) =>
      left.sellerName.localeCompare(right.sellerName, "ja") ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  return (left, right) =>
    right.totalSalesCount - left.totalSalesCount ||
    right.productCount - left.productCount ||
    left.sellerKey.localeCompare(right.sellerKey);
}

function buildSellerLists(products: Product[], blockSize: number): {
  lists: ListMetric[];
  sellerCounts: Record<ContentScope, number>;
} {
  const lists: ListMetric[] = [];
  const sellerCounts: Record<ContentScope, number> = { all: 0, tl: 0, bl: 0 };
  for (const scope of CONTENT_SCOPES) {
    const cards = buildSellerCards(products, scope);
    sellerCounts[scope] = cards.length;
    for (const sortMode of SELLER_SORT_MODES) {
      lists.push(blockMetrics(
        `${scope}_${sortMode}`,
        [...cards].sort(compareSellerCards(sortMode)),
        blockSize,
        { scope, sortMode },
      ));
    }
  }
  return { lists, sellerCounts };
}

function toCurrentSearchIndexItem(product: SearchSourceProduct): Record<string, unknown> {
  return removeUndefinedDeep({
    productId: product.productId,
    sourceProductId: product.sourceProductId,
    title: product.title,
    seller: product.seller?.sellerName ? { sellerName: product.seller.sellerName } : undefined,
    workType: product.workType,
    workTypeLabel: product.workTypeLabel,
    contentType: product.contentType,
    contentTypes: product.contentTypes ?? [],
    contentTypeIds: product.contentTypeIds ?? [],
    genres: product.genres ?? [],
    tags: product.tags ?? [],
    genreIds: product.genreIds ?? [],
    tagIds: product.tagIds ?? [],
    salesCount: product.salesCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    releaseDate: product.releaseDate,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    discountAmount: getOptionalDiscountAmount(product),
    isDiscounted: isSaleProduct(product),
    sellerKey: sellerKey(product),
  });
}

function toSearchCorpusItem(
  product: Product,
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): Record<string, unknown> {
  return removeUndefinedDeep({
    search: {
      sourceProductId: product.sourceProductId,
      title: product.title,
      sellerName: product.seller?.sellerName ?? "",
      genres: product.genres ?? [],
      tags: product.tags ?? [],
      contentTypes: product.contentTypes ?? [],
      contentTypeIds: product.contentTypeIds ?? [],
      workType: product.workType,
      salesCount: product.salesCount,
      rating: product.rating,
      ratingAverage: product.ratingAverage,
      releaseDate: product.releaseDate,
    },
    card: cardFor(product, cardsByProductId),
  });
}

function estimateCurrentSearchV2Chunks(items: Record<string, unknown>[]): number {
  let chunkCount = 0;
  let currentCount = 0;
  let currentBytes = 0;
  for (const item of items) {
    const itemBytes = bytes(item) + 2;
    if (
      currentCount > 0 &&
      (currentBytes + itemBytes > SEARCH_V2_TARGET_CHUNK_BYTES || currentCount >= SEARCH_V2_MAX_ITEMS_PER_CHUNK)
    ) {
      chunkCount += 1;
      currentCount = 0;
      currentBytes = 0;
    }
    currentCount += 1;
    currentBytes += itemBytes;
  }
  return chunkCount + (currentCount > 0 ? 1 : 0);
}

function splitCompressedCorpus(items: Record<string, unknown>[]): Array<{ uncompressed: number; compressed: number }> {
  const chunks: Array<{ uncompressed: number; compressed: number }> = [];
  const split = (candidate: Record<string, unknown>[]): void => {
    if (candidate.length === 0) return;
    const payload = Buffer.from(JSON.stringify(candidate), "utf8");
    const compressed = gzipSync(payload);
    if (compressed.byteLength <= MAX_COMPRESSED_DOCUMENT_BYTES || candidate.length === 1) {
      chunks.push({ uncompressed: payload.byteLength, compressed: compressed.byteLength });
      return;
    }
    const middle = Math.ceil(candidate.length / 2);
    split(candidate.slice(0, middle));
    split(candidate.slice(middle));
  };
  for (let index = 0; index < items.length; index += 2000) {
    split(items.slice(index, index + 2000));
  }
  return chunks;
}

function corpusMetric(
  corpusId: string,
  products: Product[],
  cardsByProductId: ReadonlyMap<string, ProductCardItem>,
): SearchCorpusMetric {
  const items = products.map((product) => toSearchCorpusItem(product, cardsByProductId));
  const payload = Buffer.from(JSON.stringify(items), "utf8");
  const compressed = gzipSync(payload);
  const chunks = splitCompressedCorpus(items);
  return {
    corpusId,
    itemCount: items.length,
    uncompressedBytes: payload.byteLength,
    compressedBytes: compressed.byteLength,
    compressionRatio: payload.byteLength > 0 ? round(compressed.byteLength / payload.byteLength) : 0,
    estimatedCompressedChunkCount: chunks.length,
    maxCompressedChunkBytes: Math.max(0, ...chunks.map((chunk) => chunk.compressed)),
    oversizedChunkCount: chunks.filter((chunk) => chunk.compressed > MAX_COMPRESSED_DOCUMENT_BYTES).length,
  };
}

function contentScopeDistribution(products: Product[]): ListViewDryRunReport["contentScopeDistribution"] {
  let tlOnly = 0;
  let blOnly = 0;
  let both = 0;
  let unknown = 0;
  for (const product of products) {
    const scopes = getProductScopes(product);
    if (scopes.has("tl") && scopes.has("bl")) both += 1;
    else if (scopes.has("tl")) tlOnly += 1;
    else if (scopes.has("bl")) blOnly += 1;
    else unknown += 1;
  }
  return {
    all: products.length,
    tl: tlOnly + both,
    bl: blOnly + both,
    tlOnly,
    blOnly,
    both,
    unknown,
  };
}

function maxObservedMemory(snapshots: MemorySnapshot[]): Omit<MemorySnapshot, "phase"> {
  return {
    rss: Math.max(...snapshots.map((snapshot) => snapshot.rss)),
    heapTotal: Math.max(...snapshots.map((snapshot) => snapshot.heapTotal)),
    heapUsed: Math.max(...snapshots.map((snapshot) => snapshot.heapUsed)),
    external: Math.max(...snapshots.map((snapshot) => snapshot.external)),
    arrayBuffers: Math.max(...snapshots.map((snapshot) => snapshot.arrayBuffers)),
  };
}

function measurePhase<T>(
  phase: string,
  memorySnapshots: MemorySnapshot[],
  operation: () => T,
): { value: T; metric: PhaseMetric } {
  const before = memorySnapshot(`${phase}:before`);
  memorySnapshots.push(before);
  const startedAt = Date.now();
  const value = operation();
  const after = memorySnapshot(`${phase}:after`);
  memorySnapshots.push(after);
  return {
    value,
    metric: {
      phase,
      elapsedMs: Date.now() - startedAt,
      memoryBefore: withoutPhase(before),
      memoryAfter: withoutPhase(after),
      memoryDelta: memoryDelta(before, after),
    },
  };
}

function analyzeDomainComparisons(
  phase: string,
  blockSizes: number[],
  selectedBlockSize: number,
  uniqueItemCount: number,
  includeLists: boolean,
  memorySnapshots: MemorySnapshot[],
  buildLists: (blockSize: number) => ListMetric[],
): DomainComparisonReport {
  const measured = measurePhase(phase, memorySnapshots, () => {
    return blockSizes.map((blockSize) => {
      const lists = buildLists(blockSize);
      const report = domainReport(
        lists,
        uniqueItemCount,
        blockSize,
        includeLists && blockSize === selectedBlockSize,
      );
      memorySnapshots.push(memorySnapshot(`${phase}:blockSize:${blockSize}`));
      return report;
    });
  });
  const selected = measured.value.find((report) => report.blockSize === selectedBlockSize);
  if (!selected) {
    throw new Error(`Selected block size ${selectedBlockSize} was not analyzed for ${phase}`);
  }
  return {
    ...selected,
    selectedBlockSize,
    comparisons: measured.value,
    phase: measured.metric,
  };
}

function maximumSaleOccurrence(products: Product[]): number {
  let maximum = 0;
  for (const product of products.filter(isSaleProduct)) {
    const scopeMultiplier = 1 + getProductScopes(product).size;
    const workTypeMultiplier = product.workType ? 2 : 1;
    const eligibleThresholdCount = SALE_THRESHOLDS.filter(
      (threshold) => (product.discountRate ?? 0) >= threshold,
    ).length;
    const listsPerScopeAndWorkType = 1 + 2 * eligibleThresholdCount;
    maximum = Math.max(
      maximum,
      scopeMultiplier * workTypeMultiplier * listsPerScopeAndWorkType,
    );
  }
  return maximum;
}

function aggregateTotalsByBlockSize(
  blockSizes: number[],
  domains: DomainComparisonReport[],
): ListViewDryRunReport["totalsByBlockSize"] {
  return blockSizes.map((blockSize) => {
    const reports = domains.map((domain) => {
      const report = domain.comparisons.find((candidate) => candidate.blockSize === blockSize);
      if (!report) throw new Error(`Missing block-size comparison ${blockSize}`);
      return report;
    });
    return {
      blockSize,
      listCount: reports.reduce((sum, report) => sum + report.listCount, 0),
      blockCount: reports.reduce((sum, report) => sum + report.blockCount, 0),
      totalCompressedBytes: reports.reduce((sum, report) => sum + report.totalCompressedBytes, 0),
      estimatedCreateWrites: reports.reduce((sum, report) => sum + report.estimatedCreateWrites.total, 0),
      estimatedCleanupDeletes: reports.reduce(
        (sum, report) => sum + report.estimatedPreviousGenerationCleanupDeletes,
        0,
      ),
      estimatedDailyMutationsWithCleanup: reports.reduce(
        (sum, report) => sum + report.estimatedDailyMutationsWithCleanup,
        0,
      ),
      oversizedDocumentCount: reports.reduce(
        (sum, report) => sum + report.oversizedBlockCount,
        0,
      ),
      maxPageDocumentReads: Math.max(
        ...reports.flatMap((report) => Object.values(report.estimatedPageDocumentReads)),
      ),
    };
  });
}

export function analyzeListViewDryRun(
  segment: SiteSegmentKey,
  sourceProducts: Product[],
  options: ListViewDryRunOptions = {},
): ListViewDryRunReport {
  const startedAtDate = new Date();
  const includeLists = options.includeLists === true;
  const blockSizes = normalizeBlockSizes(options.blockSizes);
  const rawSelectedBlockSize = Math.floor(
    options.selectedBlockSize ?? DEFAULT_BLOCK_SIZE,
  );
  const selectedBlockSize = Number.isFinite(rawSelectedBlockSize)
    ? Math.min(2000, Math.max(10, rawSelectedBlockSize))
    : DEFAULT_BLOCK_SIZE;
  if (!blockSizes.includes(selectedBlockSize)) blockSizes.push(selectedBlockSize);
  blockSizes.sort((left, right) => left - right);
  const targetFunctionMemoryMiB = Math.min(
    32_768,
    Math.max(128, Math.floor(
      options.targetFunctionMemoryMiB ?? DEFAULT_TARGET_FUNCTION_MEMORY_MIB,
    )),
  );
  const products = sourceProducts.filter((product) => product.isActive !== false);
  const segmentId = `${segment.platform}_${segment.audience}_${segment.category}`;
  const memorySnapshots: MemorySnapshot[] = [memorySnapshot("start")];
  const phaseMetrics: PhaseMetric[] = [];

  const projectionMeasured = measurePhase("source_projection", memorySnapshots, () => {
    let totalJsonBytes = 0;
    let maxJsonBytes = 0;
    for (const product of products) {
      const size = bytes(product);
      totalJsonBytes += size;
      maxJsonBytes = Math.max(maxJsonBytes, size);
    }
    return { totalJsonBytes, maxJsonBytes };
  });
  phaseMetrics.push(projectionMeasured.metric);

  const cardsMeasured = measurePhase("product_cards", memorySnapshots, () => {
    const cards = products.map(toProductCardItem);
    const cardsByProductId = new Map(cards.map((card) => [card.productId, card]));
    let totalBytes = 0;
    let maxBytes = 0;
    for (const card of cards) {
      const size = bytes(card);
      totalBytes += size;
      maxBytes = Math.max(maxBytes, size);
    }
    return { cards, cardsByProductId, totalBytes, maxBytes };
  });
  phaseMetrics.push(cardsMeasured.metric);
  const { cards, cardsByProductId } = cardsMeasured.value;

  const newReport = analyzeDomainComparisons(
    "new_lists",
    blockSizes,
    selectedBlockSize,
    products.length,
    includeLists,
    memorySnapshots,
    (blockSize) => buildNewLists(products, blockSize, cardsByProductId),
  );
  phaseMetrics.push(newReport.phase);

  const saleProducts = products.filter(isSaleProduct);
  const saleBaseReport = analyzeDomainComparisons(
    "sale_lists",
    blockSizes,
    selectedBlockSize,
    saleProducts.length,
    includeLists,
    memorySnapshots,
    (blockSize) => buildSaleLists(products, blockSize, cardsByProductId),
  );
  phaseMetrics.push(saleBaseReport.phase);
  const saleReport: ListViewDryRunReport["domains"]["sale"] = {
    ...saleBaseReport,
    saleProductCount: saleProducts.length,
    optimizedListCount: saleBaseReport.listCount,
    naiveListCount:
      CONTENT_SCOPES.length * WORK_TYPES.length * SALE_THRESHOLDS.length * SALE_SORT_MODES.length,
    listReductionRate: round(
      1 - saleBaseReport.listCount /
        (CONTENT_SCOPES.length * WORK_TYPES.length * SALE_THRESHOLDS.length * SALE_SORT_MODES.length),
    ),
    maximumPerProductOccurrence: maximumSaleOccurrence(products),
  };

  const sourceDates = resolveSourceDates(products);
  const rankingReport = analyzeDomainComparisons(
    "ranking_lists",
    blockSizes,
    selectedBlockSize,
    products.length,
    includeLists,
    memorySnapshots,
    (blockSize) => buildRankingLists(products, blockSize, cardsByProductId).lists,
  ) as ListViewDryRunReport["domains"]["ranking"];
  rankingReport.sourceDates = sourceDates;
  phaseMetrics.push(rankingReport.phase);

  let selectedSellerCounts: Record<ContentScope, number> = { all: 0, tl: 0, bl: 0 };
  const sellerReport = analyzeDomainComparisons(
    "seller_lists",
    blockSizes,
    selectedBlockSize,
    0,
    includeLists,
    memorySnapshots,
    (blockSize) => {
      const built = buildSellerLists(products, blockSize);
      if (blockSize === selectedBlockSize) selectedSellerCounts = built.sellerCounts;
      return built.lists;
    },
  ) as ListViewDryRunReport["domains"]["seller"];
  sellerReport.uniqueItemCount = selectedSellerCounts.all;
  sellerReport.duplicationFactor = selectedSellerCounts.all > 0
    ? round(sellerReport.itemOccurrences / selectedSellerCounts.all)
    : 0;
  sellerReport.sellerCounts = selectedSellerCounts;
  for (const comparison of sellerReport.comparisons) {
    comparison.uniqueItemCount = selectedSellerCounts.all;
    comparison.duplicationFactor = selectedSellerCounts.all > 0
      ? round(comparison.itemOccurrences / selectedSellerCounts.all)
      : 0;
  }
  phaseMetrics.push(sellerReport.phase);

  const searchMeasured = measurePhase("search_corpora", memorySnapshots, () => {
    const currentSearchItems = [...products]
      .sort((left, right) => left.productId.localeCompare(right.productId))
      .map((product) => toCurrentSearchIndexItem(product as SearchSourceProduct));
    const currentSearchTotalBytes = currentSearchItems.reduce(
      (sum, item) => sum + bytes(item) + 2,
      0,
    );
    const exactPartitions = {
      tlOnly: products.filter((product) => {
        const scopes = getProductScopes(product);
        return scopes.has("tl") && !scopes.has("bl");
      }),
      blOnly: products.filter((product) => {
        const scopes = getProductScopes(product);
        return scopes.has("bl") && !scopes.has("tl");
      }),
      both: products.filter((product) => {
        const scopes = getProductScopes(product);
        return scopes.has("tl") && scopes.has("bl");
      }),
      unknown: products.filter((product) => getProductScopes(product).size === 0),
    };
    const allOnlyCorpus = corpusMetric("all", products, cardsByProductId);
    const exactPartitionedCorpora = [
      corpusMetric("tlOnly", exactPartitions.tlOnly, cardsByProductId),
      corpusMetric("blOnly", exactPartitions.blOnly, cardsByProductId),
      corpusMetric("both", exactPartitions.both, cardsByProductId),
      corpusMetric("unknown", exactPartitions.unknown, cardsByProductId),
    ];
    return {
      currentSearchItems,
      currentSearchTotalBytes,
      allOnlyCorpus,
      exactPartitionedCorpora,
    };
  });
  phaseMetrics.push(searchMeasured.metric);

  const distribution = contentScopeDistribution(products);
  const domainReports: DomainComparisonReport[] = [
    newReport,
    saleReport,
    rankingReport,
    sellerReport,
  ];
  const totalsByBlockSize = aggregateTotalsByBlockSize(blockSizes, domainReports);
  const selectedTotals = totalsByBlockSize.find(
    (candidate) => candidate.blockSize === selectedBlockSize,
  );
  if (!selectedTotals) throw new Error("Selected totals are unavailable");

  const itemOccurrences = domainReports.reduce((sum, report) => sum + report.itemOccurrences, 0);
  const maxMemory = maxObservedMemory(memorySnapshots);
  const targetMemoryBytes = targetFunctionMemoryMiB * 1024 * 1024;
  const warnings: string[] = [];
  if (domainReports.some((report) => report.oversizedBlockCount > 0)) {
    warnings.push("At least one selected list-view block exceeds the compressed document safety limit.");
  }
  if (distribution.unknown > 0) {
    warnings.push("Products with no TL/BL scope exist; a TL/BL-only search corpus would change the current 'all' search result set.");
  }
  if (distribution.both > 0) {
    warnings.push("Products assigned to both TL and BL exist; a split search corpus must deduplicate product IDs for the 'all' scope.");
  }
  if (rankingReport.insufficientDataListCount > 0) {
    warnings.push("Some ranking lists are insufficient_data; they must not create or activate a replacement version.");
  }
  if (saleReport.estimatedDailyMutationsWithCleanup > 10_000) {
    warnings.push("Estimated selected sale-view writes plus cleanup deletes exceed 10,000 mutations.");
  }
  if (selectedTotals.estimatedDailyMutationsWithCleanup > 10_000) {
    warnings.push("Estimated total selected-view writes plus cleanup deletes exceed 10,000 mutations.");
  }
  if (maxMemory.heapUsed > targetMemoryBytes * 0.7) {
    warnings.push(`Observed heapUsed exceeds 70% of the ${targetFunctionMemoryMiB} MiB target function memory.`);
  }
  if (maxMemory.rss > targetMemoryBytes * 0.7) {
    warnings.push(`Observed RSS exceeds 70% of the ${targetFunctionMemoryMiB} MiB target function memory.`);
  }
  if (searchMeasured.value.allOnlyCorpus.compressedBytes > 5 * 1024 * 1024) {
    warnings.push("The all-products search corpus exceeds 5 MiB compressed and may remain slow on cold starts.");
  }

  const baseline50 = totalsByBlockSize.find((candidate) => candidate.blockSize === 50);
  const recommendedTotals = [...totalsByBlockSize]
    .filter(
      (candidate) =>
        candidate.blockSize >= Math.max(...PAGE_LIMITS) &&
        candidate.oversizedDocumentCount === 0 &&
        candidate.maxPageDocumentReads <= 3,
    )
    .sort((left, right) => right.blockSize - left.blockSize)[0] ??
    totalsByBlockSize.find((candidate) => candidate.oversizedDocumentCount === 0) ??
    selectedTotals;
  const rationale = [
    `Recommended block size is the largest analyzed safe candidate that keeps worst-case page access at three Firestore document reads or fewer.`,
    `Worst-case page access is ${recommendedTotals.maxPageDocumentReads} Firestore document reads including one list manifest.`,
    `Selected maximum compressed block size is ${Math.max(...domainReports.map((report) => report.maxCompressedBlockBytes))} bytes.`,
  ];
  if (baseline50) {
    const reduction = baseline50.estimatedDailyMutationsWithCleanup > 0
      ? round(1 - recommendedTotals.estimatedDailyMutationsWithCleanup /
        baseline50.estimatedDailyMutationsWithCleanup, 4)
      : 0;
    rationale.push(`Estimated mutations are reduced by ${round(reduction * 100, 2)}% versus 50-item blocks.`);
  }

  const completedAtDate = new Date();
  return {
    schemaVersion: 2,
    dryRun: true,
    writesPerformed: false,
    segmentId,
    productCount: products.length,
    sourceFirestoreReadEstimate: products.length,
    startedAt: startedAtDate.toISOString(),
    completedAt: completedAtDate.toISOString(),
    elapsedMs: completedAtDate.getTime() - startedAtDate.getTime(),
    assumptions: {
      blockSizes,
      selectedBlockSize,
      pageLimits: [...PAGE_LIMITS],
      maxCompressedDocumentBytes: MAX_COMPRESSED_DOCUMENT_BYTES,
      compression: "gzip-json-v1",
      saleListOptimization:
        "discountRate uses one sorted list plus threshold counts; discountAmount/newest use threshold-specific lists",
      listVersionMetadataDocumentPerList: 1,
      activationDocumentPerList: 1,
      insufficientDataActivationDocuments: 0,
      targetFunctionMemoryMiB,
    },
    sourceProjection: {
      fieldCount: LIST_VIEW_DRY_RUN_PRODUCT_FIELDS.length,
      fields: [...LIST_VIEW_DRY_RUN_PRODUCT_FIELDS],
      totalJsonBytes: projectionMeasured.value.totalJsonBytes,
      averageJsonBytes: products.length > 0
        ? round(projectionMeasured.value.totalJsonBytes / products.length)
        : 0,
      maxJsonBytes: projectionMeasured.value.maxJsonBytes,
    },
    contentScopeDistribution: distribution,
    productCard: {
      itemCount: cards.length,
      totalBytes: cardsMeasured.value.totalBytes,
      averageBytes: cards.length > 0
        ? round(cardsMeasured.value.totalBytes / cards.length)
        : 0,
      maxBytes: cardsMeasured.value.maxBytes,
    },
    domains: {
      new: newReport,
      sale: saleReport,
      ranking: rankingReport,
      seller: sellerReport,
    },
    search: {
      currentV2: {
        itemCount: searchMeasured.value.currentSearchItems.length,
        totalBytes: searchMeasured.value.currentSearchTotalBytes,
        estimatedChunkCount: estimateCurrentSearchV2Chunks(
          searchMeasured.value.currentSearchItems,
        ),
      },
      proposedCorpora: {
        allOnly: searchMeasured.value.allOnlyCorpus,
        exactPartitioned: searchMeasured.value.exactPartitionedCorpora,
        exactPartitionedTotalCompressedBytes:
          searchMeasured.value.exactPartitionedCorpora.reduce(
            (sum, corpus) => sum + corpus.compressedBytes,
            0,
          ),
        exactPartitionedTotalChunkCount:
          searchMeasured.value.exactPartitionedCorpora.reduce(
            (sum, corpus) => sum + corpus.estimatedCompressedChunkCount,
            0,
          ),
      },
    },
    totals: {
      selectedBlockSize,
      listCount: selectedTotals.listCount,
      blockCount: selectedTotals.blockCount,
      itemOccurrences,
      totalCompressedBytes: selectedTotals.totalCompressedBytes,
      estimatedCreateWrites: selectedTotals.estimatedCreateWrites,
      estimatedCleanupDeletes: selectedTotals.estimatedCleanupDeletes,
      estimatedDailyMutationsWithCleanup:
        selectedTotals.estimatedDailyMutationsWithCleanup,
      oversizedDocumentCount: selectedTotals.oversizedDocumentCount,
    },
    totalsByBlockSize,
    recommendation: {
      recommendedBlockSize: recommendedTotals.blockSize,
      rationale,
    },
    phaseMetrics,
    memorySnapshots,
    maxObservedMemory: maxMemory,
    warnings,
  };
}
