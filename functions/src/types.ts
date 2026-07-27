import type { Timestamp } from "firebase-admin/firestore";

export type Platform = "dlsite" | "fanza";
export type Audience = "female" | "male" | "general" | "adult";
export type Category = "doujin" | "voice" | "comic" | "game" | "video" | "ebook";
export type AffiliateProvider = "dlsite" | "dmm";
export type AgeRating = "all" | "r15" | "r18" | "adult";
export type RankingType = "daily" | "weekly" | "monthly" | "new" | "sale" | "popular";
export type ProductRankingMode = "dailyRevenue" | "daily" | "weekly" | "monthly" | "cumulative";
export type FetchStatus = "success" | "failed" | "not_found" | "blocked" | "skipped";
export type SellerType = "circle" | "maker" | "label" | "author" | "publisher";
export type ProductWorkType = "comic" | "novel" | "cg" | "movie" | "game" | "voice" | "other";
export type ProductContentType = "tl" | "bl";
export type HomeRankingWorkType = "all" | ProductWorkType;
export type HomeDailyRankingProductIds = Partial<Record<HomeRankingWorkType, string[]>>;

export type HomeProductIdsByWorkType = Partial<Record<HomeRankingWorkType, string[]>>;

export type HomeWeeklyCircleCandidate = {
  product: Product;
  weeklySalesCount: number;
};

export type HomeDashboardViewDocument = {
  schemaVersion: 1;
  strategy: "homeDashboard_v1";
  statId: string;
  contentScope: "all" | ProductContentType;
  sourceDate?: string;
  newCandidateProductIdsByWorkType: HomeProductIdsByWorkType;
  recentCandidateProductIds: string[];
  saleCandidateProductIds: string[];
  weeklyCircleCandidates: HomeWeeklyCircleCandidate[];
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};



export type HomeDashboardStatsSnapshot = {
  productCount: number;
  todayUpdatedCount: number;
  saleCount: number;
  topGenre?: GenreSummary;
  popularGenres: GenreSummary[];
  popularCategories: ProductCategorySummary[];
};

export type HomeDashboardListViewCommonPayload = {
  stats: HomeDashboardStatsSnapshot;
  recentCandidateProducts: ProductCardItem[];
  saleCandidateProducts: ProductCardItem[];
  weeklyCircleCandidates: HomeWeeklyCircleCandidate[];
  fallbackCircleHighlights: SiteStatsCircleHighlight[];
};

export type HomeDashboardListViewProductPayload = {
  products: ProductCardItem[];
};

export type HomeDashboardListViewSectionDescriptor = {
  sectionId: string;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
  itemCount: number;
};

export type HomeDashboardListViewManifestDocument = {
  schemaVersion: 1;
  segmentId: string;
  contentScope: "all" | ProductContentType;
  activeVersion: string;
  previousVersion?: string;
  sourceStatId: string;
  sourceHomeViewUpdatedAtMillis: number;
  sourceSiteStatsUpdatedAtMillis: number;
  sourceRankingVersionId: string;
  sections: Record<string, HomeDashboardListViewSectionDescriptor>;
  activeRunId: string;
  activeStartedAtMillis: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type HomeDashboardListViewVersionDocument = {
  schemaVersion: 1;
  segmentId: string;
  contentScope: "all" | ProductContentType;
  versionId: string;
  runId: string;
  startedAtMillis: number;
  sourceStatId: string;
  sourceHomeViewUpdatedAtMillis: number;
  sourceSiteStatsUpdatedAtMillis: number;
  sourceRankingVersionId: string;
  sections: Record<string, HomeDashboardListViewSectionDescriptor>;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type HomeDashboardListViewCompressedSectionDocument = {
  schemaVersion: 1;
  encoding: "gzip-json-v1";
  sectionId: string;
  versionId: string;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
  itemCount: number;
  payload: Buffer;
  generatedAt: Timestamp;
};

export type ProductSalesSnapshot = {
  date: string;
  salesCount: number;
  priceCurrent?: number;
};

export type ProductRankingMetrics = {
  sourceDate: string;
  priceCurrent: number;
  dailySalesCount?: number;
  dailyRevenue?: number;
  weeklySalesCount?: number;
  monthlySalesCount?: number;
  cumulativeSalesCount: number;
  dailyAvailable: boolean;
  weeklyAvailable: boolean;
  monthlyAvailable: boolean;
  calculatedAt: Timestamp;
};

export type RankingIndexContentScope = "all" | ProductContentType;
export type RankingIndexWorkType = "all" | ProductWorkType;
export type RankingIndexListStatus = "ready" | "insufficient_data";

export type RankingIndexEntry = {
  rank: number;
  productId: string;
  rankingValue: number;
  salesCount: number;
  revenue?: number;
  priceCurrent: number;
};

export type RankingIndexRootDocument = {
  segmentId: string;
  schemaVersion: number;
  platform: Platform;
  audience: Audience;
  category: Category;
  activeVersion: string;
  previousVersion?: string;
  sourceDate?: string;
  sourceDates?: Partial<Record<RankingIndexContentScope, string>>;
  listCount: number;
  listIds: string[];
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type RankingIndexVersionDocument = {
  versionId: string;
  segmentId: string;
  schemaVersion: number;
  platform: Platform;
  audience: Audience;
  category: Category;
  status: "building" | "ready" | "failed";
  sourceDate?: string;
  sourceDates?: Partial<Record<RankingIndexContentScope, string>>;
  listCount: number;
  listIds: string[];
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type RankingIndexListDocument = {
  listId: string;
  versionId: string;
  segmentId: string;
  contentScope: RankingIndexContentScope;
  rankingMode: ProductRankingMode;
  workType: RankingIndexWorkType;
  sourceDate?: string;
  status: RankingIndexListStatus;
  itemCount: number;
  entries: RankingIndexEntry[];
  generatedAt: Timestamp;
};

export type SearchIndexItem = {
  productId: string;
  sourceProductId?: string;
  title?: string;
  seller?: { sellerName?: string };
  workType?: string;
  workTypeLabel?: string;
  contentType?: string;
  contentTypes?: string[];
  contentTypeIds?: string[];
  genres?: string[];
  tags?: string[];
  genreIds?: string[];
  tagIds?: string[];
  salesCount?: number;
  rating?: number;
  ratingAverage?: number;
  releaseDate?: string;
  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  discountAmount?: number;
  isDiscounted?: boolean;
  sellerKey?: string;
};


export type SaleSortMode = "discountRate" | "discountAmount" | "newest";
export type GenreSortMode = "productCount" | "revenue" | "sales";
export type SellerSortMode = "totalSales" | "estimatedRevenue" | "productCount" | "latestRelease" | "sellerName";

export type GenrePeriodMetrics = {
  productCount: number;
  salesCount: number;
  revenue: number;
};

export type GenreIndexProductSummary = {
  productId: string;
  title: string;
  thumbnailUrl?: string;
  mainImageUrl?: string;
};

export type GenreIndexEntry = {
  genreId: string;
  name: string;
  daily: GenrePeriodMetrics;
  weekly: GenrePeriodMetrics;
  monthly: GenrePeriodMetrics;
  cumulative: GenrePeriodMetrics;
  topProducts: {
    daily: GenreIndexProductSummary[];
    weekly: GenreIndexProductSummary[];
    monthly: GenreIndexProductSummary[];
    cumulative: GenreIndexProductSummary[];
  };
};

export type GenreIndexRootDocument = {
  segmentId: string;
  schemaVersion: number;
  activeVersion: string;
  previousVersion?: string;
  listIds: string[];
  generatedAt : Timestamp;
  updatedAt : Timestamp;
};

export type GenreIndexVersionDocument = {
  segmentId: string;
  versionId: string;
  schemaVersion: number;
  status: "building" | "ready" | "failed";
  listIds: string[];
  generatedAt : Timestamp;
  updatedAt : Timestamp;
};

export type GenreIndexListDocument = {
  segmentId: string;
  versionId: string;
  listId: string;
  contentScope: "all" | "tl" | "bl";
  workType: "all" | ProductWorkType;
  sourceDate?: string;
  itemCount: number;
  chunkCount: number;
  chunkIds: string[];
  generatedAt : Timestamp;
};

export type GenreIndexChunkDocument = {
  segmentId: string;
  versionId: string;
  listId: string;
  chunkId: string;
  index: number;
  itemCount: number;
  entries: GenreIndexEntry[];
  generatedAt : Timestamp;
};

export type SellerIndexItem = SiteStatsCircleHighlight & {
  contentScope: "all" | "tl" | "bl";
  normalizedSellerName: string;
  productIdsByReleaseDate: string[];
};

export type SellerIndexRootDocument = {
  indexId: string;
  schemaVersion: number;
  activeVersion: string;
  previousVersion?: string;
  itemCount: number;
  chunkIds: string[];
  generatedAt : Timestamp;
  updatedAt : Timestamp;
};

export type SellerIndexVersionDocument = {
  indexId: string;
  versionId: string;
  schemaVersion: number;
  status: "building" | "ready" | "failed";
  itemCount: number;
  chunkIds: string[];
  generatedAt : Timestamp;
  updatedAt : Timestamp;
};

export type SellerIndexChunkDocument = {
  indexId: string;
  versionId: string;
  chunkId: string;
  index: number;
  itemCount: number;
  items: SellerIndexItem[];
  generatedAt : Timestamp;
};

export type SearchIndexRootDocument = {
  segmentId: string;
  schemaVersion: number;
  platform: Platform;
  audience: Audience;
  category: Category;
  activeVersion: string;
  previousVersion?: string;
  productCount: number;
  chunkCount: number;
  chunkIds: string[];
  checksum: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type SearchIndexVersionDocument = {
  versionId: string;
  segmentId: string;
  schemaVersion: number;
  platform: Platform;
  audience: Audience;
  category: Category;
  status: "building" | "ready" | "failed";
  productCount: number;
  chunkCount: number;
  chunkIds: string[];
  checksum: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type SearchIndexChunkDocument = {
  versionId: string;
  chunkId: string;
  index: number;
  itemCount: number;
  items: SearchIndexItem[];
  generatedAt: Timestamp;
};

export type ProductImage = {
  url: string;
  thumbnailUrl?: string;
  type: "main" | "sample" | "package" | "thumbnail";
  displayOrder: number;
  width?: number;
  height?: number;
};

export type ProductRatingBreakdown = {
  star: 1 | 2 | 3 | 4 | 5;
  count: number;
};

export type Seller = {
  sellerId?: string;
  sellerName?: string;
  sellerType?: SellerType;
  sellerUrl?: string;
};

export type RankingSummary = {
  rankingKey: string;
  type: RankingType;
  rank: number;
  capturedAt: Timestamp;
};

export type Product = {
  productId: string;
  sourceProductId: string;

  platform: Platform;
  audience: Audience;
  category: Category;
  categories?: Category[];

  affiliateProvider: AffiliateProvider;

  title: string;
  titleKana?: string;
  slug?: string;

  seller?: Seller;

  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  isDiscounted?: boolean;
  isOnSale?: boolean;
  currency: "JPY";

  salesCount?: number;
  wishlistCount?: number;

  /**
   * JST日次バッチで販売数差分を計算するための直近日次スナップショット。
   * 通常のproducts.salesCountは最新表示用として維持し、差分計算ではこちらを使う。
   */
  lastDailySalesSnapshotDate?: string;
  lastDailySalesSnapshotCount?: number;
  lastDailySalesSnapshotFetchedAt?: Timestamp;
  previousDailySalesSnapshotDate?: string;
  previousDailySalesSnapshotCount?: number;
  lastDailySalesDeltaCalculatedDate?: string;
  recentSalesSnapshots?: ProductSalesSnapshot[];
  rankingMetrics?: ProductRankingMetrics;

  rating?: number;
  ratingAverage?: number;
  reviewCount?: number;
  ratingBreakdown?: ProductRatingBreakdown[];

  releaseDate?: string;

  ageRating?: AgeRating;
  isAdult: boolean;

  workType?: ProductWorkType;
  workTypeLabel?: string;
  contentTypes?: string[];
  contentTypeIds?: string[];

  thumbnailUrl?: string;
  mainImageUrl?: string;
  images: ProductImage[];

  sourceUrl: string;
  affiliateUrl?: string;

  description?: string;

  genres: string[];
  tags: string[];
  genreIds: string[];
  tagIds: string[];

  searchTokens?: string[];
  latestRankings?: RankingSummary[];

  isActive: boolean;
  fetchStatus: FetchStatus;

  lastFetchedAt?: Timestamp;
  fetchedAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type ProductCardItem = {
  productId: string;
  sourceProductId: string;
  platform: Platform;
  audience: Audience;
  category: Category;
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
  cardImageUrl?: string;
  mainImageUrl?: string;
  thumbnailUrl?: string;
  images?: ProductImage[];
  genres?: string[];
  genreIds?: string[];
  tags?: string[];
  rankingMetric?: {
    mode: ProductRankingMode;
    sourceDate?: string;
    salesCount: number;
    revenue?: number;
    rankingValue: number;
    priceCurrent: number;
  };
};

export type NewListViewContentScope = "all" | ProductContentType;
export type NewListViewWorkType = "all" | ProductWorkType;
export type NewListViewStatus = "ready" | "empty";

export type NewListViewBlockDescriptor = {
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
};

export type NewListViewManifestDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: NewListViewContentScope;
  workType: NewListViewWorkType;
  activeVersion: string;
  previousVersion?: string;
  status: NewListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: NewListViewBlockDescriptor[];
  listChecksum: string;
  activeRunId: string;
  activeStartedAtMillis: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type NewListViewVersionDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: NewListViewContentScope;
  workType: NewListViewWorkType;
  versionId: string;
  runId: string;
  startedAtMillis: number;
  status: NewListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: NewListViewBlockDescriptor[];
  listChecksum: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type NewListViewCompressedBlockDocument = {
  schemaVersion: 1;
  encoding: "gzip-json-v1";
  listId: string;
  versionId: string;
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
  payload: Buffer;
  generatedAt: Timestamp;
};

export type SaleListViewContentScope = "all" | ProductContentType;
export type SaleListViewWorkType = "all" | ProductWorkType;
export type SaleListViewThreshold = 0 | 30 | 50 | 70 | 90;
export type SaleListViewThresholdCounts = {
  0: number;
  30: number;
  50: number;
  70: number;
  90: number;
};
export type SaleListViewStatus = "ready" | "empty";

export type SaleListViewBlockDescriptor = {
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
};

export type SaleListViewManifestDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: SaleListViewContentScope;
  workType: SaleListViewWorkType;
  sortMode: SaleSortMode;
  threshold: SaleListViewThreshold;
  thresholdCounts?: SaleListViewThresholdCounts;
  activeVersion: string;
  previousVersion?: string;
  sourceSearchVersionId: string;
  sourceProductCount: number;
  status: SaleListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: SaleListViewBlockDescriptor[];
  listChecksum: string;
  activeRunId: string;
  activeStartedAtMillis: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type SaleListViewVersionDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: SaleListViewContentScope;
  workType: SaleListViewWorkType;
  sortMode: SaleSortMode;
  threshold: SaleListViewThreshold;
  thresholdCounts?: SaleListViewThresholdCounts;
  versionId: string;
  runId: string;
  startedAtMillis: number;
  sourceSearchVersionId: string;
  sourceProductCount: number;
  status: SaleListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: SaleListViewBlockDescriptor[];
  listChecksum: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type SaleListViewCompressedBlockDocument = {
  schemaVersion: 1;
  encoding: "gzip-json-v1";
  listId: string;
  versionId: string;
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
  payload: Buffer;
  generatedAt: Timestamp;
};

export type RankingListViewStatus = "ready" | "empty";

export type RankingListViewBlockDescriptor = {
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
};

export type RankingListViewManifestDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: RankingIndexContentScope;
  rankingMode: ProductRankingMode;
  workType: RankingIndexWorkType;
  activeVersion: string;
  previousVersion?: string;
  sourceRankingVersionId: string;
  sourceDate?: string;
  status: RankingListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: RankingListViewBlockDescriptor[];
  listChecksum: string;
  activeRunId: string;
  activeStartedAtMillis: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type RankingListViewVersionDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: RankingIndexContentScope;
  rankingMode: ProductRankingMode;
  workType: RankingIndexWorkType;
  versionId: string;
  runId: string;
  startedAtMillis: number;
  sourceRankingVersionId: string;
  sourceDate?: string;
  status: RankingListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: RankingListViewBlockDescriptor[];
  listChecksum: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type RankingListViewCompressedBlockDocument = {
  schemaVersion: 1;
  encoding: "gzip-json-v1";
  listId: string;
  versionId: string;
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
  payload: Buffer;
  generatedAt: Timestamp;
};


export type SellerCardItem = {
  sellerKey: string;
  sellerId?: string;
  sellerName: string;
  sellerUrl?: string;
  sellerType?: SellerType;
  platform: Platform;
  audience: Audience;
  category: Category;
  productCount: number;
  totalSalesCount: number;
  averageSalesCount: number;
  estimatedRevenue: number;
  averagePrice?: number;
  firstReleaseDate?: string;
  latestReleaseDate?: string;
  newestProductTitle?: string;
  cardImageUrl: string;
  tags: { name: string; count: number }[];
};

export type SellerListViewStatus = "ready" | "empty";

export type SellerListViewBlockDescriptor = {
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
};

export type SellerListViewManifestDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: "all" | ProductContentType;
  sortMode: SellerSortMode;
  activeVersion: string;
  previousVersion?: string;
  sourceSellerVersionId: string;
  status: SellerListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: SellerListViewBlockDescriptor[];
  listChecksum: string;
  activeRunId: string;
  activeStartedAtMillis: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type SellerListViewVersionDocument = {
  schemaVersion: 1;
  segmentId: string;
  listId: string;
  contentScope: "all" | ProductContentType;
  sortMode: SellerSortMode;
  versionId: string;
  runId: string;
  startedAtMillis: number;
  sourceSellerVersionId: string;
  status: SellerListViewStatus;
  itemCount: number;
  blockCount: number;
  blocks: SellerListViewBlockDescriptor[];
  listChecksum: string;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type SellerListViewCompressedBlockDocument = {
  schemaVersion: 1;
  encoding: "gzip-json-v1";
  listId: string;
  versionId: string;
  blockId: string;
  blockIndex: number;
  startOffset: number;
  itemCount: number;
  compressedBytes: number;
  uncompressedBytes: number;
  checksum: string;
  payload: Buffer;
  generatedAt: Timestamp;
};

export type ProductDailyMetric = {
  date: string;

  platform: Platform;
  audience: Audience;
  category: Category;

  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  isDiscounted?: boolean;
  isOnSale?: boolean;

  salesCount?: number;
  wishlistCount?: number;

  dailySalesCount?: number | null;
  dailySalesStatus?:
    | "pending"
    | "calculated"
    | "no_previous_snapshot"
    | "sales_count_missing"
    | "negative_delta"
    | "multi_day_gap"
    | "same_day_snapshot"
    | "invalid_snapshot_date";
  dailySalesBaseDate?: string;
  dailySalesNextDate?: string;
  dailySalesBaseCount?: number;
  dailySalesNextCount?: number;
  dailySalesRawDelta?: number;
  dailySalesPeriodDays?: number;
  periodSalesCount?: number;
  dailySalesCalculatedAt?: Timestamp;

  rating?: number;
  ratingAverage?: number;
  reviewCount?: number;
  ratingBreakdown?: ProductRatingBreakdown[];

  workType?: ProductWorkType;
  workTypeLabel?: string;
  contentTypes?: string[];
  contentTypeIds?: string[];

  fetchedAt: Timestamp;
};

export type RankingSnapshot = {
  snapshotId: string;

  platform: Platform;
  audience: Audience;
  category: Category;

  rankingType: RankingType;
  rankingKey: string;

  date: string;
  sourceUrl?: string;

  capturedAt: Timestamp;
  fetchedAt: Timestamp;

  itemCount: number;
  status: "success" | "failed" | "blocked" | "partial";
};

export type RankingSnapshotItem = {
  snapshotId: string;

  platform: Platform;
  audience: Audience;
  category: Category;

  rankingType: RankingType;
  rankingKey: string;

  rank: number;
  productId: string;
  sourceProductId: string;

  capturedAt: Timestamp;
};

export type Taxonomy = {
  taxonomyId: string;
  type: "genre" | "tag";

  platform?: Platform;
  audience?: Audience;
  category?: Category;

  name: string;
  normalizedId: string;

  sourceId?: string;
  sourceName?: string;

  productCount?: number;
  isActive: boolean;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type SellerDocument = {
  sellerId: string;
  platform: Platform;
  sellerType: SellerType;

  sourceSellerId?: string;
  name: string;
  nameKana?: string;

  sourceUrl?: string;
  affiliateUrl?: string;

  productCount?: number;
  isActive: boolean;

  createdAt?: Timestamp;
  updatedAt?: Timestamp;
};

export type SellerStatsContentScope = "all" | ProductContentType;

export type SellerStatsDocument = {
  sellerStatsId: string;
  statId: string;
  sellerKey: string;
  sellerId?: string;
  sellerName: string;
  sellerUrl?: string;
  sellerType?: SellerType;

  platform: Platform;
  audience: Audience;
  category: Category;
  contentScope: SellerStatsContentScope;

  productCount: number;
  totalSalesCount: number;
  averageSalesCount: number;
  estimatedRevenue: number;
  averagePrice?: number;

  firstReleaseDate?: string;
  latestReleaseDate?: string;
  newestProductTitle?: string;

  topProduct?: Product;
  latestProduct?: Product;
  tags: { name: string; count: number }[];

  isActive: boolean;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type BatchRun = {
  runId: string;
  jobName: string;

  platform?: Platform;
  audience?: Audience;
  category?: Category;

  status: "running" | "success" | "failed" | "blocked" | "partial";

  startedAt: Timestamp;
  finishedAt?: Timestamp;

  fetchedProductCount?: number;
  updatedProductCount?: number;
  failedProductCount?: number;
  skippedProductCount?: number;

  rankingSnapshotIds?: string[];
  siteStatsIds?: string[];
  errorMessages: string[];

  createdAt: Timestamp;
};

export type FetchTarget = {
  platform: Platform;
  audience: Audience;
  category: Category;
  rankingType: RankingType;
  /**
   * DLsite女性向け内のTL/BL取得元を分けるための任意項目。
   * 既存データ・既存Targetとの後方互換のため任意にしている。
   */
  contentType?: ProductContentType;
};

export type GenreSummary = {
  name: string;
  genreId: string;
  productCount: number;
  totalSalesCount: number;
};

export type ProductCategorySummary = {
  name: string;
  categoryId: string;
  kind: "contentType" | "workType";
  value: string;
  productCount: number;
  totalSalesCount: number;
};

export type SiteStatsCircleHighlight = {
  sellerKey: string;
  sellerId?: string;
  sellerName: string;
  sellerUrl?: string;
  sellerType?: SellerType;

  platform: Platform;
  audience: Audience;
  category: Category;

  productCount: number;
  totalSalesCount: number;
  averageSalesCount: number;
  estimatedRevenue: number;
  averagePrice?: number;

  firstReleaseDate?: string;
  latestReleaseDate?: string;
  newestProductTitle?: string;

  topProduct?: Product;
  latestProduct?: Product;
  tags: { name: string; count: number }[];
};

export type SiteStatsDocument = {
  statId: string;
  platform: Platform;
  audience: Audience;
  category: Category;

  productCount: number;
  todayUpdatedCount: number;
  saleCount: number;
  topGenre?: GenreSummary;
  popularGenres: GenreSummary[];
  popularCategories?: ProductCategorySummary[];
  circleHighlights: SiteStatsCircleHighlight[];
  sellerCount?: number;
  sellerStatsGeneratedAt?: Timestamp;

  homeDailyRankingProductIds?: HomeDailyRankingProductIds;
  homeDailyRankingDate?: string;
  homeDailyRankingStrategy?: string;
  homeDailyRankingUpdatedAt?: Timestamp;

  maxProducts: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type RawProductDetail = Record<string, unknown>;
