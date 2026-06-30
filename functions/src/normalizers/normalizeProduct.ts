import { Timestamp } from "firebase-admin/firestore";
import type { FetchTarget, Product, RawProductDetail } from "../types";
import { buildProductId, buildSearchTokens } from "../util";

type RawNormalizedProduct = RawProductDetail & {
  sourceProductId?: string;
  title?: string;
  sellerId?: string;
  sellerName?: string;
  sellerType?: "circle" | "maker" | "label" | "author" | "publisher";
  sellerUrl?: string;
  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  salesCount?: number;
  wishlistCount?: number;
  rating?: number;
  ratingAverage?: number;
  reviewCount?: number;
  ratingBreakdown?: Product["ratingBreakdown"];
  releaseDate?: string;
  ageRating?: "all" | "r15" | "r18" | "adult";
  workType?: string;
  thumbnailUrl?: string;
  mainImageUrl?: string;
  images?: Product["images"];
  sourceUrl?: string;
  affiliateUrl?: string;
  description?: string;
  genres?: string[];
  tags?: string[];
  genreIds?: string[];
  tagIds?: string[];
  isOnSale?: boolean;
  isNew?: boolean;
};

export function normalizeProduct(raw: RawProductDetail, target: FetchTarget): Product {
  const value = raw as RawNormalizedProduct;
  const sourceProductId = value.sourceProductId;
  if (!sourceProductId) {
    throw new Error("normalizeProduct failed: sourceProductId is required");
  }

  const title = value.title?.trim();
  if (!title) {
    throw new Error(`normalizeProduct failed: title is required. sourceProductId=${sourceProductId}`);
  }

  const timestamp = Timestamp.now();
  const productId = buildProductId(target.platform, target.category, sourceProductId);
  const priceCurrent = value.priceCurrent;
  const priceOriginal = value.priceOriginal;
  const discountRate = value.discountRate;
  const isDiscounted = Boolean(
    value.isOnSale ||
      (discountRate && discountRate > 0 && priceOriginal && priceCurrent && priceOriginal > priceCurrent),
  );
  const genres = value.genres ?? [];
  const tags = value.tags ?? [];
  const genreIds = value.genreIds ?? [];
  const tagIds = value.tagIds ?? [];
  const sourceUrl = value.sourceUrl ?? "";

  return {
    id: productId,
    productId,
    sourceProductId,
    platform: target.platform,
    audience: target.audience,
    category: target.category,
    categories: [target.category],
    affiliateProvider: target.platform === "fanza" ? "dmm" : "dlsite",
    title,
    seller: value.sellerName
      ? {
          sellerId: value.sellerId,
          sellerName: value.sellerName,
          sellerType: value.sellerType ?? (target.platform === "dlsite" ? "circle" : "maker"),
          sellerUrl: value.sellerUrl,
        }
      : undefined,
    priceCurrent,
    priceOriginal,
    discountRate,
    isDiscounted,
    isOnSale: isDiscounted,
    isNew: Boolean(value.isNew),
    currency: "JPY",
    salesCount: value.salesCount,
    wishlistCount: value.wishlistCount,
    rating: value.rating ?? value.ratingAverage,
    ratingAverage: value.ratingAverage ?? value.rating,
    reviewCount: value.reviewCount,
    ratingBreakdown: value.ratingBreakdown,
    releaseDate: value.releaseDate,
    ageRating: value.ageRating ?? (target.audience === "adult" ? "adult" : "all"),
    isAdult: value.ageRating === "r18" || value.ageRating === "adult" || target.audience === "adult",
    workType: value.workType,
    thumbnailUrl: value.thumbnailUrl,
    mainImageUrl: value.mainImageUrl,
    images: value.images ?? [],
    sourceUrl,
    affiliateUrl: value.affiliateUrl,
    description: value.description,
    genres,
    tags,
    genreIds,
    tagIds,
    searchTokens: buildSearchTokens([title, value.sellerName ?? "", ...genres, ...tags]),
    isActive: true,
    fetchStatus: "success",
    lastFetchedAt: timestamp,
    fetchedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
