import type { FetchTarget, Product, RawProductDetail } from "../types";

export type RankingFetchOptions = {
  listLimit?: number;
};

export type ProductDetailFetchOptions = {
  /**
   * 一覧ページで実際に取得した商品詳細URL。
   * これを優先することで、TL/BL/floor推測による余計なアクセスを減らす。
   */
  sourceUrl?: string;
};

export type DiscoveredProductSource = {
  sourceProductId: string;
  sourceUrl?: string;
  rank?: number;
  listUrl?: string;
};

export type RankingFetchResult = {
  sourceProductIds: string[];
  sourceUrl?: string;
  products?: DiscoveredProductSource[];
};

export type SourceAdapter = {
  key: string;
  target: FetchTarget;

  fetchRankingWorkIds: (target: FetchTarget, options?: RankingFetchOptions) => Promise<RankingFetchResult>;
  fetchProductDetail: (sourceProductId: string, options?: ProductDetailFetchOptions) => Promise<RawProductDetail>;
  normalizeProduct: (raw: RawProductDetail, target: FetchTarget) => Product;
  buildSourceUrl: (sourceProductId: string) => string;
  buildAffiliateUrl: (sourceUrl: string) => string;
};

export class BlockedAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedAccessError";
  }
}
