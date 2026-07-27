import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  ProductCardItem,
  ProductRankingMode,
  RankingIndexContentScope,
  RankingIndexWorkType,
  RankingListViewBlockDescriptor,
  RankingListViewCompressedBlockDocument,
} from "../../types";
import {
  NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES,
  NEW_LIST_VIEW_MAX_ITEMS_PER_BLOCK,
  NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES,
  NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES,
} from "./newListViewShared";

export const RANKING_LIST_VIEW_SCHEMA_VERSION = 1;
export const RANKING_LIST_VIEW_ENCODING = "gzip-json-v1" as const;

export const RANKING_LIST_VIEW_CONTENT_SCOPES: RankingIndexContentScope[] = [
  "all",
  "tl",
  "bl",
];

export const RANKING_LIST_VIEW_MODES: ProductRankingMode[] = [
  "dailyRevenue",
  "daily",
  "weekly",
  "monthly",
  "cumulative",
];

export const RANKING_LIST_VIEW_WORK_TYPES: RankingIndexWorkType[] = [
  "all",
  "comic",
  "novel",
  "cg",
  "movie",
  "game",
  "voice",
  "other",
];

export function buildRankingListViewListId(
  contentScope: RankingIndexContentScope,
  rankingMode: ProductRankingMode,
  workType: RankingIndexWorkType,
): string {
  return `${contentScope}_${rankingMode}_${workType}`;
}


export function sha256RankingListView(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializeItems(items: ProductCardItem[]): {
  json: Buffer;
  compressed: Buffer;
} {
  const json = Buffer.from(JSON.stringify(items), "utf8");
  if (json.length > NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Ranking-list block uncompressed payload exceeds the safety limit: ${json.length}`,
    );
  }
  return { json, compressed: gzipSync(json, { level: 6 }) };
}

export type BuiltRankingListViewBlock = {
  descriptor: RankingListViewBlockDescriptor;
  document: RankingListViewCompressedBlockDocument;
};

function buildBlock(
  listId: string,
  versionId: string,
  blockIndex: number,
  startOffset: number,
  items: ProductCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltRankingListViewBlock {
  const { json, compressed } = serializeItems(items);
  if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
    throw new Error(
      `Ranking-list block compressed payload exceeds the absolute limit: list=${listId}, block=${blockIndex}, bytes=${compressed.length}`,
    );
  }

  const blockId = String(blockIndex).padStart(6, "0");
  const checksum = sha256RankingListView(compressed);
  const descriptor: RankingListViewBlockDescriptor = {
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
      schemaVersion: RANKING_LIST_VIEW_SCHEMA_VERSION,
      encoding: RANKING_LIST_VIEW_ENCODING,
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

function splitChunkByCompressedSize(items: ProductCardItem[]): ProductCardItem[][] {
  const { compressed } = serializeItems(items);
  if (
    compressed.length <= NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES ||
    items.length <= 1
  ) {
    if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
      throw new Error(
        `A single ranking-list item exceeds the compressed document limit: ${compressed.length}`,
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

export function buildCompressedRankingListBlocks(
  listId: string,
  versionId: string,
  items: ProductCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltRankingListViewBlock[] {
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

export function buildRankingListChecksum(
  items: ProductCardItem[],
  blocks: BuiltRankingListViewBlock[],
): string {
  return sha256RankingListView(
    JSON.stringify({
      productIds: items.map((item) => item.productId),
      rankingMetrics: items.map((item) => item.rankingMetric),
      blocks: blocks.map((block) => block.descriptor.checksum),
    }),
  );
}
