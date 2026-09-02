import { createHash } from "node:crypto";
import type { ProductListFilter, SellerStatsDocument } from "../types";

export type SellerDetailReadMode = "legacy" | "stats";

export function getSellerDetailReadMode(
  value = process.env.SELLER_DETAIL_READ_MODE,
): SellerDetailReadMode {
  return value?.trim().toLowerCase() === "stats" ? "stats" : "legacy";
}

export function buildSellerStatsScopeId(filter: ProductListFilter): string {
  const baseId = `${filter.platform}_${filter.audience}_${filter.category}`;
  return filter.contentType ? `${baseId}_${filter.contentType}` : baseId;
}

export function buildSellerStatsDocumentId(statId: string, sellerKey: string): string {
  const sellerHash = createHash("sha256")
    .update(sellerKey)
    .digest("hex")
    .slice(0, 32);
  return `${statId}_${sellerHash}`;
}

export function matchesSellerStatsDocument(
  data: Partial<SellerStatsDocument>,
  filter: ProductListFilter,
  decodedSellerKey: string,
): data is SellerStatsDocument {
  const statId = buildSellerStatsScopeId(filter);
  const contentScope = filter.contentType ?? "all";

  return data.isActive !== false &&
    data.statId === statId &&
    data.platform === filter.platform &&
    data.audience === filter.audience &&
    data.category === filter.category &&
    data.contentScope === contentScope &&
    typeof data.sellerKey === "string" &&
    typeof data.sellerName === "string" &&
    typeof data.productCount === "number" &&
    typeof data.totalSalesCount === "number" &&
    typeof data.averageSalesCount === "number" &&
    typeof data.estimatedRevenue === "number" &&
    Array.isArray(data.tags) &&
    (data.sellerKey === decodedSellerKey ||
      data.sellerId === decodedSellerKey ||
      data.sellerName === decodedSellerKey);
}
