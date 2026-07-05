import type { FetchTarget, Product, RawProductDetail } from "../types";

export type RankingFetchOptions = {
  listLimit?: number;
};

export type ProductParseMode = "full" | "fast";

export type ProductDetailParseTiming = {
  cheerioLoadMs?: number;
  parseBasicInfoMs?: number;
  parsePriceMs?: number;
  parseSalesMs?: number;
  parseRatingMs?: number;
  parseReleaseDateMs?: number;
  parseGenresMs?: number;
  parseImagesMs?: number;
  parseDescriptionMs?: number;
  normalizeProductMs?: number;
  otherParseMs?: number;
  ajaxInfoFetchMs?: number;
};

export type ProductDetailTiming = {
  /** 商品詳細HTML候補の取得にかかった時間。BL/TL補完アクセスがある場合はその合計を含む。 */
  fetchHtmlMs?: number;
  /** 取得済みHTMLからProductへ正規化可能なRawProductDetailを作るまでの時間。 */
  parseHtmlMs?: number;
  /** 最終的に採用した商品詳細URL。 */
  selectedUrl?: string;
  /** 採用HTMLの文字数。 */
  htmlLength?: number;
  /** 取得済みHTMLをRawProductDetailへ変換する内部処理時間の内訳。 */
  parse?: ProductDetailParseTiming;
};

export type ProductDetailFetchOptions = {
  /**
   * 一覧ページで実際に取得した商品詳細URL。
   * これを優先することで、TL/BL/floor推測による余計なアクセスを減らす。
   */
  sourceUrl?: string;
  /**
   * バッチ性能計測用の任意コールバック。通常の画面処理・既存処理には影響させない。
   */
  onTiming?: (timing: ProductDetailTiming) => void;
  /**
   * full: 既存互換。詳細な補完取得・評価内訳解析まで行う。
   * fast: 初回全量取得向け。必須項目を優先し、重い評価内訳補完を省く。
   */
  parseMode?: ProductParseMode;
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
