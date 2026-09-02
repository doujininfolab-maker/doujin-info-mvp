#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(join(process.cwd(), "web", "package.json"));
const { getApps, initializeApp } = require("firebase-admin/app");
const { FieldPath, Timestamp, getFirestore } = require("firebase-admin/firestore");

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8081";
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || "doujin-info-mvp";
const VERIFY_ONLY = process.argv.includes("--verify-only");
const MIGRATE_ONLY = process.argv.includes("--migrate-only");
const WRITE_BATCH_SIZE = 200;
const READ_PAGE_SIZE = 5_000;
const READ_RETRY_LIMIT = 4;
const POINT_FIELDS = [
  "priceCurrent",
  "priceOriginal",
  "salesCount",
  "dailySalesCount",
  "dailySalesStatus",
  "dailySalesBaseDate",
  "dailySalesNextDate",
  "dailySalesBaseCount",
  "dailySalesNextCount",
  "dailySalesRawDelta",
  "dailySalesPeriodDays",
  "periodSalesCount",
  "dailySalesCalculatedAt",
  "fetchedAt",
];

function assertLocalOnly() {
  const host = EMULATOR_HOST.toLowerCase();
  const isLoopback = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host);
  if (!isLoopback) {
    throw new Error(`ローカルFirestore Emulator以外には実行できません: ${EMULATOR_HOST}`);
  }
  if (/prod/i.test(PROJECT_ID) || PROJECT_ID === "doujin-info-prod") {
    throw new Error(`本番project IDには実行できません: ${PROJECT_ID}`);
  }
  process.env.FIRESTORE_EMULATOR_HOST = EMULATOR_HOST;
}

function normalizeValue(value) {
  if (value && typeof value.toMillis === "function") {
    return { __timestampMillis: value.toMillis() };
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeValue(child)]),
    );
  }
  return value;
}

function toPoint(metric) {
  return Object.fromEntries(
    POINT_FIELDS
      .filter((field) => metric[field] !== undefined)
      .map((field) => [field, metric[field]]),
  );
}

function pointHash(point) {
  return createHash("sha256")
    .update(JSON.stringify(normalizeValue(point)))
    .digest("hex");
}

function isValidDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

async function sourceMetadata(metricSnapshot, metric, cache) {
  if (metric.platform && metric.audience && metric.category) {
    return {
      platform: metric.platform,
      audience: metric.audience,
      category: metric.category,
    };
  }
  const productRef = metricSnapshot.ref.parent.parent;
  if (!productRef) throw new Error(`親商品が取得できません: ${metricSnapshot.ref.path}`);
  let metadata = cache.get(productRef.path);
  if (!metadata) {
    const productSnapshot = await productRef.get();
    const product = productSnapshot.data() || {};
    metadata = {
      platform: product.platform,
      audience: product.audience,
      category: product.category,
    };
    cache.set(productRef.path, metadata);
  }
  if (!metadata.platform || !metadata.audience || !metadata.category) {
    throw new Error(`商品分類が不足しています: ${productRef.path}`);
  }
  return metadata;
}

async function flushMutations(db, mutations) {
  if (mutations.size === 0) return 0;
  const batch = db.batch();
  for (const mutation of mutations.values()) {
    batch.set(mutation.ref, mutation.data, { merge: true });
  }
  await batch.commit();
  const count = mutations.size;
  mutations.clear();
  return count;
}

async function* readQueryInPages(baseQuery) {
  let cursor;
  while (true) {
    let snapshot;
    for (let attempt = 1; attempt <= READ_RETRY_LIMIT; attempt += 1) {
      try {
        const page = cursor ? baseQuery.startAfter(cursor) : baseQuery;
        snapshot = await page.limit(READ_PAGE_SIZE).get();
        break;
      } catch (error) {
        if (attempt === READ_RETRY_LIMIT) throw error;
        console.warn(`read page failed; retry ${attempt}/${READ_RETRY_LIMIT - 1}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    if (!snapshot || snapshot.empty) return;
    for (const document of snapshot.docs) yield document;
    cursor = snapshot.docs.at(-1);
    if (snapshot.size < READ_PAGE_SIZE) return;
  }
}

async function loadSourceAndMigrate(db) {
  const expected = new Map();
  const mutations = new Map();
  const metadataCache = new Map();
  let sourceCount = 0;
  let writeCount = 0;

  const query = db.collectionGroup("dailyMetrics").orderBy(FieldPath.documentId());
  for await (const snapshot of readQueryInPages(query)) {
    const productRef = snapshot.ref.parent.parent;
    if (!productRef) continue;
    const metric = snapshot.data();
    const date = metric.date || snapshot.id;
    if (!isValidDate(date)) throw new Error(`不正な日付です: ${snapshot.ref.path}`);
    const year = date.slice(0, 4);
    const dayKey = date.slice(4);
    const destinationRef = productRef.collection("metricYears").doc(year);
    const point = toPoint(metric);
    expected.set(`${productRef.id}/${date}`, pointHash(point));
    sourceCount += 1;

    if (!VERIFY_ONLY) {
      const metadata = await sourceMetadata(snapshot, metric, metadataCache);
      const key = destinationRef.path;
      const current = mutations.get(key) || {
        ref: destinationRef,
        data: {
          schemaVersion: 1,
          year,
          ...metadata,
          points: {},
          updatedAt: metric.fetchedAt || metric.dailySalesCalculatedAt || Timestamp.now(),
        },
      };
      current.data.points[dayKey] = point;
      current.data.updatedAt = metric.fetchedAt || metric.dailySalesCalculatedAt || current.data.updatedAt;
      mutations.set(key, current);
      if (mutations.size >= WRITE_BATCH_SIZE) {
        writeCount += await flushMutations(db, mutations);
      }
    }

    if (sourceCount % 50_000 === 0) {
      console.log(`source: ${sourceCount.toLocaleString()} documents`);
    }
  }
  writeCount += await flushMutations(db, mutations);
  return { expected, sourceCount, writeCount };
}

async function verifyDestination(db, expected) {
  let yearDocumentCount = 0;
  let pointCount = 0;
  let mismatchCount = 0;
  let extraCount = 0;
  let maxJsonBytes = 0;
  let totalJsonBytes = 0;
  const samples = [];

  const query = db.collectionGroup("metricYears").orderBy(FieldPath.documentId());
  for await (const snapshot of readQueryInPages(query)) {
    yearDocumentCount += 1;
    const document = snapshot.data();
    const jsonBytes = Buffer.byteLength(JSON.stringify(normalizeValue(document)));
    maxJsonBytes = Math.max(maxJsonBytes, jsonBytes);
    totalJsonBytes += jsonBytes;
    const productRef = snapshot.ref.parent.parent;
    if (!productRef) continue;
    for (const [dayKey, point] of Object.entries(document.points || {})) {
      const date = `${document.year || snapshot.id}${dayKey}`;
      const key = `${productRef.id}/${date}`;
      const expectedHash = expected.get(key);
      if (!expectedHash) {
        extraCount += 1;
        if (samples.length < 20) samples.push({ key, reason: "extra" });
      } else if (expectedHash !== pointHash(point)) {
        mismatchCount += 1;
        if (samples.length < 20) samples.push({ key, reason: "mismatch" });
      }
      expected.delete(key);
      pointCount += 1;
    }
  }

  const missingCount = expected.size;
  for (const key of expected.keys()) {
    if (samples.length >= 20) break;
    samples.push({ key, reason: "missing" });
  }
  return {
    yearDocumentCount,
    pointCount,
    missingCount,
    mismatchCount,
    extraCount,
    averageJsonBytes: yearDocumentCount > 0
      ? Math.round(totalJsonBytes / yearDocumentCount)
      : 0,
    maxJsonBytes,
    samples,
    ok: missingCount === 0 && mismatchCount === 0 && extraCount === 0,
  };
}

async function main() {
  assertLocalOnly();
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });

  console.log(`Emulator: ${EMULATOR_HOST}`);
  console.log(`Project: ${PROJECT_ID}`);
  console.log(VERIFY_ONLY ? "Mode: verify only" : MIGRATE_ONLY ? "Mode: migrate only" : "Mode: migrate and verify");

  const source = await loadSourceAndMigrate(db);
  console.log(`Source points: ${source.sourceCount.toLocaleString()}`);
  console.log(`Metric-year writes: ${source.writeCount.toLocaleString()}`);
  if (MIGRATE_ONLY) return;

  const verification = await verifyDestination(db, source.expected);
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.ok) {
    throw new Error("年次履歴の全件照合に失敗しました。");
  }
  console.log("All metric-year points match the legacy daily metrics.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
