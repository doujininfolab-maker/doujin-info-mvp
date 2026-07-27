import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  SellerCardItem,
  SellerIndexItem,
  SellerListViewBlockDescriptor,
  SellerListViewCompressedBlockDocument,
  SellerSortMode,
} from "../../types";
import {
  NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES,
  NEW_LIST_VIEW_MAX_ITEMS_PER_BLOCK,
  NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES,
  NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES,
  removeUndefinedDeep,
} from "./newListViewShared";

export const SELLER_LIST_VIEW_SCHEMA_VERSION = 1;
export const SELLER_LIST_VIEW_ENCODING = "gzip-json-v1" as const;
export const SELLER_LIST_VIEW_CONTENT_SCOPES = ["all", "tl", "bl"] as const;
export const SELLER_LIST_VIEW_SORT_MODES: SellerSortMode[] = [
  "totalSales",
  "estimatedRevenue",
  "productCount",
  "latestRelease",
  "sellerName",
];

export type SellerListViewContentScope =
  (typeof SELLER_LIST_VIEW_CONTENT_SCOPES)[number];

function cardImageUrl(item: SellerIndexItem): string {
  return (
    item.topProduct?.mainImageUrl ||
    item.topProduct?.images?.[0]?.url ||
    item.topProduct?.thumbnailUrl ||
    item.latestProduct?.mainImageUrl ||
    item.latestProduct?.thumbnailUrl ||
    "/no-image.svg"
  );
}

export function toSellerCardItem(item: SellerIndexItem): SellerCardItem {
  return removeUndefinedDeep({
    sellerKey: item.sellerKey,
    sellerId: item.sellerId,
    sellerName: item.sellerName,
    sellerUrl: item.sellerUrl,
    sellerType: item.sellerType,
    platform: item.platform,
    audience: item.audience,
    category: item.category,
    productCount: item.productCount,
    totalSalesCount: item.totalSalesCount,
    averageSalesCount: item.averageSalesCount,
    estimatedRevenue: item.estimatedRevenue,
    averagePrice: item.averagePrice,
    firstReleaseDate: item.firstReleaseDate,
    latestReleaseDate: item.latestReleaseDate,
    newestProductTitle: item.newestProductTitle,
    cardImageUrl: cardImageUrl(item),
    tags: (item.tags ?? []).slice(0, 8),
  } satisfies SellerCardItem);
}

export function compareSellerCardItems(
  sortMode: SellerSortMode,
): (left: SellerCardItem, right: SellerCardItem) => number {
  if (sortMode === "estimatedRevenue") {
    return (left, right) =>
      right.estimatedRevenue - left.estimatedRevenue ||
      right.totalSalesCount - left.totalSalesCount ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "productCount") {
    return (left, right) =>
      right.productCount - left.productCount ||
      right.totalSalesCount - left.totalSalesCount ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "latestRelease") {
    return (left, right) =>
      (right.latestReleaseDate ?? "").localeCompare(
        left.latestReleaseDate ?? "",
      ) ||
      right.totalSalesCount - left.totalSalesCount ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  if (sortMode === "sellerName") {
    return (left, right) =>
      left.sellerName.localeCompare(right.sellerName, "ja") ||
      left.sellerKey.localeCompare(right.sellerKey);
  }
  return (left, right) =>
    right.totalSalesCount - left.totalSalesCount ||
    right.productCount - left.productCount ||
    left.sellerKey.localeCompare(right.sellerKey);
}

export function buildSellerListViewListId(
  contentScope: SellerListViewContentScope,
  sortMode: SellerSortMode,
): string {
  return `${contentScope}_${sortMode}`;
}

export function sha256SellerListView(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializeItems(items: SellerCardItem[]): {
  json: Buffer;
  compressed: Buffer;
} {
  const json = Buffer.from(JSON.stringify(items), "utf8");
  if (json.length > NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Seller-list block uncompressed payload exceeds the safety limit: ${json.length}`,
    );
  }
  return { json, compressed: gzipSync(json, { level: 6 }) };
}

export type BuiltSellerListViewBlock = {
  descriptor: SellerListViewBlockDescriptor;
  document: SellerListViewCompressedBlockDocument;
};

function buildBlock(
  listId: string,
  versionId: string,
  blockIndex: number,
  startOffset: number,
  items: SellerCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltSellerListViewBlock {
  const { json, compressed } = serializeItems(items);
  if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
    throw new Error(
      `Seller-list block compressed payload exceeds the absolute limit: list=${listId}, block=${blockIndex}, bytes=${compressed.length}`,
    );
  }
  const blockId = String(blockIndex).padStart(6, "0");
  const checksum = sha256SellerListView(compressed);
  const descriptor: SellerListViewBlockDescriptor = {
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
      schemaVersion: SELLER_LIST_VIEW_SCHEMA_VERSION,
      encoding: SELLER_LIST_VIEW_ENCODING,
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

function splitChunkByCompressedSize(items: SellerCardItem[]): SellerCardItem[][] {
  const { compressed } = serializeItems(items);
  if (
    compressed.length <= NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES ||
    items.length <= 1
  ) {
    if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
      throw new Error(
        `A single seller-list item exceeds the compressed document limit: ${compressed.length}`,
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

export function buildCompressedSellerListBlocks(
  listId: string,
  versionId: string,
  items: SellerCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltSellerListViewBlock[] {
  const chunks: SellerCardItem[][] = [];
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

export function buildSellerListChecksum(
  items: SellerCardItem[],
  blocks: BuiltSellerListViewBlock[],
): string {
  return sha256SellerListView(
    JSON.stringify({
      sellerKeys: items.map((item) => item.sellerKey),
      blocks: blocks.map((block) => block.descriptor.checksum),
    }),
  );
}
