import { FieldPath, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { db } from "../../firebaseAdmin";
import type { FetchTarget, Product } from "../../types";
import {
  NEW_LIST_VIEW_PRODUCT_FIELDS,
  type NewListViewSourceProduct,
} from "./newListViewShared";

const PRODUCTS_COLLECTION = "products";
const PAGE_SIZE = 1000;

type SiteSegmentKey = Pick<FetchTarget, "platform" | "audience" | "category">;

export async function loadProjectedProductsForNewListView(
  segment: SiteSegmentKey,
): Promise<NewListViewSourceProduct[]> {
  const products: NewListViewSourceProduct[] = [];
  let lastDoc: QueryDocumentSnapshot | undefined;

  while (true) {
    let query = db
      .collection(PRODUCTS_COLLECTION)
      .where("platform", "==", segment.platform)
      .where("audience", "==", segment.audience)
      .where("category", "==", segment.category)
      .where("isActive", "==", true)
      .select(...NEW_LIST_VIEW_PRODUCT_FIELDS)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);

    if (lastDoc) query = query.startAfter(lastDoc);

    const snapshot = await query.get();
    if (snapshot.empty) break;

    for (const doc of snapshot.docs) {
      const data = doc.data() as NewListViewSourceProduct;
      products.push({
        ...data,
        productId: (data as Product).productId ?? doc.id,
        sourceProductId: data.sourceProductId ?? doc.id,
      });
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.size < PAGE_SIZE) break;
  }

  return products;
}
