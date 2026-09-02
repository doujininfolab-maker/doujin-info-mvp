import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { getProductsForSiteStats } from "../batch/rebuildSiteStats";
import { rebuildSellerIndex } from "../batch/rebuildSellerIndex";
import { db } from "../firebaseAdmin";
import type {
  SellerIndexChunkDocument,
  SellerIndexItem,
  SellerIndexRootDocument,
  SellerIndexVersionDocument,
} from "../types";

async function loadItems(
  versionId: string,
): Promise<{ items: SellerIndexItem[]; chunkCount: number }> {
  const versionRef = db
    .collection("sellerIndexes")
    .doc("dlsite_female_doujin")
    .collection("versions")
    .doc(versionId);
  const snapshot = await versionRef.get();
  assert.equal(snapshot.exists, true, `seller version missing: ${versionId}`);
  const version = snapshot.data() as SellerIndexVersionDocument;
  const chunks = version.chunkIds.length
    ? await db.getAll(
        ...version.chunkIds.map((id) => versionRef.collection("chunks").doc(id)),
      )
    : [];
  return {
    items: chunks.flatMap(
      (chunk) => (chunk.data() as SellerIndexChunkDocument).items,
    ),
    chunkCount: chunks.length,
  };
}

async function run(): Promise<void> {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  assert.match(emulatorHost, /^(127\.0\.0\.1|localhost):\d+$/);
  assert.notEqual(process.env.GCLOUD_PROJECT, "doujin-info-prod");
  const rootRef = db.collection("sellerIndexes").doc("dlsite_female_doujin");
  const beforeRoot = (await rootRef.get()).data() as SellerIndexRootDocument;
  const before = await loadItems(beforeRoot.activeVersion);
  const products = await getProductsForSiteStats({
    platform: "dlsite",
    audience: "female",
    category: "doujin",
  });
  const result = await rebuildSellerIndex(
    { platform: "dlsite", audience: "female", category: "doujin" },
    products,
    Timestamp.now(),
  );
  const after = await loadItems(result.versionId);
  assert.deepEqual(after.items, before.items, "streaming changed seller index items or order");
  assert.equal(after.chunkCount, before.chunkCount, "streaming changed chunk boundaries");
  console.log(JSON.stringify({
    emulatorHost,
    productCount: products.length,
    itemCount: after.items.length,
    beforeChunkCount: before.chunkCount,
    afterChunkCount: after.chunkCount,
    exactItemAndOrderMatch: true,
    maxRssMiB: Number((process.resourceUsage().maxRSS / 1024).toFixed(2)),
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
