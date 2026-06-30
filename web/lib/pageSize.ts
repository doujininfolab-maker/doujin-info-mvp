export type PageSize = 30 | 50 | 100;

export function parsePageSize(value: string | string[] | undefined): PageSize {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 30);

  if (parsed === 50 || parsed === 100) return parsed;
  return 30;
}
