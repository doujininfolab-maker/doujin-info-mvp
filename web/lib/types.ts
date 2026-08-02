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
  generatedAt: FirestoreTimestampLike | string;
  updatedAt: FirestoreTimestampLike | string;
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
  fallbackCircleHighlights: SellerSummary[];
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  payload: unknown;
  generatedAt?: FirestoreTimestampLike | string;
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
  calculatedAt?: FirestoreTimestampLike | string;
};

export type ProductRankingDisplayMetric = {
  mode: ProductRankingMode;
  sourceDate?: string;
  salesCount: number;
  revenue?: number;
  rankingValue: number;
  priceCurrent: number;
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
  listIds?: string[];
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  listIds?: string[];
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
};

export type GenreIndexVersionDocument = {
  segmentId: string;
  versionId: string;
  schemaVersion: number;
  status: "building" | "ready" | "failed";
  listIds: string[];
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
};

export type GenreIndexChunkDocument = {
  segmentId: string;
  versionId: string;
  listId: string;
  chunkId: string;
  index: number;
  itemCount: number;
  entries: GenreIndexEntry[];
  generatedAt?: FirestoreTimestampLike | string;
};

export type SellerIndexItem = SellerSummary & {
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
};

export type SellerIndexVersionDocument = {
  indexId: string;
  versionId: string;
  schemaVersion: number;
  status: "building" | "ready" | "failed";
  itemCount: number;
  chunkIds: string[];
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
};

export type SellerIndexChunkDocument = {
  indexId: string;
  versionId: string;
  chunkId: string;
  index: number;
  itemCount: number;
  items: SellerIndexItem[];
  generatedAt?: FirestoreTimestampLike | string;
};

export type FirestoreTimestampLike = {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
};

export type SearchIndexChunkDocument = {
  versionId: string;
  chunkId: string;
  index: number;
  itemCount: number;
  items: SearchIndexItem[];
  generatedAt?: FirestoreTimestampLike | string;
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

export type ProductSalesEdition = {
  sourceProductId: string;
  editionId?: number;
  editionType?: string;
  languageCode?: string;
  languageLabel?: string;
  salesCount: number;
  displayOrder?: number;
};

export type ProductDailySalesEdition = {
  sourceProductId: string;
  languageCode?: string;
  salesCount: number;
};

export type SourceRankingEntry = {
  term: "day" | "week" | "month" | "total";
  category: string;
  rank: number;
  rankDate?: string;
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
  capturedAt: FirestoreTimestampLike | string;
};

export type Product = {
  id?: string;
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
  isNew?: boolean;
  currency: "JPY";

  salesCount?: number;
  /** 全言語・全エディション合計（DLsite dl_count_total）。 */
  totalSalesCount?: number;
  currentEditionSalesCount?: number;
  salesEditionGroupId?: string | null;
  salesEditions?: ProductSalesEdition[];
  wishlistCount?: number;
  recentSalesSnapshots?: ProductSalesSnapshot[];
  rankingMetrics?: ProductRankingMetrics;
  rankingMetric?: ProductRankingDisplayMetric;
  rating?: number;
  ratingAverage?: number;
  /** 既存互換: 評価件数（DLsite rate_count）。 */
  reviewCount?: number;
  ratingCount?: number;
  textReviewCount?: number;
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
  sourceRankings?: SourceRankingEntry[];

  isActive: boolean;
  fetchStatus: FetchStatus;

  lastFetchedAt?: FirestoreTimestampLike | string;
  fetchedAt?: FirestoreTimestampLike | string;
  createdAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  payload: unknown;
  generatedAt?: FirestoreTimestampLike | string;
};

export type ProductDailyMetric = {
  date: string;
  dateIso?: string;

  platform: Platform;
  audience: Audience;
  category: Category;

  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  isDiscounted?: boolean;
  isOnSale?: boolean;

  salesCount?: number;
  /** 全言語・全エディション合計（DLsite dl_count_total）。 */
  totalSalesCount?: number;
  currentEditionSalesCount?: number;
  salesEditionCounts?: ProductDailySalesEdition[];
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
  dailySalesCalculatedAt?: FirestoreTimestampLike | string;

  rating?: number;
  ratingAverage?: number;
  /** 既存互換: 評価件数（DLsite rate_count）。 */
  reviewCount?: number;
  ratingCount?: number;
  textReviewCount?: number;
  ratingBreakdown?: ProductRatingBreakdown[];

  workType?: ProductWorkType;
  workTypeLabel?: string;
  contentTypes?: string[];
  contentTypeIds?: string[];

  fetchedAt: FirestoreTimestampLike | string;
};

export type ProductTrendPoint = {
  date: string;
  sales: number;
  revenue: number;
  price: number;
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

  capturedAt: FirestoreTimestampLike | string;
  fetchedAt: FirestoreTimestampLike | string;

  itemCount: number;
  items?: {
    productId: string;
    sourceProductId: string;
    rank: number;
    title?: string;
    sourceUrl?: string;
  }[];
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

  capturedAt: FirestoreTimestampLike | string;
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

  createdAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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

  createdAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
};

export type ProductCardItem = {
  productId: string;
  sourceProductId?: string;
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
  rankingMetric?: ProductRankingDisplayMetric;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  payload: unknown;
  generatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  payload: unknown;
  generatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  generatedAt?: FirestoreTimestampLike | string;
};


export type ProductListFilter = {
  platform: Platform;
  audience: Audience;
  category: Category;
  limitCount?: number;
  offsetCount?: number;
  workType?: ProductWorkType;
  contentType?: ProductContentType;
  discountRateMin?: number;
  sellerQuery?: string;
};

export type SiteSegment = {
  key: string;
  label: string;
  shortLabel: string;
  platform: Platform;
  audience: Audience;
  category: Category;
  path: string;
  enabled: boolean;
  description: string;
};

export type SellerSummary = {
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
  products?: Product[];
  tags: { name: string; count: number }[];
};


export type GenreSummary = {
  name: string;
  genreId: string;
  productCount: number;
  totalSalesCount: number;
};

export type GenreRankingItem = GenreSummary & {
  rank: number;
  estimatedRevenue: number;
  topProducts: Array<Product | GenreIndexProductSummary>;
};

export type ProductCategoryKind = "contentType" | "workType";

export type ProductCategorySummary = {
  name: string;
  categoryId: string;
  kind: ProductCategoryKind;
  value: string;
  productCount: number;
  totalSalesCount: number;
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
  circleHighlights: SellerSummary[];
  sellerCount?: number;
  sellerStatsGeneratedAt?: FirestoreTimestampLike | string;

  homeDailyRankingProductIds?: HomeDailyRankingProductIds;
  homeDailyRankingDate?: string;
  homeDailyRankingStrategy?: string;
  homeDailyRankingUpdatedAt?: FirestoreTimestampLike | string;

  maxProducts?: number;
  generatedAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
};

export type HomeDashboardStats = {
  productCount: number;
  todayUpdatedCount: number;
  saleCount: number;
  topGenre?: GenreSummary;
  popularGenres: GenreSummary[];
  popularCategories: ProductCategorySummary[];
};
