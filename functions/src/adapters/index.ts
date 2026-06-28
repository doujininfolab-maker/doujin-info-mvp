import type { FetchTarget } from "../types";
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

const supportedDlsiteRankingTypes = ["daily", "new", "sale"] as const;
type SupportedDlsiteRankingType = (typeof supportedDlsiteRankingTypes)[number];

function parseDlsiteRankingTypes(value: string | undefined): SupportedDlsiteRankingType[] {
  const raw = value?.trim();
  if (!raw) return ["daily"];

  const requested = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (requested.includes("all")) {
    return [...supportedDlsiteRankingTypes];
  }

  const valid = requested.filter((item): item is SupportedDlsiteRankingType =>
    supportedDlsiteRankingTypes.includes(item as SupportedDlsiteRankingType),
  );

  return valid.length > 0 ? [...new Set(valid)] : ["daily"];
}

export function getEnabledFetchTargets(rankingTypesValue = process.env.DLSITE_RANKING_TYPES): FetchTarget[] {
  const rankingTypes = parseDlsiteRankingTypes(rankingTypesValue);

  return rankingTypes.map((rankingType) => ({
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    rankingType,
  }));
}
