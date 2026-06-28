import type { SourceAdapter } from "../types";
import type { FetchTarget, RawProductDetail } from "../../types";
import { normalizeProduct } from "../../normalizers/normalizeProduct";
import { buildDummyProducts } from "../../seed/dummyProducts";

const target: FetchTarget = {
  platform: "dlsite",
  audience: "female",
  category: "doujin",
  rankingType: "daily",
};

const sourceUrl = "https://www.dlsite.com/girls/ranking/day";

export const dlsiteFemaleDoujinAdapter: SourceAdapter = {
  key: "dlsite_female_doujin",
  target,

  async fetchRankingWorkIds() {
    // TODO: 実装時はログイン不要の公開ランキングページのみ対象にする。
    // TODO: CAPTCHA回避は禁止。429/403が返ったら即停止し、BlockedAccessErrorを投げる。
    // TODO: DLsiteへのアクセスは低頻度にし、画面表示時には絶対に直接アクセスしない。
    const products = buildDummyProducts();
    return {
      sourceProductIds: products.map((product) => product.sourceProductId),
      sourceUrl,
    };
  },

  async fetchProductDetail(sourceProductId: string): Promise<RawProductDetail> {
    // TODO: 実装時は公開商品ページ/APIだけを対象にする。
    // TODO: 画像ファイルはダウンロードせず、URLのみ保存する。
    // TODO: 商品説明文は長文を保存しすぎず、必要最低限にする。
    const product = buildDummyProducts().find((item) => item.sourceProductId === sourceProductId);
    if (!product) {
      throw new Error(`dummy product not found: ${sourceProductId}`);
    }

    return {
      sourceProductId: product.sourceProductId,
      title: product.title,
      sellerId: product.seller?.sellerId,
      sellerName: product.seller?.sellerName,
      sellerType: product.seller?.sellerType,
      priceCurrent: product.priceCurrent,
      priceOriginal: product.priceOriginal,
      discountRate: product.discountRate,
      salesCount: product.salesCount,
      wishlistCount: product.wishlistCount,
      rating: product.rating,
      ratingAverage: product.ratingAverage,
      reviewCount: product.reviewCount,
      releaseDate: product.releaseDate,
      ageRating: product.ageRating,
      workType: product.workType,
      thumbnailUrl: product.thumbnailUrl,
      mainImageUrl: product.mainImageUrl,
      images: product.images,
      sourceUrl: product.sourceUrl,
      affiliateUrl: product.affiliateUrl,
      description: product.description,
      genres: product.genres,
      tags: product.tags,
      genreIds: product.genreIds,
      tagIds: product.tagIds,
    };
  },

  normalizeProduct,

  buildSourceUrl(sourceProductId: string) {
    return `https://www.dlsite.com/girls/work/=/product_id/${sourceProductId}.html`;
  },

  buildAffiliateUrl(url: string) {
    return `${url}${url.includes("?") ? "&" : "?"}utm_source=mvp_affiliate_placeholder`;
  },
};
