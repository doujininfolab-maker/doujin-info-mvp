import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  Product,
  ProductCardItem,
  SaleListViewBlockDescriptor,
  SaleListViewCompressedBlockDocument,
  SaleListViewThreshold,
  SaleListViewThresholdCounts,
  SaleSortMode,
} from "../../types";
import {
  NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES,
  NEW_LIST_VIEW_CONTENT_SCOPES,
  NEW_LIST_VIEW_MAX_ITEMS_PER_BLOCK,
  NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES,
  NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES,
  NEW_LIST_VIEW_WORK_TYPES,
  listViewProductHasScope,
  listViewProductMatchesWorkType,
  removeUndefinedDeep,
  toProductCardItem,
  type NewListViewContentScope,
  type NewListViewSourceProduct,
  type NewListViewWorkType,
} from "./newListViewShared";

export const SALE_LIST_VIEW_SCHEMA_VERSION = 1;
export const SALE_LIST_VIEW_ENCODING = "gzip-json-v1" as const;
export const SALE_LIST_VIEW_CONTENT_SCOPES = NEW_LIST_VIEW_CONTENT_SCOPES;
export const SALE_LIST_VIEW_WORK_TYPES = NEW_LIST_VIEW_WORK_TYPES;
export const SALE_LIST_VIEW_THRESHOLDS = [0, 30, 50, 70, 90] as const;
export const SALE_LIST_VIEW_SORT_MODES: SaleSortMode[] = [
  "discountRate",
  "discountAmount",
  "newest",
];

export type SaleListViewContentScope = NewListViewContentScope;
export type SaleListViewWorkType = NewListViewWorkType;
export type SaleListViewSourceProduct = NewListViewSourceProduct;

export {
  listViewProductHasScope as saleListViewProductHasScope,
  listViewProductMatchesWorkType as saleListViewProductMatchesWorkType,
  removeUndefinedDeep,
  toProductCardItem,
};

export function isSaleListProduct(product: Product): boolean {
  return Boolean(
    product.isDiscounted ||
      product.isOnSale ||
      (product.discountRate ?? 0) > 0,
  );
}

function discountAmount(product: Product): number {
  return typeof product.priceOriginal === "number" &&
    typeof product.priceCurrent === "number"
    ? Math.max(0, product.priceOriginal - product.priceCurrent)
    : 0;
}

function compareReleaseDateOnlyDesc(
  left: Pick<Product, "releaseDate">,
  right: Pick<Product, "releaseDate">,
): number {
  return (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "");
}

function compareReleaseDateDesc(
  left: Pick<Product, "releaseDate" | "productId">,
  right: Pick<Product, "releaseDate" | "productId">,
): number {
  return (
    compareReleaseDateOnlyDesc(left, right) ||
    left.productId.localeCompare(right.productId)
  );
}

export function compareSaleListProducts(
  sortMode: SaleSortMode,
): (left: SaleListViewSourceProduct, right: SaleListViewSourceProduct) => number {
  if (sortMode === "discountAmount") {
    return (left, right) =>
      discountAmount(right) - discountAmount(left) ||
      (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
      compareReleaseDateDesc(left, right);
  }
  if (sortMode === "newest") {
    return (left, right) =>
      compareReleaseDateOnlyDesc(left, right) ||
      (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
      left.productId.localeCompare(right.productId);
  }
  return (left, right) =>
    (right.discountRate ?? 0) - (left.discountRate ?? 0) ||
    discountAmount(right) - discountAmount(left) ||
    compareReleaseDateDesc(left, right);
}

export function buildSaleListViewThresholdCounts(
  sortedByDiscountRate: SaleListViewSourceProduct[],
): SaleListViewThresholdCounts {
  return {
    0: sortedByDiscountRate.length,
    30: sortedByDiscountRate.filter(
      (product) => (product.discountRate ?? 0) >= 30,
    ).length,
    50: sortedByDiscountRate.filter(
      (product) => (product.discountRate ?? 0) >= 50,
    ).length,
    70: sortedByDiscountRate.filter(
      (product) => (product.discountRate ?? 0) >= 70,
    ).length,
    90: sortedByDiscountRate.filter(
      (product) => (product.discountRate ?? 0) >= 90,
    ).length,
  };
}

export function buildSaleListViewListId(
  contentScope: SaleListViewContentScope,
  workType: SaleListViewWorkType,
  sortMode: SaleSortMode,
  threshold: SaleListViewThreshold,
): string {
  return sortMode === "discountRate"
    ? `${contentScope}_${workType}_discountRate_all`
    : `${contentScope}_${workType}_${sortMode}_${threshold}`;
}

export function sha256SaleListView(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializeItems(items: ProductCardItem[]): {
  json: Buffer;
  compressed: Buffer;
} {
  const json = Buffer.from(JSON.stringify(items), "utf8");
  if (json.length > NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Sale-list block uncompressed payload exceeds the safety limit: ${json.length}`,
    );
  }
  return { json, compressed: gzipSync(json, { level: 6 }) };
}

export type BuiltSaleListViewBlock = {
  descriptor: SaleListViewBlockDescriptor;
  document: SaleListViewCompressedBlockDocument;
};

function buildBlock(
  listId: string,
  versionId: string,
  blockIndex: number,
  startOffset: number,
  items: ProductCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltSaleListViewBlock {
  const { json, compressed } = serializeItems(items);
  if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
    throw new Error(
      `Sale-list block compressed payload exceeds the absolute limit: list=${listId}, block=${blockIndex}, bytes=${compressed.length}`,
    );
  }
  const blockId = String(blockIndex).padStart(6, "0");
  const checksum = sha256SaleListView(compressed);
  const descriptor: SaleListViewBlockDescriptor = {
    blockId,
    blockIndex,
    startOffset,
    itemCount: items.length,
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    checksum,
  };
  return {
    descriptor,
    document: {
      schemaVersion: SALE_LIST_VIEW_SCHEMA_VERSION,
      encoding: SALE_LIST_VIEW_ENCODING,
      listId,
      versionId,
      blockId,
      blockIndex,
      startOffset,
      itemCount: items.length,
      compressedBytes: compressed.length,
      uncompressedBytes: json.length,
      checksum,
      payload: compressed,
      generatedAt,
    },
  };
}

function splitChunkByCompressedSize(
  items: ProductCardItem[],
): ProductCardItem[][] {
  const { compressed } = serializeItems(items);
  if (
    compressed.length <= NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES ||
    items.length <= 1
  ) {
    if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
      throw new Error(
        `A single sale-list item exceeds the compressed document limit: ${compressed.length}`,
      );
    }
    return [items];
  }
  const midpoint = Math.ceil(items.length / 2);
  return [
    ...splitChunkByCompressedSize(items.slice(0, midpoint)),
    ...splitChunkByCompressedSize(items.slice(midpoint)),
  ];
}

export function buildCompressedSaleListBlocks(
  listId: string,
  versionId: string,
  items: ProductCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltSaleListViewBlock[] {
  const chunks: ProductCardItem[][] = [];
  for (
    let offset = 0;
    offset < items.length;
    offset += NEW_LIST_VIEW_MAX_ITEMS_PER_BLOCK
  ) {
    chunks.push(
      ...splitChunkByCompressedSize(
        items.slice(offset, offset + NEW_LIST_VIEW_MAX_ITEMS_PER_BLOCK),
      ),
    );
  }

  let startOffset = 0;
  return chunks.map((chunk, blockIndex) => {
    const block = buildBlock(
      listId,
      versionId,
      blockIndex,
      startOffset,
      chunk,
      generatedAt,
    );
    startOffset += chunk.length;
    return block;
  });
}

export function buildSaleListChecksum(
  items: ProductCardItem[],
  blocks: BuiltSaleListViewBlock[],
): string {
  return sha256SaleListView(
    JSON.stringify({
      productIds: items.map((item) => item.productId),
      blocks: blocks.map((block) => block.descriptor.checksum),
    }),
  );
}
