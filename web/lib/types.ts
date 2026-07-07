export type Platform = "dlsite" | "fanza";
export type Audience = "female" | "male" | "general" | "adult";
export type Category = "doujin" | "voice" | "comic" | "game" | "video" | "ebook";
export type AffiliateProvider = "dlsite" | "dmm";
export type AgeRating = "all" | "r15" | "r18" | "adult";
export type RankingType = "daily" | "weekly" | "monthly" | "new" | "sale" | "popular";
export type ProductRankingMode = "dailyRevenue" | "daily" | "weekly" | "monthly" | "cumulative";
export type FetchStatus = "success" | "failed" | "not_found" | "blocked" | "skipped";
export type SellerType = "circle" | "maker" | "label" | "author" | "publisher";
export type ProductWorkType = "comic" | "cg" | "movie" | "game" | "voice" | "other";
export type ProductContentType = "tl" | "bl";

export type FirestoreTimestampLike = {
  seconds: number;
  nanoseconds: number;
  toDate?: () => Date;
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
  wishlistCount?: number;
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

  lastFetchedAt?: FirestoreTimestampLike | string;
  fetchedAt?: FirestoreTimestampLike | string;
  createdAt?: FirestoreTimestampLike | string;
  updatedAt?: FirestoreTimestampLike | string;
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
  reviewCount?: number;
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
  topProducts: Product[];
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
