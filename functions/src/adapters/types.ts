import type { FetchTarget, Product, RawProductDetail } from "../types";

export type RankingFetchResult = {
  sourceProductIds: string[];
  sourceUrl?: string;
};

export type SourceAdapter = {
  key: string;
  target: FetchTarget;

  fetchRankingWorkIds: (target: FetchTarget) => Promise<RankingFetchResult>;
  fetchProductDetail: (sourceProductId: string) => Promise<RawProductDetail>;
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
