import assert from "node:assert/strict";
import { db } from "../firebaseAdmin";
import { applyContentVisibility, clearContentVisibilityRuntimeCache } from "../visibility/contentVisibility";
import {
  buildVisibilityPlan,
  executeVisibilityChange,
  type VisibilityAction,
  type VisibilityTarget,
} from "../visibility/contentVisibilityAdmin";
import type { Product } from "../types";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required");
}

const SELLER_ID = "RG01040726";
const sellerTarget: VisibilityTarget = {
  entityType: "seller",
  platform: "dlsite",
  sourceSellerId: SELLER_ID,
};

async function change(target: VisibilityTarget, action: VisibilityAction, caseId: string) {
  const plan = await buildVisibilityPlan(target, action);
  return executeVisibilityChange({
    target,
    action,
    confirmPlanHash: plan.planHash,
    caseId,
    performedBy: "content-visibility-emulator-test",
    skipRebuild: true,
  });
}

async function loadProducts(): Promise<Product[]> {
  const snapshot = await db
    .collection("products")
    .where("platform", "==", "dlsite")
    .where("seller.sellerId", "==", SELLER_ID)
    .get();
  return snapshot.docs.map((doc) => ({ ...doc.data(), productId: doc.id }) as Product);
}

function assertActiveCount(products: Product[], expected: number, stage: string): void {
  assert.equal(products.length, 42, `${stage}: 9/2対象件数`);
  assert.equal(
    products.filter((product) => product.isActive).length,
    expected,
    `${stage}: active件数`,
  );
}

async function main(): Promise<void> {
  let products = await loadProducts();
  assertActiveCount(products, 0, "initial seller hidden");
  const productId = products.map((product) => product.productId).sort().at(-1);
  assert(productId);
  const productTarget: VisibilityTarget = {
    entityType: "product",
    platform: "dlsite",
    productId,
  };

  await change(sellerTarget, "restore", "TEST-ROUNDTRIP-SELLER-RESTORE-1");
  products = await loadProducts();
  assertActiveCount(products, 42, "seller restored");

  await change(productTarget, "hide", "TEST-ROUNDTRIP-PRODUCT-HIDE");
  products = await loadProducts();
  assertActiveCount(products, 41, "one product hidden");
  assert.equal(products.find((product) => product.productId === productId)?.isActive, false);

  await change(sellerTarget, "hide", "TEST-ROUNDTRIP-SELLER-HIDE");
  products = await loadProducts();
  assertActiveCount(products, 0, "seller and product hidden");

  await change(sellerTarget, "restore", "TEST-ROUNDTRIP-SELLER-RESTORE-2");
  products = await loadProducts();
  assertActiveCount(products, 41, "seller restored, product remains hidden");
  const stillHidden = products.find((product) => product.productId === productId);
  assert.deepEqual(stillHidden?.visibility?.blockers, ["product"]);

  await change(productTarget, "restore", "TEST-ROUNDTRIP-PRODUCT-RESTORE");
  products = await loadProducts();
  assertActiveCount(products, 42, "product restored");

  await change(sellerTarget, "hide", "TEST-ROUNDTRIP-FINAL-SELLER-HIDE");
  products = await loadProducts();
  assertActiveCount(products, 0, "final seller hidden");

  clearContentVisibilityRuntimeCache();
  const refetched = await applyContentVisibility({
    ...products[0],
    sourceIsActive: true,
    isActive: true,
    visibility: undefined,
  });
  assert.equal(refetched.isActive, false, "再取得でもseller hiddenを維持する");
  assert(refetched.visibility?.blockers.includes("seller"));

  console.log(JSON.stringify({
    sellerId: SELLER_ID,
    productCount: products.length,
    finalActiveCount: products.filter((product) => product.isActive).length,
    individuallyTestedProductId: productId,
    ingestionRemainsHidden: refetched.isActive === false,
    status: "passed",
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
