import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { Timestamp } from "firebase-admin/firestore";
import {
  buildCompactSearchIndexRows,
  compactSearchIndexRowToItem,
  rebuildCompactSearchIndex,
} from "../batch/rebuildCompactSearchIndex";
import { buildSearchIndexItems } from "../batch/rebuildSearchIndex";
import { getProductsForSiteStats } from "../batch/rebuildSiteStats";
import { db } from "../firebaseAdmin";
import type {
  CompactSearchIndexBlockDocument,
  CompactSearchIndexRootDocument,
  CompactSearchIndexRow,
  CompactSearchIndexVersionDocument,
  SearchIndexChunkDocument,
  SearchIndexRootDocument,
  SearchIndexVersionDocument,
} from "../types";

function assertEmulator(): void {
  const host = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) {
    throw new Error("Refusing to run without a loopback FIRESTORE_EMULATOR_HOST");
  }
}

async function loadLegacyItems(
  segment: string,
): Promise<{ items: unknown[]; reads: number } | undefined> {
  const rootRef = db.collection("searchIndexes").doc(segment);
  const rootSnapshot = await rootRef.get();
  if (!rootSnapshot.exists) return undefined;
  const root = rootSnapshot.data() as Partial<SearchIndexRootDocument>;
  if (typeof root.activeVersion !== "string") return undefined;
  const versionRef = rootRef.collection("versions").doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  if (!versionSnapshot.exists) return undefined;
  const version = versionSnapshot.data() as Partial<SearchIndexVersionDocument>;
  const chunkIds = version.chunkIds ?? [];
  const snapshots = chunkIds.length
    ? await db.getAll(
        ...chunkIds.map((id) => versionRef.collection("chunks").doc(id)),
      )
    : [];
  const items = snapshots.flatMap((snapshot, index) => {
    assert.equal(snapshot.exists, true, `legacy chunk ${chunkIds[index]} missing`);
    return (snapshot.data() as SearchIndexChunkDocument).items;
  });
  return { items, reads: 2 + snapshots.length };
}

async function loadCompactRows(
  segment: string,
): Promise<{ rows: CompactSearchIndexRow[]; reads: number }> {
  const rootRef = db.collection("compactSearchIndexes").doc(segment);
  const rootSnapshot = await rootRef.get();
  assert.equal(rootSnapshot.exists, true, `compact root ${segment} missing`);
  const root = rootSnapshot.data() as CompactSearchIndexRootDocument;
  const versionRef = rootRef
    .collection("compactSearchIndexVersions")
    .doc(root.activeVersion);
  const versionSnapshot = await versionRef.get();
  assert.equal(versionSnapshot.exists, true, `compact version ${segment} missing`);
  const version = versionSnapshot.data() as CompactSearchIndexVersionDocument;
  const snapshots = version.blocks.length
    ? await db.getAll(
        ...version.blocks.map((block) =>
          versionRef.collection("compactSearchIndexBlocks").doc(block.blockId),
        ),
      )
    : [];
  const rows = snapshots.flatMap((snapshot, index) => {
    assert.equal(snapshot.exists, true, `compact block ${index} missing`);
    const data = snapshot.data() as CompactSearchIndexBlockDocument;
    const payload = Buffer.isBuffer(data.payload)
      ? data.payload
      : Buffer.from(data.payload as Uint8Array);
    return JSON.parse(gunzipSync(payload).toString("utf8")) as CompactSearchIndexRow[];
  });
  return { rows, reads: 2 + snapshots.length };
}

function mib(value: number): number {
  return Number((value / 1024 / 1024).toFixed(2));
}

async function run(): Promise<void> {
  assertEmulator();
  const before = process.memoryUsage();
  const roots = await db.collection("searchIndexes").get();
  const segments = roots.docs.flatMap((document) => {
    const root = document.data() as Partial<SearchIndexRootDocument>;
    return root.platform && root.audience && root.category
      ? [{
          id: document.id,
          platform: root.platform,
          audience: root.audience,
          category: root.category,
        }]
      : [];
  });

  const reports: unknown[] = [];
  let productDocumentsRead = 0;
  for (const segment of segments.sort((a, b) => a.id.localeCompare(b.id))) {
    const id = segment.id;
    const segmentProducts = await getProductsForSiteStats(segment);
    productDocumentsRead += segmentProducts.length;
    const first = segmentProducts[0];
    assert.ok(first, `${id}: no projected products were loaded`);
    const legacyFresh = buildSearchIndexItems(segmentProducts);
    const rows = buildCompactSearchIndexRows(segmentProducts);
    assert.deepEqual(
      rows.map(compactSearchIndexRowToItem),
      legacyFresh,
      `${id}: real-data compact conversion changed a search field`,
    );

    const existingLegacy = await loadLegacyItems(id);
    const existingMatches = existingLegacy?.items.length === legacyFresh.length;
    if (existingMatches) {
      assert.deepEqual(
        existingLegacy.items,
        legacyFresh,
        `${id}: freshly built legacy data differs from the imported active legacy index`,
      );
    }

    const built = await rebuildCompactSearchIndex(
      {
        platform: first.platform,
        audience: first.audience,
        category: first.category,
      },
      segmentProducts,
      Timestamp.now(),
    );
    const stored = await loadCompactRows(id);
    assert.deepEqual(
      stored.rows.map(compactSearchIndexRowToItem),
      legacyFresh,
      `${id}: stored compact blocks changed a search field`,
    );

    reports.push({
      segmentId: id,
      products: segmentProducts.length,
      blocks: built.blockCount,
      compactBytes: built.compressedBytes,
      legacyReadEstimate: existingLegacy?.reads,
      compactReadEstimate: stored.reads,
      importedLegacyCompared: Boolean(existingMatches),
    });
  }

  const after = process.memoryUsage();
  console.log(JSON.stringify({
    emulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    productDocumentsRead,
    activeProducts: productDocumentsRead,
    segments: reports,
    memory: {
      beforeRssMiB: mib(before.rss),
      afterRssMiB: mib(after.rss),
      afterHeapUsedMiB: mib(after.heapUsed),
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
