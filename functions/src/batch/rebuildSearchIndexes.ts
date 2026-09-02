import type { Timestamp } from "firebase-admin/firestore";
import type { FetchTarget, Product } from "../types";
import {
  rebuildCompactSearchIndex,
  type RebuildCompactSearchIndexResult,
} from "./rebuildCompactSearchIndex";
import {
  rebuildSearchIndex,
  type RebuildSearchIndexResult,
} from "./rebuildSearchIndex";

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

export type SearchIndexWriteMode = "legacy" | "dual" | "compact";

export type RebuildSearchIndexesResult = {
  writeMode: SearchIndexWriteMode;
  legacy?: RebuildSearchIndexResult;
  compact?: RebuildCompactSearchIndexResult;
};

export function getSearchIndexWriteMode(): SearchIndexWriteMode {
  const value = process.env.SEARCH_INDEX_WRITE_MODE?.trim().toLowerCase();
  if (value === "dual" || value === "compact") return value;
  return "legacy";
}

/**
 * Builds the configured search representations sequentially. Sequential work
 * keeps peak memory below a Promise.all dual-build while the default legacy
 * mode preserves the deployed behavior until the rollout flag is changed.
 */
export async function rebuildSearchIndexes(
  segment: SiteSegmentKey,
  products: Product[],
  generatedAt: Timestamp,
): Promise<RebuildSearchIndexesResult> {
  const writeMode = getSearchIndexWriteMode();
  const result: RebuildSearchIndexesResult = { writeMode };

  if (writeMode !== "compact") {
    result.legacy = await rebuildSearchIndex(segment, products, generatedAt);
  }
  if (writeMode !== "legacy") {
    result.compact = await rebuildCompactSearchIndex(
      segment,
      products,
      generatedAt,
    );
  }

  return result;
}
