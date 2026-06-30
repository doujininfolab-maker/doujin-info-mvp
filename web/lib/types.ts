export type Platform = "dlsite" | "fanza";
export type Audience = "female" | "male" | "general" | "adult";
export type Category = "doujin" | "voice" | "comic" | "game" | "video" | "ebook";
export type AffiliateProvider = "dlsite" | "dmm";
export type AgeRating = "all" | "r15" | "r18" | "adult";
export type RankingType = "daily" | "weekly" | "monthly" | "new" | "sale" | "popular";
export type FetchStatus = "success" | "failed" | "not_found" | "blocked" | "skipped";
export type SellerType = "circle" | "maker" | "label" | "author" | "publisher";

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

  workType?: string;

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

  salesCount?: number;
  wishlistCount?: number;
  rating?: number;
  ratingAverage?: number;
  reviewCount?: number;
  ratingBreakdown?: ProductRatingBreakdown[];

  fetchedAt: FirestoreTimestampLike | string;
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
