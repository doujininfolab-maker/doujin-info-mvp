export type SearchIndexReadMode = "legacy" | "compact";

export function getSearchIndexReadMode(
  value = process.env.SEARCH_INDEX_READ_MODE,
): SearchIndexReadMode {
  return value?.trim().toLowerCase() === "compact" ? "compact" : "legacy";
}
