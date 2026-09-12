import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions";
import { db } from "../firebaseAdmin";
import type { FetchTarget, Product } from "../types";

type Segment = Pick<FetchTarget, "platform" | "audience" | "category">;
type Source = { revision: number; writers: Record<string, unknown> };
type BuildInput = { segment: Segment; products: Product[]; revision: number };
const context = new AsyncLocalStorage<{ token: string; builds: Map<string, BuildInput> }>();
export const genreSourceRef = () => db.doc("genreDetailControl/source");
export const genreDetailEnabled = () => process.env.GENRE_DETAIL_AGGREGATION_ENABLED === "true";
const segmentId = (s: Segment) => `${s.platform}_${s.audience}_${s.category}`;
export const genreKey = (id: string) => createHash("sha256").update(id).digest("hex");

export async function readGenreSource(): Promise<Source> {
  const data = (await genreSourceRef().get()).data();
  if (!data) return { revision: 0, writers: {} };
  if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !data.writers || typeof data.writers !== "object" || Array.isArray(data.writers)) throw new Error("Invalid genre source state");
  return data as Source;
}

/** A concurrent writer already running at scan start can change later pages
 * without starting a new revision. Such a scan must never be published. */
export async function captureGenreSourceRevision(): Promise<number> {
  const source = await readGenreSource();
  const ownToken = context.getStore()?.token;
  return Object.keys(source.writers).some((token) => token !== ownToken) ? -1 : source.revision;
}

/** Invalidates before the first source write. This is a publication guard, not a batch lock. */
export async function withGenreSourceMutation<T>(operation: () => Promise<T>): Promise<T> {
  if (context.getStore()) return operation();
  const token = randomUUID();
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(genreSourceRef());
    const data = snapshot.data();
    tx.set(genreSourceRef(), { revision: (data?.revision ?? 0) + 1, writers: { [token]: { execution: process.env.CLOUD_RUN_EXECUTION ?? process.env.JOB_MODE ?? "manual", startedAt: Timestamp.now() } }, updatedAt: Timestamp.now() }, { merge: true });
  });
  const scope = { token, builds: new Map<string, BuildInput>() };
  let result: T;
  try {
    result = await context.run(scope, operation);
  } finally {
    // A process crash leaves its token in place. Recovery requires checking the
    // stopped writer; an automatic TTL could publish while a slow writer runs.
    await genreSourceRef().update({ [`writers.${token}`]: FieldValue.delete() });
  }
  for (const input of scope.builds.values()) {
    try { await publishGenreDetailView(input); }
    catch (error) { logger.error("Genre detail rebuild failed; legacy reads remain available", { segment: segmentId(input.segment), error: String(error) }); }
  }
  return result;
}

export async function queueGenreDetailView(input: BuildInput): Promise<void> {
  if (!genreDetailEnabled()) return;
  const scope = context.getStore();
  if (scope) scope.builds.set(segmentId(input.segment), input);
  else {
    try { await publishGenreDetailView(input); }
    catch (error) {
      // This optional read optimization must not stop the existing index/list
      // pipeline. An unmatched revision keeps the web on its legacy query.
      logger.error("Genre detail rebuild failed; legacy reads remain available", { segment: segmentId(input.segment), error: String(error) });
    }
  }
}

// Exactly the fields used by the genre card and the existing post filters.
export const GENRE_CARD_FIELDS = ["sourceProductId", "platform", "audience", "category", "title", "seller", "priceCurrent", "priceOriginal", "discountRate", "isDiscounted", "isOnSale", "salesCount", "rating", "ratingAverage", "releaseDate", "workType", "workTypeLabel", "contentType", "contentTypes", "contentTypeIds", "mainImageUrl", "thumbnailUrl", "images", "genres", "genreIds", "tags", "isActive", "sourceUrl", "affiliateUrl", "currency", "affiliateProvider", "isAdult"] as const;

export function buildGenreRows(products: Product[]): Map<string, Record<string, unknown>[]> {
  const lists = new Map<string, Record<string, unknown>[]>();
  for (const product of products) {
    if (product.isActive !== true || !Object.hasOwn(product, "salesCount")) continue;
    if (product.salesCount !== null && (typeof product.salesCount !== "number" || !Number.isFinite(product.salesCount))) throw new Error("Unsupported genre salesCount ordering");
    const row: Record<string, unknown> = { productId: product.productId };
    const sortId = (product as Product & { genreSortDocumentId?: string }).genreSortDocumentId ?? product.productId;
    Object.defineProperty(row, "genreSortDocumentId", { value: sortId, enumerable: false });
    const data = product as unknown as Record<string, unknown>;
    for (const field of GENRE_CARD_FIELDS) if (data[field] !== undefined) row[field] = data[field];
    for (const id of new Set(product.genreIds ?? [])) {
      const list = lists.get(id) ?? [];
      list.push(row);
      lists.set(id, list);
    }
  }
  for (const list of lists.values()) list.sort((a, b) => {
    if (a.salesCount !== b.salesCount) {
      if (a.salesCount === null) return 1;
      if (b.salesCount === null) return -1;
      return Number(b.salesCount) - Number(a.salesCount);
    }
    return Buffer.compare(Buffer.from(String(b.genreSortDocumentId)), Buffer.from(String(a.genreSortDocumentId)));
  });
  return lists;
}

export function packGenreRows(rows: Record<string, unknown>[]) {
  const blocks: Array<{ start: number; count: number; payload: Buffer; checksum: string; bytes: number }> = [];
  let start = 0;
  while (start < rows.length) {
    let count = Math.min(300, rows.length - start);
    for (;;) {
      const json = Buffer.from(JSON.stringify(rows.slice(start, start + count)));
      const payload = gzipSync(json);
      if (payload.length <= 256 * 1024 && json.length <= 4 * 1024 * 1024) {
        blocks.push({ start, count, payload, checksum: createHash("sha256").update(json).digest("hex"), bytes: json.length });
        start += count;
        break;
      }
      if (count === 1) throw new Error("Genre card exceeds block size limit");
      count = Math.max(1, Math.floor(count / 2));
    }
  }
  return blocks;
}

export async function publishGenreDetailView(input: BuildInput): Promise<{ published: boolean; blocks: number }> {
  const source = await readGenreSource();
  if (source.revision !== input.revision || Object.keys(source.writers).length) return { published: false, blocks: 0 };
  const root = db.collection("genreDetailViews").doc(segmentId(input.segment));
  const version = root.collection("versions").doc(randomUUID());
  const lists = buildGenreRows(input.products);
  const keys = [...lists.keys()].map(genreKey);
  if (Buffer.byteLength(JSON.stringify(keys)) > 500_000) throw new Error("Genre manifest too large");
  let blockCount = 0;
  let batch = db.batch();
  let pending = 0;
  const put = async (ref: FirebaseFirestore.DocumentReference, data: Record<string, unknown>) => {
    if (pending >= 350) { await batch.commit(); batch = db.batch(); pending = 0; }
    batch.set(ref, data); pending += 1;
  };
  await version.set({ createdAt: Timestamp.now(), revision: input.revision, status: "building" });
  for (const [genreId, rows] of lists) {
    const genre = version.collection("genres").doc(genreKey(genreId));
    const packed = packGenreRows(rows);
    const descriptors = packed.map(({ payload: _payload, ...descriptor }, index) => ({ ...descriptor, id: String(index) }));
    if (Buffer.byteLength(JSON.stringify(descriptors)) > 500_000) throw new Error("Genre block manifest too large");
    await put(genre, { schemaVersion: 1, genreId, count: rows.length, blocks: descriptors });
    for (const [index, block] of packed.entries()) { await put(genre.collection("blocks").doc(String(index)), { ...block, schemaVersion: 1 }); blockCount += 1; }
  }
  if (pending) await batch.commit();
  const published = await db.runTransaction(async (tx) => {
    const state = (await tx.get(genreSourceRef())).data();
    if ((state?.revision ?? 0) !== input.revision || Object.keys(state?.writers ?? {}).length) return false;
    if (!state) tx.set(genreSourceRef(), { revision: 0, writers: {} });
    tx.set(version, { status: "ready", completedAt: Timestamp.now() }, { merge: true });
    tx.set(root, { schemaVersion: 1, activeVersion: version.id, revision: input.revision, genreKeys: keys, genreKeyChecksum: createHash("sha256").update(JSON.stringify(keys)).digest("hex"), updatedAt: Timestamp.now() });
    return true;
  });
  logger.info("Genre detail view built", { segment: segmentId(input.segment), revision: input.revision, published, productCount: input.products.length, genreCount: lists.size, blockCount, writeCount: blockCount + lists.size + 1 + (published ? 2 : 0) });
  if (published) await cleanupGenreDetailVersions(root.path);
  return { published, blocks: blockCount };
}

export async function cleanupGenreDetailVersions(rootPath: string): Promise<void> {
  const root = db.doc(rootPath);
  const versions = await root.collection("versions").get();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const version of versions.docs) {
    if ((version.data().createdAt?.toMillis?.() ?? Infinity) >= cutoff) continue;
    if (version.data().status === "building" && version.data().revision === (await readGenreSource()).revision) continue;
    // Old versions cannot be reactivated: every publication has a new UUID.
    if ((await root.get()).data()?.activeVersion === version.id) continue;
    await db.recursiveDelete(version.ref);
  }
}
