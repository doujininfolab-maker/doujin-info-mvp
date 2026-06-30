export type PageSize = 30 | 50 | 100 | 200;

export function parsePageSize(value: string | string[] | undefined): PageSize {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 30);

  if (parsed === 50 || parsed === 100 || parsed === 200) return parsed;
  return 30;
}

export function parsePageNumber(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw ?? 1);

  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.floor(parsed);
}
