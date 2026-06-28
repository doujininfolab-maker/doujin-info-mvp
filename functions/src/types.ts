import type { Timestamp } from "firebase-admin/firestore";

export type Platform = "dlsite" | "fanza";
export type Audience = "female" | "male" | "general" | "adult";
export type Category = "doujin" | "voice" | "comic" | "game" | "video" | "ebook";
export type AffiliateProvider = "dlsite" | "dmm";
export type AgeRating = "all" | "r15" | "r18" | "adult";
export type RankingType = "daily" | "weekly" | "monthly" | "new" | "sale" | "popular";
export type FetchStatus = "success" | "failed" | "not_found" | "blocked" | "skipped";
export type SellerType = "circle" | "maker" | "label" | "author" | "publisher";

export type ProductImage = {
  url: string;
  thumbnailUrl?: string;
  type: "main" | "sample" | "package" | "thumbnail";
  displayOrder: number;
  width?: number;
  height?: number;
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

  lastFetchedAt?: Timestamp;
  fetchedAt?: Timestamp;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
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

  source?: Platform | string;
  target?: string;

  platform?: Platform;
  audience?: Audience;
  category?: Category;

  status: "running" | "success" | "failed" | "blocked" | "partial";

  startedAt: Timestamp;
  finishedAt?: Timestamp;
  durationMs?: number;

  fetchedProductCount?: number;
  updatedProductCount?: number;
  failedProductCount?: number;
  skippedProductCount?: number;

  fetchedCount?: number;
  savedCount?: number;
  skippedCount?: number;
  errorCount?: number;
  errors?: string[];

  rankingSnapshotIds?: string[];
  errorMessages: string[];

  createdAt: Timestamp;
};

export type FetchTarget = {
  platform: Platform;
  audience: Audience;
  category: Category;
  rankingType: RankingType;
};

export type RawProductDetail = Record<string, unknown>;
