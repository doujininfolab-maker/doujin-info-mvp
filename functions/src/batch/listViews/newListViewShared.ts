import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  NewListViewBlockDescriptor,
  NewListViewCompressedBlockDocument,
  Product,
  ProductCardItem,
  ProductContentType,
  ProductWorkType,
} from "../../types";

export const NEW_LIST_VIEW_SCHEMA_VERSION = 1;
export const NEW_LIST_VIEW_ENCODING = "gzip-json-v1" as const;
export const NEW_LIST_VIEW_MAX_ITEMS_PER_BLOCK = 1000;
export const NEW_LIST_VIEW_SOFT_COMPRESSED_BYTES = 256 * 1024;
export const NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES = 700 * 1024;
export const NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

export const NEW_LIST_VIEW_CONTENT_SCOPES = ["all", "tl", "bl"] as const;
export const NEW_LIST_VIEW_WORK_TYPES = [
  "all",
  "comic",
  "novel",
  "cg",
  "movie",
  "game",
  "voice",
  "other",
] as const;

export type NewListViewContentScope = (typeof NEW_LIST_VIEW_CONTENT_SCOPES)[number];
export type NewListViewWorkType = (typeof NEW_LIST_VIEW_WORK_TYPES)[number];
export type NewListViewSourceProduct = Product & { contentType?: string };

export const NEW_LIST_VIEW_PRODUCT_FIELDS = [
  "sourceProductId",
  "platform",
  "audience",
  "category",
  "title",
  "seller",
  "priceCurrent",
  "priceOriginal",
  "discountRate",
  "isDiscounted",
  "isOnSale",
  "salesCount",
  "rating",
  "ratingAverage",
  "releaseDate",
  "workType",
  "workTypeLabel",
  "contentType",
  "contentTypes",
  "contentTypeIds",
  "mainImageUrl",
  "thumbnailUrl",
  "images",
  "genres",
  "genreIds",
  "tags",
  "isActive",
  "updatedAt",
] as const;

export function removeUndefinedDeep<T>(value: T): T {
  if (value === undefined) return undefined as T;
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => removeUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }

  const timestampLike = value as { seconds?: number; toDate?: () => Date };
  if (
    typeof timestampLike.seconds === "number" &&
    typeof timestampLike.toDate === "function"
  ) {
    return value;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    const cleanedItem = removeUndefinedDeep(item);
    if (cleanedItem !== undefined) cleaned[key] = cleanedItem;
  }
  return cleaned as T;
}

export function normalizeListViewContentType(
  value: string | undefined,
): ProductContentType | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

export function getListViewProductScopes(
  product: NewListViewSourceProduct,
): Set<ProductContentType> {
  const scopes = new Set<ProductContentType>();
  for (const value of [
    product.contentType,
    ...(product.contentTypeIds ?? []),
    ...(product.contentTypes ?? []),
  ]) {
    const normalized = normalizeListViewContentType(value);
    if (normalized) scopes.add(normalized);
  }
  return scopes;
}

export function listViewProductHasScope(
  product: NewListViewSourceProduct,
  scope: NewListViewContentScope,
): boolean {
  return scope === "all" || getListViewProductScopes(product).has(scope);
}

export function normalizeListViewWorkType(
  product: Pick<Product, "workType" | "workTypeLabel">,
): ProductWorkType | undefined {
  const raw = (product.workType ?? product.workTypeLabel)
    ?.toString()
    .trim()
    .toLowerCase();
  if (!raw) return undefined;
  if (["comic", "マンガ", "漫画", "同人誌"].includes(raw)) return "comic";
  if (["novel", "ノベル", "小説"].includes(raw)) return "novel";
  if (["cg", "ｃｇ", "イラスト", "cg・イラスト"].includes(raw)) return "cg";
  if (["movie", "video", "動画"].includes(raw)) return "movie";
  if (["game", "ゲーム"].includes(raw)) return "game";
  if (["voice", "sound", "音声", "asmr"].includes(raw)) return "voice";
  if (raw === "other") return "other";
  return undefined;
}

export function listViewProductMatchesWorkType(
  product: NewListViewSourceProduct,
  workType: NewListViewWorkType,
): boolean {
  return workType === "all" || normalizeListViewWorkType(product) === workType;
}

function getCardImageUrl(product: Product): string {
  return (
    product.mainImageUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    product.images?.[0]?.thumbnailUrl ||
    "/no-image.svg"
  );
}

function pairGenres(
  product: Product,
  limit = 8,
): { genres: string[]; genreIds: string[] } {
  const genres = (product.genres ?? []).slice(0, limit);
  const sourceGenreIds = product.genreIds ?? [];
  return {
    genres,
    genreIds: genres.map(
      (genre, index) => sourceGenreIds[index] || `dlsite:${genre}`,
    ),
  };
}

export function toProductCardItem(product: Product): ProductCardItem {
  const pairedGenres = pairGenres(product);
  return removeUndefinedDeep({
    productId: product.productId,
    sourceProductId: product.sourceProductId || product.productId,
    platform: product.platform,
    audience: product.audience,
    category: product.category,
    title: product.title,
    seller: product.seller
      ? {
          sellerId: product.seller.sellerId,
          sellerName: product.seller.sellerName,
        }
      : undefined,
    priceCurrent: product.priceCurrent,
    priceOriginal: product.priceOriginal,
    discountRate: product.discountRate,
    isDiscounted: product.isDiscounted,
    isOnSale: product.isOnSale,
    salesCount: product.salesCount,
    rating: product.rating,
    ratingAverage: product.ratingAverage,
    releaseDate: product.releaseDate,
    workType: normalizeListViewWorkType(product) ?? product.workType,
    workTypeLabel: product.workTypeLabel,
    contentTypes: product.contentTypes ?? [],
    contentTypeIds: product.contentTypeIds ?? [],
    cardImageUrl: getCardImageUrl(product),
    genres: pairedGenres.genres,
    genreIds: pairedGenres.genreIds,
    tags: (product.tags ?? []).slice(0, 8),
  });
}

export function compareNewListProducts(
  left: Pick<Product, "releaseDate" | "productId">,
  right: Pick<Product, "releaseDate" | "productId">,
): number {
  return (
    (right.releaseDate ?? "").localeCompare(left.releaseDate ?? "") ||
    left.productId.localeCompare(right.productId)
  );
}

export function buildNewListId(
  contentScope: NewListViewContentScope,
  workType: NewListViewWorkType,
): string {
  return `${contentScope}_${workType}`;
}

export function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function serializeItems(items: ProductCardItem[]): {
  json: Buffer;
  compressed: Buffer;
} {
  const json = Buffer.from(JSON.stringify(items), "utf8");
  if (json.length > NEW_LIST_VIEW_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `New-list block uncompressed payload exceeds the safety limit: ${json.length}`,
    );
  }
  return { json, compressed: gzipSync(json, { level: 6 }) };
}

export type BuiltNewListViewBlock = {
  descriptor: NewListViewBlockDescriptor;
  document: NewListViewCompressedBlockDocument;
};

function buildBlock(
  listId: string,
  versionId: string,
  blockIndex: number,
  startOffset: number,
  items: ProductCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltNewListViewBlock {
  const { json, compressed } = serializeItems(items);
  if (compressed.length > NEW_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
    throw new Error(
      `New-list block compressed payload exceeds the absolute limit: list=${listId}, block=${blockIndex}, bytes=${compressed.length}`,
    );
  }
  const blockId = String(blockIndex).padStart(6, "0");
  const checksum = sha256Hex(compressed);
  const descriptor: NewListViewBlockDescriptor = {
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
      schemaVersion: NEW_LIST_VIEW_SCHEMA_VERSION,
      encoding: NEW_LIST_VIEW_ENCODING,
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
        `A single new-list item exceeds the compressed document limit: ${compressed.length}`,
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

export function buildCompressedNewListBlocks(
  listId: string,
  versionId: string,
  items: ProductCardItem[],
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltNewListViewBlock[] {
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

export function buildListChecksum(
  items: ProductCardItem[],
  blocks: BuiltNewListViewBlock[],
): string {
  return sha256Hex(
    JSON.stringify({
      productIds: items.map((item) => item.productId),
      blocks: blocks.map((block) => block.descriptor.checksum),
    }),
  );
}
