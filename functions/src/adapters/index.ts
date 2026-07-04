import type { FetchTarget, ProductContentType, RankingType } from "../types";
import type { SourceAdapter } from "./types";
import { dlsiteFemaleDoujinAdapter } from "./dlsite/dlsiteFemaleDoujinAdapter";
import { fanzaAdapters } from "./fanza/fanzaDummyAdapters";

export const adapters: SourceAdapter[] = [dlsiteFemaleDoujinAdapter, ...fanzaAdapters];

export function getAdapterForTarget(target: FetchTarget): SourceAdapter | undefined {
  return adapters.find(
    (adapter) =>
      adapter.target.platform === target.platform &&
      adapter.target.audience === target.audience &&
      adapter.target.category === target.category,
  );
}

const DLSITE_FEMALE_DOUJIN_RANKING_TYPES: RankingType[] = ["daily", "weekly", "monthly"];
const DLSITE_FEMALE_DOUJIN_CONTENT_TYPES: ProductContentType[] = ["tl", "bl"];

export function getEnabledFetchTargets(): FetchTarget[] {
  // TL/BLを取得元から分けておくことで、画面側のTL/BLフィルターだけに依存せず、
  // Firestore保存時点で contentTypeIds を安定して持てるようにする。
  return DLSITE_FEMALE_DOUJIN_CONTENT_TYPES.flatMap((contentType) =>
    DLSITE_FEMALE_DOUJIN_RANKING_TYPES.map((rankingType) => ({
      platform: "dlsite" as const,
      audience: "female" as const,
      category: "doujin" as const,
      rankingType,
      contentType,
    })),
  );
}
