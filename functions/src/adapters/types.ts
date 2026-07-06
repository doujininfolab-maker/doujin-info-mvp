import type { FetchTarget, Product, RawProductDetail } from "../types";

export type RankingFetchOptions = {
  listLimit?: number;
};

export type ProductParseMode = "full" | "fast";

export type ProductDetailParseTiming = {
  htmlOnlyProbeMs?: number;
  htmlProbeExecuted?: number;
  htmlProbePriceCurrentFound?: number;
  htmlProbePriceOriginalFound?: number;
  htmlProbeDiscountRateFound?: number;
  htmlProbeSalesCountFound?: number;
  htmlProbeRatingFound?: number;
  htmlProbeReviewCountFound?: number;
  htmlProbeReleaseDateFound?: number;
  htmlProbeSalesCountAjaxCompared?: number;
  htmlProbeSalesCountAjaxMatch?: number;
  htmlProbeSalesCountAjaxMismatch?: number;
  htmlProbeSalesCountAjaxHtmlMissing?: number;
  htmlProbeSalesCountAjaxAjaxMissing?: number;
  htmlProbeSalesCountAjaxBothMissing?: number;
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

export type HtmlSalesCountAjaxComparisonStatus =
  | "match"
  | "mismatch"
  | "html_missing"
  | "ajax_missing"
  | "both_missing";

export type HtmlSalesCountAjaxComparison = {
  status: HtmlSalesCountAjaxComparisonStatus;
  htmlSalesCount?: number;
  ajaxSalesCount?: number;
};

export type ProductDetailTiming = {
  /** 商品詳細HTML候補の取得にかかった時間。BL/TL補完アクセスがある場合はその合計を含む。 */
  fetchHtmlMs?: number;
  /** 取得済みHTMLからProductへ正規化可能なRawProductDetailを作るまでの時間。Ajax取得時間は含めない。 */
  parseHtmlMs?: number;
  /** 互換調査用。extractProductDetail全体の時間。Ajax取得時間を含む。 */
  parseHtmlTotalMs?: number;
  /** 最終的に採用した商品詳細URL。 */
  selectedUrl?: string;
  /** 採用HTMLの文字数。 */
  htmlLength?: number;
  /** 商品詳細HTMLのHTTPリクエスト試行回数。retryや候補URL取得を含む。 */
  detailHtmlRequestCount?: number;
  /** 商品詳細HTML取得のretry回数。 */
  detailHtmlRetryCount?: number;
  /** 商品詳細HTML取得retryのbackoff待機時間。 */
  detailHtmlRetryBackoffMs?: number;
  /** 商品詳細HTML候補URL数。canonical/BL補完などで増えた候補を含む。 */
  detailHtmlCandidateUrlCount?: number;
  /** 取得に失敗した商品詳細HTML候補URL数。 */
  detailHtmlCandidateFetchFailedCount?: number;
  /** 商品詳細HTML取得時のHTTP status別件数。 */
  detailHtmlStatusCounts?: Record<string, number>;
  /** 採用HTMLから抽出できた商品画像数。 */
  selectedImageCount?: number;
  /** AjaxのHTTPリクエスト試行回数。 */
  ajaxRequestCount?: number;
  /** Ajaxの成功回数。 */
  ajaxSuccessCount?: number;
  /** Ajaxの非2xx応答回数。 */
  ajaxNonOkCount?: number;
  /** Ajaxのfetch/JSON parse例外回数。 */
  ajaxErrorCount?: number;
  /** Ajaxで2つ目のURL形式 product_id[] を試した回数。 */
  ajaxSecondUrlTriedCount?: number;
  /** Ajaxで1つ目のURL形式 product_id が成功した回数。 */
  ajaxFirstUrlSucceededCount?: number;
  /** Ajax取得時のHTTP status別件数。 */
  ajaxStatusCounts?: Record<string, number>;
  /** 取得済みHTMLをRawProductDetailへ変換する内部処理時間の内訳。 */
  parse?: ProductDetailParseTiming;
  /** 検証専用。HTML販売数とAjax販売数を比較した結果。保存結果には影響しない。 */
  htmlSalesCountAjaxComparison?: HtmlSalesCountAjaxComparison;
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
  /**
   * 検証専用。Ajax結果は引き続き使いつつ、詳細HTMLだけで主要項目が取れるかを計測する。
   * 保存結果を変えないため、既存挙動には影響させない。
   */
  htmlOnlyProbe?: boolean;
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
