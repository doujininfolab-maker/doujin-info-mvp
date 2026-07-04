const SEARCH_SEPARATOR_PATTERN = /[\s　/_\-‐‑‒–—―・,，.．。:：;；!！?？()[\]（）【】「」『』〈〉《》<>+＋=＝~〜～|｜]+/g;

export function normalizeSearchText(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\s　]+/g, " ")
    .trim();
}

export function compactSearchText(value: string | undefined): string {
  return normalizeSearchText(value).replace(SEARCH_SEPARATOR_PATTERN, "").trim();
}

export function splitSearchTerms(value: string | undefined): string[] {
  return normalizeSearchText(value)
    .split(SEARCH_SEPARATOR_PATTERN)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function pickPrimarySearchToken(keyword: string): string | undefined {
  const normalized = normalizeSearchText(keyword);
  if (!normalized) return undefined;

  const compacted = compactSearchText(normalized);
  const terms = splitSearchTerms(normalized).sort((a, b) => b.length - a.length);

  if (compacted && compacted.length <= 80) return compacted;
  return terms[0] ?? normalized;
}
