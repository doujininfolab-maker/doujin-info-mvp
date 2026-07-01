import type { Timestamp } from "firebase-admin/firestore";

export type Platform = "dlsite" | "fanza";
export type Audience = "female" | "male" | "general" | "adult";
export type Category = "doujin" | "voice" | "comic" | "game" | "video" | "ebook";
export type AffiliateProvider = "dlsite" | "dmm";
export type AgeRating = "all" | "r15" | "r18" | "adult";
export type RankingType = "daily" | "weekly" | "monthly" | "new" | "sale" | "popular";
export type FetchStatus = "success" | "failed" | "not_found" | "blocked" | "skipped";
export type SellerType = "circle" | "maker" | "label" | "author" | "publisher";
export type ProductWorkType = "comic" | "cg" | "movie" | "game" | "voice" | "other";
export type ProductContentType = "tl" | "bl";

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

  maxProducts: number;
  generatedAt: Timestamp;
  updatedAt: Timestamp;
};

export type RawProductDetail = Record<string, unknown>;
