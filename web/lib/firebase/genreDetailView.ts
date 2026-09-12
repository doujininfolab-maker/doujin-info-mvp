import "server-only";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { getAdminDb } from "./admin";
import type { Product } from "../types";

type Filter = { platform: string; audience: string; category: string; genreId: string };
type Manifest = { schemaVersion: number; genreId: string; count: number; blocks: Descriptor[] };
type Descriptor = { id: string; start: number; count: number; bytes: number; checksum: string };
const cache = new Map<string, { value: unknown; bytes: number; expiresAt: number }>();
let cacheBytes = 0;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
function remember(key: string, value: unknown, bytes: number, ttl = Infinity) {
  if (bytes > MAX_CACHE_BYTES) return;
  const old = cache.get(key);
  if (old) { cacheBytes -= old.bytes; cache.delete(key); }
  while (cache.size >= 128 || cacheBytes + bytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cacheBytes -= cache.get(oldest)!.bytes; cache.delete(oldest);
  }
  cache.set(key, { value, bytes, expiresAt: Date.now() + ttl }); cacheBytes += bytes;
}
export function clearGenreDetailCache() { cache.clear(); cacheBytes = 0; }
function isIdle(data: FirebaseFirestore.DocumentData | undefined, revision: number): boolean {
  return !!data && Number.isSafeInteger(data.revision) && data.revision === revision &&
    !!data.writers && typeof data.writers === "object" && !Array.isArray(data.writers) && Object.keys(data.writers).length === 0;
}

/** Undefined means use the unchanged products query. An empty array is a verified empty result. */
export async function getGenreDetailCandidates(filter: Filter, offset: number, limit: number): Promise<Product[] | undefined> {
  if (process.env.GENRE_DETAIL_READ_MODE !== "prefer") return undefined;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) return undefined;
  const db = getAdminDb();
  const sourceRef = db.doc("genreDetailControl/source");
  const rootRef = db.collection("genreDetailViews").doc(`${filter.platform}_${filter.audience}_${filter.category}`);
  try {
    const rootCacheKey = `root:${rootRef.path}`;
    const cachedRoot = cache.get(rootCacheKey);
    let root = cachedRoot && cachedRoot.expiresAt > Date.now() ? cachedRoot.value as FirebaseFirestore.DocumentData : undefined;
    let source: FirebaseFirestore.DocumentData | undefined;
    let readPayload = false;
    if (root) {
      source = (await sourceRef.get()).data();
      if (!isIdle(source, source?.revision)) return undefined;
      if (root.revision !== source!.revision) {
        root = (await rootRef.get()).data();
        readPayload = true;
      }
    } else {
      const snapshots = await db.getAll(sourceRef, rootRef);
      source = snapshots[0].data(); root = snapshots[1].data();
      readPayload = true;
    }
    if (root?.schemaVersion !== 1 || !isIdle(source, root.revision) ||
        typeof root.activeVersion !== "string" || !/^[0-9a-f-]{36}$/.test(root.activeVersion) || !Array.isArray(root.genreKeys) || root.genreKeyChecksum !== createHash("sha256").update(JSON.stringify(root.genreKeys)).digest("hex")) return undefined;
    if (readPayload) remember(rootCacheKey, root, Buffer.byteLength(JSON.stringify(root)), 60_000);
    const key = createHash("sha256").update(filter.genreId).digest("hex");
    const genreRef = rootRef.collection("versions").doc(root.activeVersion).collection("genres").doc(key);
    let result: Product[] = [];
    if (root.genreKeys.includes(key)) {
      let manifest = cache.get(genreRef.path)?.value as Manifest | undefined;
      if (!manifest) {
        readPayload = true;
        manifest = (await genreRef.get()).data() as Manifest | undefined;
        if (!manifest || manifest.schemaVersion !== 1 || manifest.genreId !== filter.genreId ||
            !Number.isSafeInteger(manifest.count) || manifest.count < 0 || !Array.isArray(manifest.blocks)) return undefined;
        let end = 0;
        for (const [index, block] of manifest.blocks.entries()) {
          if (block.id !== String(index) || block.start !== end || !Number.isSafeInteger(block.count) || block.count < 1 || block.count > 300 ||
              !Number.isSafeInteger(block.bytes) || block.bytes < 1 || block.bytes > 4 * 1024 * 1024 || !/^[0-9a-f]{64}$/.test(block.checksum)) return undefined;
          end += block.count;
        }
        if (end !== manifest.count) return undefined;
        remember(genreRef.path, manifest, Buffer.byteLength(JSON.stringify(manifest)));
      }
      const required = manifest.blocks.filter((b) => b.start < offset + limit && b.start + b.count > offset);
      const rows: Product[] = [];
      for (const descriptor of required) {
        const blockRef = genreRef.collection("blocks").doc(descriptor.id);
        let products = cache.get(blockRef.path)?.value as Product[] | undefined;
        if (!products) {
          readPayload = true;
          const block = (await blockRef.get()).data();
          if (!block || block.schemaVersion !== 1 || !(block.payload instanceof Uint8Array) || block.payload.length > 256 * 1024 ||
              block.start !== descriptor.start || block.count !== descriptor.count || block.bytes !== descriptor.bytes || block.checksum !== descriptor.checksum) return undefined;
          const json = gunzipSync(block.payload, { maxOutputLength: 4 * 1024 * 1024 });
          if (json.length !== descriptor.bytes || createHash("sha256").update(json).digest("hex") !== descriptor.checksum) return undefined;
          const parsed: unknown = JSON.parse(json.toString("utf8"));
          if (!Array.isArray(parsed) || parsed.length !== descriptor.count) return undefined;
          const ids = new Set<string>();
          for (const product of parsed) {
            if (!product || typeof product.productId !== "string" || ids.has(product.productId) || product.isActive !== true ||
                product.platform !== filter.platform || product.audience !== filter.audience || product.category !== filter.category ||
                !Array.isArray(product.genreIds) || !product.genreIds.includes(filter.genreId) ||
                (product.salesCount !== null && (typeof product.salesCount !== "number" || !Number.isFinite(product.salesCount)))) return undefined;
            ids.add(product.productId);
          }
          products = parsed;
          remember(blockRef.path, products, json.length * 2);
        }
        const start = Math.max(0, offset - descriptor.start);
        const end = Math.min(descriptor.count, offset + limit - descriptor.start);
        rows.push(...products.slice(start, end));
      }
      if (rows.length !== Math.max(0, Math.min(limit, manifest.count - offset))) return undefined;
      result = rows;
    }
    // Awaited metadata/payload reads require a second guard. A fully cached
    // immutable version needs only the fresh source revision read above.
    if (readPayload && !isIdle((await sourceRef.get()).data(), root.revision)) return undefined;
    return structuredClone(result);
  } catch (error) {
    console.warn("Genre detail aggregate unavailable", { message: String(error).slice(0, 200) });
    return undefined;
  }
}
