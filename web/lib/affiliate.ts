import type { Product } from "@/lib/types";

type DlsiteSection = "girls" | "bl";

const DEFAULT_DLSITE_AFFILIATE_ID = "doujininfolab";
const DLSITE_PRODUCT_ID_PATTERN = /^[A-Z]{1,4}\d+$/;

function normalizeContentType(value: string | undefined): "tl" | "bl" | undefined {
  const normalized = value?.replace(/^dlsite:/i, "").trim().toLowerCase();
  if (!normalized) return undefined;

  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(normalized)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(normalized)) return "bl";
  return undefined;
}

function getDlsiteSectionFromSourceUrl(sourceUrl: string | undefined): DlsiteSection | undefined {
  if (!sourceUrl) return undefined;

  try {
    const pathname = new URL(sourceUrl).pathname.toLowerCase();
    if (pathname === "/girls" || pathname.startsWith("/girls/")) return "girls";
    if (pathname === "/bl" || pathname.startsWith("/bl/")) return "bl";
  } catch {
    const normalized = sourceUrl.toLowerCase();
    if (normalized.includes("dlsite.com/girls/") || normalized.includes("dlaf.jp/girls/")) return "girls";
    if (normalized.includes("dlsite.com/bl/") || normalized.includes("dlaf.jp/bl/")) return "bl";
  }

  return undefined;
}

function getDlsiteSectionFromContentTypes(product: Product): DlsiteSection | undefined {
  const contentTypes = [
    ...(product.contentTypeIds ?? []),
    ...(product.contentTypes ?? []),
  ]
    .map((value) => normalizeContentType(value))
    .filter((value): value is "tl" | "bl" => Boolean(value));

  const hasTl = contentTypes.includes("tl");
  const hasBl = contentTypes.includes("bl");
  if (hasTl === hasBl) return undefined;
  return hasBl ? "bl" : "girls";
}

function normalizeDlsiteProductId(product: Product): string | undefined {
  const directId = product.sourceProductId?.trim().toUpperCase();
  if (directId && DLSITE_PRODUCT_ID_PATTERN.test(directId)) return directId;

  const sourceUrlMatch = product.sourceUrl?.match(/(?:product_id|id)\/([a-z]{1,4}\d+)\.html/i);
  const sourceUrlId = sourceUrlMatch?.[1]?.toUpperCase();
  return sourceUrlId && DLSITE_PRODUCT_ID_PATTERN.test(sourceUrlId) ? sourceUrlId : undefined;
}

function getDlsiteAffiliateId(): string {
  const configuredId = process.env.DLSITE_AFFILIATE_ID?.trim();
  return configuredId && /^[A-Za-z0-9_-]+$/.test(configuredId)
    ? configuredId
    : DEFAULT_DLSITE_AFFILIATE_ID;
}

export function buildDlsiteAffiliateUrl(product: Product): string | undefined {
  if (product.platform !== "dlsite" && product.affiliateProvider !== "dlsite") return undefined;

  const section = getDlsiteSectionFromSourceUrl(product.sourceUrl) ?? getDlsiteSectionFromContentTypes(product);
  const productId = normalizeDlsiteProductId(product);
  if (!section || !productId) return undefined;

  const affiliateId = getDlsiteAffiliateId();
  return `https://dlaf.jp/${section}/dlaf/=/t/n/link/work/aid/${encodeURIComponent(affiliateId)}/id/${encodeURIComponent(productId)}.html`;
}

export function getProductOutboundUrl(product: Product): string {
  if (product.platform === "dlsite" || product.affiliateProvider === "dlsite") {
    return buildDlsiteAffiliateUrl(product) || product.affiliateUrl || product.sourceUrl;
  }

  return product.affiliateUrl || product.sourceUrl;
}
