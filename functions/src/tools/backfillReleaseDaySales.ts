import { db } from "../firebaseAdmin";
import { planReleaseDayBackfill } from "../batch/backfillReleaseDaySales";
import { withGenreSourceMutation } from "../batch/genreDetailView";
import { buildMetricYearMutations, decodeMetricYear, writesLegacyMetrics, writesMetricYears } from "../firestore/productMetricHistory";
import type { Product, ProductMetricYearDocument } from "../types";

const argument = (key: string) => process.argv.find((value) => value.startsWith(`${key}=`))?.slice(key.length + 1);
async function main() {
  const project = argument("--project");
  if (!project || project !== process.env.GCLOUD_PROJECT || (process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_PROJECT !== project)) throw new Error("--project must match the explicit GCLOUD_PROJECT environment");
  if (process.env.FIRESTORE_EMULATOR_HOST && !project.startsWith("demo-")) throw new Error("Use a demo project for local verification");
  const ids = [...new Set((argument("--product-ids") ?? "").split(",").filter(Boolean))];
  if (!ids.length || ids.length > 50 || ids.some((id) => id.includes("/"))) throw new Error("Specify 1-50 explicit --product-ids; no collection scan is performed");
  const apply = process.argv.includes("--apply");
  if (apply && !writesMetricYears()) throw new Error("Backfill requires METRIC_HISTORY_WRITE_MODE=year or dual");
  if (apply && argument("--confirm-project") !== project) throw new Error("--apply requires --confirm-project matching --project");
  const processProducts = async () => {
    for (const id of ids) {
      const ref = db.collection("products").doc(id);
      // The same transaction validates the source product and year point again
      // before applying a previewed correction, so concurrent updates cannot win silently.
      const result = await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref);
        if (!snapshot.exists) return { productId: id, status: "missing_product" };
        const product = snapshot.data() as Product;
        const date = product.releaseDate?.slice(0, 10).replaceAll("-", "");
        if (!date || !/^\d{8}$/.test(date)) return { productId: id, status: "invalid_release_date" };
        const yearRef = ref.collection("metricYears").doc(date.slice(0, 4));
        const year = await tx.get(yearRef);
        const metric = year.exists ? decodeMetricYear(year.data()! as ProductMetricYearDocument).get(date) : undefined;
        const plan = metric ? planReleaseDayBackfill(product, metric) : undefined;
        if (!plan || !metric) return { productId: id, status: "no_unambiguous_evidence_or_already_confirmed" };
        if (apply) {
          tx.set(ref, plan.productPatch, { merge: true });
          if (writesLegacyMetrics()) tx.set(ref.collection("dailyMetrics").doc(date), plan.metricPatch, { merge: true });
          if (writesMetricYears()) for (const mutation of buildMetricYearMutations(product, [{ date, metric: { ...metric, ...plan.metricPatch } }])) tx.set(ref.collection("metricYears").doc(mutation.year), mutation.data, { merge: true });
        }
        return { productId: id, status: apply ? "applied" : "preview", date, before: metric.dailySalesCount ?? null, after: plan.metricPatch.dailySalesCount, observedAt: metric.fetchedAt.toDate().toISOString() };
      });
      console.log(JSON.stringify(result));
    }
  };
  if (apply) await withGenreSourceMutation(processProducts); else await processProducts();
}
main().then(() => db.terminate()).catch((error) => { console.error(error); process.exitCode = 1; });
