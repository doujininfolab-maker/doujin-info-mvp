export const SEARCH_TARGET_OPTIONS = [
  { value: "all", label: "全て" },
  { value: "title", label: "作品名" },
  { value: "seller", label: "サークル名" },
  { value: "genre", label: "ジャンル" },
] as const;

export type SearchTarget = (typeof SEARCH_TARGET_OPTIONS)[number]["value"];

export function parseSearchTarget(value: string | string[] | undefined): SearchTarget {
  const raw = Array.isArray(value) ? value[0] : value;
  return SEARCH_TARGET_OPTIONS.some((option) => option.value === raw) ? (raw as SearchTarget) : "all";
}

export function searchTargetParamForScope(searchTarget: SearchTarget): string | undefined {
  return searchTarget === "all" ? undefined : searchTarget;
}

export function getSearchTargetLabel(searchTarget: SearchTarget): string {
  return SEARCH_TARGET_OPTIONS.find((option) => option.value === searchTarget)?.label ?? "全て";
}
