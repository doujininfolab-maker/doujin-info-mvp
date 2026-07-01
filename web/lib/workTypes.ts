import type { ProductWorkType } from "./types";

export const WORK_TYPE_OPTIONS: Array<{ label: string; value: ProductWorkType | "all" }> = [
  { label: "全て", value: "all" },
  { label: "マンガ", value: "comic" },
  { label: "CG", value: "cg" },
  { label: "動画", value: "movie" },
  { label: "ゲーム", value: "game" },
  { label: "音声", value: "voice" },
  { label: "その他", value: "other" },
];

const validWorkTypeValues = new Set(WORK_TYPE_OPTIONS.map((option) => option.value));

export function parseWorkType(value: string | string[] | undefined): ProductWorkType | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw === "all") return undefined;
  return validWorkTypeValues.has(raw as ProductWorkType) ? (raw as ProductWorkType) : undefined;
}

export function getWorkTypeLabel(value?: ProductWorkType): string {
  return WORK_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "全て";
}

export function buildFilterHref(
  basePath: string,
  current: Record<string, string | undefined>,
  next: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries({ ...current, ...next })) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

export function buildWorkTypeHref(
  basePath: string,
  current: Record<string, string | undefined>,
  workType: ProductWorkType | "all",
  paramName = "workType",
): string {
  return buildFilterHref(basePath, current, { [paramName]: workType === "all" ? undefined : workType });
}
