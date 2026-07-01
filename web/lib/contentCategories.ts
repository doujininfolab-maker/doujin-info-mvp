import type { ProductContentType } from "./types";

export type ProductContentScope = ProductContentType | "all";

export const CONTENT_SCOPE_OPTIONS: Array<{ label: string; value: ProductContentScope }> = [
  { label: "すべて", value: "all" },
  { label: "TL", value: "tl" },
  { label: "BL", value: "bl" },
];

export const CONTENT_TYPE_OPTIONS: Array<{ label: string; value: ProductContentType }> = [
  { label: "TL", value: "tl" },
  { label: "BL", value: "bl" },
];

const validContentTypeValues = new Set(CONTENT_TYPE_OPTIONS.map((option) => option.value));
const validContentScopeValues = new Set(CONTENT_SCOPE_OPTIONS.map((option) => option.value));

export function parseContentScope(value: string | string[] | undefined): ProductContentScope {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "tl";
  const normalized = raw.toLowerCase();
  return validContentScopeValues.has(normalized as ProductContentScope) ? (normalized as ProductContentScope) : "tl";
}

export function contentTypeForFilter(scope: ProductContentScope): ProductContentType | undefined {
  return scope === "all" ? undefined : scope;
}

export function contentTypeParamForScope(scope: ProductContentScope): string | undefined {
  // TLをデフォルトにするため、TLはURLに出さない。全て/BLのみクエリで保持する。
  return scope === "tl" ? undefined : scope;
}

export function parseContentType(value: string | string[] | undefined): ProductContentType | undefined {
  return contentTypeForFilter(parseContentScope(value));
}

export function getContentTypeLabel(value?: ProductContentType): string {
  return CONTENT_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "";
}

export function getContentScopeLabel(value: ProductContentScope): string {
  return CONTENT_SCOPE_OPTIONS.find((option) => option.value === value)?.label ?? "TL";
}
