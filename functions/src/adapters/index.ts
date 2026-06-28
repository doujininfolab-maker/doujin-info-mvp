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

export function getEnabledFetchTargets(): FetchTarget[] {
  return [
    {
      platform: "dlsite",
      audience: "female",
      category: "doujin",
      rankingType: "daily",
    },
  ];
}
