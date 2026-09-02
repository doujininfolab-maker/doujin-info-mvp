import assert from "node:assert/strict";
import { rebuildSiteStatsForTargetsDetailed } from "../batch/rebuildSiteStats";

function mib(value: number): number {
  return Number((value / 1024 / 1024).toFixed(2));
}

async function run(): Promise<void> {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  assert.match(
    emulatorHost,
    /^(127\.0\.0\.1|localhost):\d+$/,
    "Firestore Emulator is required",
  );
  assert.notEqual(
    process.env.GCLOUD_PROJECT,
    "doujin-info-prod",
    "Production project is forbidden",
  );
  assert.equal(
    process.env.SEARCH_INDEX_WRITE_MODE,
    "dual",
    "This rollout validation must exercise dual write",
  );

  const before = process.memoryUsage();
  const startedAt = Date.now();
  const result = await rebuildSiteStatsForTargetsDetailed([
    { platform: "dlsite", audience: "female", category: "doujin" },
  ]);
  const after = process.memoryUsage();
  assert.equal(result.status, "success", JSON.stringify(result, null, 2));
  assert.ok(
    result.segments.every((segment) =>
      Object.values(segment.components).every(
        (component) => component.status === "success",
      ),
    ),
    "Every rebuild component must succeed",
  );

  console.log(JSON.stringify({
    emulatorHost,
    elapsedMs: Date.now() - startedAt,
    result,
    memory: {
      beforeRssMiB: mib(before.rss),
      afterRssMiB: mib(after.rss),
      afterHeapUsedMiB: mib(after.heapUsed),
      processMaxRssMiB: mib(process.resourceUsage().maxRSS * 1024),
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
