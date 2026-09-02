import assert from "node:assert/strict";
import { db } from "../firebaseAdmin";

const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host) throw new Error("FIRESTORE_EMULATOR_HOST is required");

const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "doujin-info-mvp";
const base = `http://${host}/v1/projects/${projectId}/databases/(default)/documents`;

async function expectStatus(
  label: string,
  expected: number,
  url: string,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(url, init);
  if (response.status !== expected) {
    const body = await response.text();
    assert.equal(response.status, expected, `${label}: ${response.status} ${body}`);
  }
  return response;
}

async function main(): Promise<void> {
  const activeRef = db.collection("products").doc("active-product");
  const hiddenRef = db.collection("products").doc("hidden-product");
  await Promise.all([
    activeRef.set({ productId: "active-product", isActive: true, title: "active" }),
    hiddenRef.set({ productId: "hidden-product", isActive: false, title: "hidden" }),
    activeRef.collection("dailyMetrics").doc("20260902").set({ date: "20260902", salesCount: 1 }),
    hiddenRef.collection("dailyMetrics").doc("20260902").set({ date: "20260902", salesCount: 1 }),
    db.collection("contentVisibilityRuntime").doc("current").set({
      schemaVersion: 1,
      revision: 1,
      hiddenProductIds: ["hidden-product"],
      hiddenSellerProductIds: [],
      hiddenSellerKeys: [],
    }),
    db.collection("rankingSnapshots").doc("raw-ranking").set({ itemCount: 1 }),
    db.collection("sellers").doc("raw-seller").set({ sellerId: "RGTEST" }),
    db.collection("taxonomies").doc("public-taxonomy").set({ name: "test" }),
  ]);

  await expectStatus("public active get", 200, `${base}/products/active-product`);
  await expectStatus("hidden product get", 403, `${base}/products/hidden-product`);
  await expectStatus("active metric get", 200, `${base}/products/active-product/dailyMetrics/20260902`);
  await expectStatus("hidden parent metric get", 403, `${base}/products/hidden-product/dailyMetrics/20260902`);
  await expectStatus("runtime get", 403, `${base}/contentVisibilityRuntime/current`);
  await expectStatus("raw ranking get", 403, `${base}/rankingSnapshots/raw-ranking`);
  await expectStatus("raw seller get", 403, `${base}/sellers/raw-seller`);
  await expectStatus("taxonomy get", 200, `${base}/taxonomies/public-taxonomy`);
  await expectStatus("orphan subcollection get", 403, `${base}/products/missing/private/data`);
  await expectStatus("public write", 403, `${base}/products/active-product`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { isActive: { booleanValue: false } } }),
  });

  const activeQuery = await expectStatus("active-only list", 200, `${base}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "products" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "isActive" },
            op: "EQUAL",
            value: { booleanValue: true },
          },
        },
      },
    }),
  });
  const activeRows = await activeQuery.json() as Array<{ document?: { name?: string } }>;
  assert(activeRows.some((row) => row.document?.name?.endsWith("/active-product")));
  assert(!activeRows.some((row) => row.document?.name?.endsWith("/hidden-product")));

  await expectStatus("unfiltered products list", 403, `${base}:runQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "products" }] } }),
  });

  console.log("Visibility Security Rules emulator tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
