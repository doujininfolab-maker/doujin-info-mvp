import type { SourceAdapter } from "../types";
import { normalizeProduct } from "../../normalizers/normalizeProduct";

// FANZA系は横展開用の差し込み口だけ用意する。
// 実装時はDMM/FANZAの規約・API利用条件・アフィリエイト仕様に合わせて個別Adapterを作る。
export const fanzaAdapters: SourceAdapter[] = [
  {
    key: "fanza_adult_video",
    target: { platform: "fanza", audience: "adult", category: "video", rankingType: "daily" },
    async fetchRankingWorkIds() {
      return { sourceProductIds: [] };
    },
    async fetchProductDetail() {
      throw new Error("fanza_adult_video adapter is not implemented yet");
    },
    normalizeProduct,
    buildSourceUrl(sourceProductId: string) {
      return `https://www.dmm.co.jp/digital/videoa/-/detail/=/cid=${sourceProductId}/`;
    },
    buildAffiliateUrl(url: string) {
      return url;
    },
  },
  {
    key: "fanza_adult_ebook",
    target: { platform: "fanza", audience: "adult", category: "ebook", rankingType: "daily" },
    async fetchRankingWorkIds() {
      return { sourceProductIds: [] };
    },
    async fetchProductDetail() {
      throw new Error("fanza_adult_ebook adapter is not implemented yet");
    },
    normalizeProduct,
    buildSourceUrl(sourceProductId: string) {
      return `https://book.dmm.co.jp/product/${sourceProductId}/`;
    },
    buildAffiliateUrl(url: string) {
      return url;
    },
  },
  {
    key: "fanza_adult_doujin",
    target: { platform: "fanza", audience: "adult", category: "doujin", rankingType: "daily" },
    async fetchRankingWorkIds() {
      return { sourceProductIds: [] };
    },
    async fetchProductDetail() {
      throw new Error("fanza_adult_doujin adapter is not implemented yet");
    },
    normalizeProduct,
    buildSourceUrl(sourceProductId: string) {
      return `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${sourceProductId}/`;
    },
    buildAffiliateUrl(url: string) {
      return url;
    },
  },
];
