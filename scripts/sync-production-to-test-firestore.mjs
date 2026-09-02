#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const SOURCE_PROJECT = "doujin-info-prod";
const TARGET_PROJECT = "doujin-info-mvp";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const CONFIRMATION = process.argv.find((value) => value.startsWith("--confirm-target="))
  ?.slice("--confirm-target=".length);
const DRY_RUN = process.argv.includes("--dry-run");
const VERIFY_CLEANUP_ONLY = process.argv.includes("--verify-cleanup-only");
const PAGE_SIZE = 250;
const REQUEST_RETRY_LIMIT = 6;
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
const DESCENDANT_COLLECTION_IDS = [
  "batchRuns", "chunks", "dailyMetrics", "debugDlsiteProductHtml",
  "homeDashboardListViewScopes", "homeDashboardListViewSections",
  "homeDashboardListViewVersions", "items", "metricYears", "lists",
  "newListViewBlocks", "newListViewLists", "newListViewVersions",
  "productDiscoveries", "rankingListViewBlocks", "rankingListViewLists",
  "rankingListViewVersions", "saleListViewBlocks", "saleListViewLists",
  "saleListViewVersions", "sellerListViewBlocks", "sellerListViewLists",
  "sellerListViewVersions", "syncStates", "versions", "views",
];

function assertSafeProjects() {
  if (SOURCE_PROJECT !== "doujin-info-prod") throw new Error(`Unexpected source: ${SOURCE_PROJECT}`);
  if (TARGET_PROJECT !== "doujin-info-mvp" || /prod/i.test(TARGET_PROJECT)) {
    throw new Error(`本番への書込みを拒否しました: ${TARGET_PROJECT}`);
  }
  if (SOURCE_PROJECT === TARGET_PROJECT) throw new Error("Source and target must differ.");
  if (!DRY_RUN && CONFIRMATION !== TARGET_PROJECT) {
    throw new Error("実行には --confirm-target=doujin-info-mvp が必要です。");
  }
}

function findFirebaseToolsRoot() {
  const explicitRoot = process.env.FIREBASE_TOOLS_ROOT;
  if (explicitRoot && existsSync(join(explicitRoot, "lib", "auth.js"))) return explicitRoot;
  const npmCache = process.env.npm_config_cache ||
    (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "npm-cache") : undefined) ||
    execFileSync("npm", ["config", "get", "cache"], { encoding: "utf8", windowsHide: true }).trim();
  const npxCache = join(npmCache, "_npx");
  const candidates = existsSync(npxCache)
    ? readdirSync(npxCache, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(npxCache, entry.name, "node_modules", "firebase-tools"))
      .filter((path) => existsSync(join(path, "lib", "auth.js")))
      .map((path) => ({
        path,
        version: JSON.parse(readFileSync(join(path, "package.json"), "utf8")).version || "0.0.0",
      }))
      .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))
    : [];
  if (candidates.length === 0) throw new Error("firebase-toolsが見つかりません。");
  return candidates[0].path;
}

function databasePath(projectId) {
  return `projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(DATABASE_ID)}`;
}

function cloudUrl(path) {
  return `https://firestore.googleapis.com/v1/${path}`;
}

async function readJson(response, operation) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const error = new Error(`${operation} failed (${response.status}): ${JSON.stringify(body)}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

async function requestJson(url, options, operation) {
  for (let attempt = 1; attempt <= REQUEST_RETRY_LIMIT; attempt += 1) {
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(120_000) });
      if ((response.status === 429 || response.status >= 500) && attempt < REQUEST_RETRY_LIMIT) {
        await response.text();
        console.warn(`${operation} failed (${response.status}); retry ${attempt}/${REQUEST_RETRY_LIMIT - 1}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      return await readJson(response, operation);
    } catch (error) {
      if (attempt === REQUEST_RETRY_LIMIT || (error.status && error.status < 500 && error.status !== 429)) throw error;
      console.warn(`${operation} connection failed; retry ${attempt}/${REQUEST_RETRY_LIMIT - 1}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${operation} failed after retries`);
}

function headers(accessToken) {
  return { authorization: `Bearer ${accessToken}`, "content-type": "application/json" };
}

async function listRootCollectionIds(projectId, accessToken) {
  const result = [];
  let pageToken;
  do {
    const body = await requestJson(
      cloudUrl(`${databasePath(projectId)}/documents:listCollectionIds`),
      {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
      },
      `listCollectionIds(${projectId})`,
    );
    result.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return result;
}

async function* readCollectionGroup(projectId, accessToken, collectionId, pageSize = PAGE_SIZE) {
  let startAfterName;
  while (true) {
    const body = await requestJson(
      cloudUrl(`${databasePath(projectId)}/documents:runQuery`),
      {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId, allDescendants: true }],
            orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
            limit: pageSize,
            ...(startAfterName
              ? { startAt: { values: [{ referenceValue: startAfterName }], before: false } }
              : {}),
          },
        }),
      },
      `runQuery(${projectId}/${collectionId})`,
    );
    const documents = body.flatMap((item) => (item.document ? [item.document] : []));
    for (const document of documents) yield document;
    if (documents.length < pageSize) return;
    startAfterName = documents.at(-1).name;
  }
}

function rewriteValue(value) {
  if (Array.isArray(value)) return value.map(rewriteValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === "referenceValue" && typeof child === "string"
      ? child.replace(
        `projects/${SOURCE_PROJECT}/databases/${DATABASE_ID}/documents/`,
        `projects/${TARGET_PROJECT}/databases/${DATABASE_ID}/documents/`,
      )
      : rewriteValue(child),
  ]));
}

function toTargetDocument(document) {
  const sourcePrefix = `projects/${SOURCE_PROJECT}/databases/${DATABASE_ID}/documents/`;
  const targetPrefix = `projects/${TARGET_PROJECT}/databases/${DATABASE_ID}/documents/`;
  if (!document.name.startsWith(sourcePrefix)) throw new Error(`Unexpected source name: ${document.name}`);
  return {
    name: document.name.replace(sourcePrefix, targetPrefix),
    fields: rewriteValue(document.fields || {}),
  };
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, normalize(child)]));
}

function hashFields(fields) {
  return createHash("sha256").update(JSON.stringify(normalize(fields || {}))).digest("hex");
}

function chunkWrites(writes) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const write of writes) {
    const bytes = Buffer.byteLength(JSON.stringify(write));
    if (current.length && (current.length >= 400 || currentBytes + bytes > 8_000_000)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(write);
    currentBytes += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function sendWrites(accessToken, writes, operation) {
  for (const [index, chunk] of chunkWrites(writes).entries()) {
    const body = await requestJson(
      cloudUrl(`${databasePath(TARGET_PROJECT)}/documents:batchWrite`),
      {
        method: "POST",
        headers: headers(accessToken),
        body: JSON.stringify({ writes: chunk }),
      },
      `${operation} ${index + 1}`,
    );
    const failures = (body.status || []).filter((status) => Number(status.code || 0) !== 0);
    if (failures.length) throw new Error(`${operation} failures: ${JSON.stringify(failures)}`);
  }
}

function productIdFromDocumentName(name) {
  const marker = "/documents/products/";
  const index = name.indexOf(marker);
  if (index < 0) return undefined;
  return name.slice(index + marker.length).split("/")[0];
}

function dailyMetricIdentity(document) {
  const relative = document.name.split("/documents/")[1] || "";
  const segments = relative.split("/");
  if (segments.length !== 4 || segments[0] !== "products" || segments[2] !== "dailyMetrics") {
    throw new Error(`Unexpected dailyMetrics path: ${document.name}`);
  }
  const date = document.fields?.date?.stringValue || segments[3];
  if (!/^\d{8}$/.test(date)) throw new Error(`Invalid metric date: ${document.name}`);
  return { productId: segments[1], date, year: date.slice(0, 4), dayKey: date.slice(4) };
}

function makeMetricYearDocument(productId, year, metadata, points, updatedAt) {
  return {
    name: `projects/${TARGET_PROJECT}/databases/${DATABASE_ID}/documents/products/${productId}/metricYears/${year}`,
    fields: {
      schemaVersion: { integerValue: "1" },
      year: { stringValue: year },
      platform: metadata.platform,
      audience: metadata.audience,
      category: metadata.category,
      points: { mapValue: { fields: points } },
      updatedAt: updatedAt || { timestampValue: new Date().toISOString() },
    },
  };
}

async function main() {
  assertSafeProjects();
  const firebaseToolsRoot = findFirebaseToolsRoot();
  const auth = require(join(firebaseToolsRoot, "lib", "auth.js"));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLIへログインしてください。");
  const scopes = ["https://www.googleapis.com/auth/cloud-platform"];
  const token = await auth.getAccessToken(account.tokens.refresh_token, scopes);
  let accessToken = token.access_token;

  const [sourceRoots, targetRoots] = await Promise.all([
    listRootCollectionIds(SOURCE_PROJECT, accessToken),
    listRootCollectionIds(TARGET_PROJECT, accessToken),
  ]);
  const allIds = [...new Set([...sourceRoots, ...targetRoots, ...DESCENDANT_COLLECTION_IDS])];
  const sourceIds = ["products", "dailyMetrics", ...allIds.filter((id) => id !== "products" && id !== "dailyMetrics" && id !== "metricYears").sort()];
  const validationIds = [...new Set([...sourceIds, "metricYears", ...targetRoots])].sort();
  const expected = new Map();
  const seenSource = new Set();
  const productMetadata = new Map();
  let sourceDocumentCount = 0;
  let generatedYearDocuments = 0;
  let generatedPoints = 0;

  console.log(`Source READ ONLY: ${SOURCE_PROJECT}/${DATABASE_ID}`);
  console.log(`Target TEST ONLY: ${TARGET_PROJECT}/${DATABASE_ID}`);
  console.log(`Firebase account: ${account.user.email}`);
  console.log(DRY_RUN
    ? "Mode: dry-run"
    : VERIFY_CLEANUP_ONLY
      ? "Mode: verify and remove stale test data without rewriting source documents"
      : "Mode: synchronize, remove stale test data, and verify");

  let activeYear;
  let yearWrites = [];
  async function flushYear() {
    if (!activeYear) return;
    const document = makeMetricYearDocument(
      activeYear.productId,
      activeYear.year,
      activeYear.metadata,
      activeYear.points,
      activeYear.updatedAt,
    );
    expected.set(document.name, hashFields(document.fields));
    generatedYearDocuments += 1;
    if (!DRY_RUN && !VERIFY_CLEANUP_ONLY) {
      yearWrites.push({ update: document });
      if (yearWrites.length >= 200) {
        await sendWrites(accessToken, yearWrites, "write metricYears");
        yearWrites = [];
      }
    }
    activeYear = undefined;
  }

  for (const collectionId of sourceIds) {
    let collectionCount = 0;
    let pending = [];
    for await (const sourceDocument of readCollectionGroup(SOURCE_PROJECT, accessToken, collectionId)) {
      const document = toTargetDocument(sourceDocument);
      if (seenSource.has(document.name)) continue;
      seenSource.add(document.name);
      expected.set(document.name, hashFields(document.fields));
      collectionCount += 1;
      sourceDocumentCount += 1;

      if (collectionId === "products") {
        const productId = productIdFromDocumentName(document.name);
        if (productId) {
          productMetadata.set(productId, {
            platform: document.fields.platform,
            audience: document.fields.audience,
            category: document.fields.category,
          });
        }
      } else if (collectionId === "dailyMetrics") {
        const identity = dailyMetricIdentity(document);
        if (!activeYear || activeYear.productId !== identity.productId || activeYear.year !== identity.year) {
          await flushYear();
          const metadata = productMetadata.get(identity.productId);
          if (!metadata?.platform || !metadata?.audience || !metadata?.category) {
            throw new Error(`Product metadata missing: ${identity.productId}`);
          }
          activeYear = { productId: identity.productId, year: identity.year, metadata, points: {}, updatedAt: undefined };
        }
        const pointFields = Object.fromEntries(POINT_FIELDS
          .filter((field) => document.fields[field] !== undefined)
          .map((field) => [field, document.fields[field]]));
        activeYear.points[identity.dayKey] = { mapValue: { fields: pointFields } };
        activeYear.updatedAt = document.fields.fetchedAt || document.fields.dailySalesCalculatedAt || activeYear.updatedAt;
        generatedPoints += 1;
      }

      if (!DRY_RUN && !VERIFY_CLEANUP_ONLY) {
        pending.push({ update: document });
        if (pending.length >= 400) {
          await sendWrites(accessToken, pending, `copy ${collectionId}`);
          pending = [];
        }
      }
      if (sourceDocumentCount % 50_000 === 0) console.log(`source: ${sourceDocumentCount.toLocaleString()} documents`);
    }
    if (collectionId === "dailyMetrics") await flushYear();
    if (!DRY_RUN && !VERIFY_CLEANUP_ONLY && pending.length) {
      await sendWrites(accessToken, pending, `copy ${collectionId}`);
    }
    if (collectionCount) console.log(`${collectionId}: ${collectionCount.toLocaleString()}`);
  }
  if (!DRY_RUN && !VERIFY_CLEANUP_ONLY && yearWrites.length) {
    await sendWrites(accessToken, yearWrites, "write metricYears");
  }

  const refreshedToken = await auth.getAccessToken(account.tokens.refresh_token, scopes);
  accessToken = refreshedToken.access_token;
  console.log("Authentication refreshed before target verification.");

  let targetDocuments = 0;
  let staleDocuments = 0;
  let mismatchedDocuments = 0;
  const seenTarget = new Set();
  for (const collectionId of validationIds) {
    let deletes = [];
    const targetPageSize = collectionId === "chunks" ? 10 : PAGE_SIZE;
    for await (const document of readCollectionGroup(
      TARGET_PROJECT,
      accessToken,
      collectionId,
      targetPageSize,
    )) {
      if (seenTarget.has(document.name)) continue;
      seenTarget.add(document.name);
      targetDocuments += 1;
      const expectedHash = expected.get(document.name);
      if (!expectedHash) {
        staleDocuments += 1;
        if (!DRY_RUN) {
          deletes.push({ delete: document.name });
          if (deletes.length >= 400) {
            await sendWrites(accessToken, deletes, `delete stale ${collectionId}`);
            deletes = [];
          }
        }
      } else if (expectedHash !== hashFields(document.fields)) {
        mismatchedDocuments += 1;
      }
      expected.delete(document.name);
    }
    if (!DRY_RUN && deletes.length) await sendWrites(accessToken, deletes, `delete stale ${collectionId}`);
  }

  const result = {
    sourceDocuments: sourceDocumentCount,
    generatedYearDocuments,
    generatedPoints,
    expectedTestDocuments: sourceDocumentCount + generatedYearDocuments,
    targetDocumentsBeforeStaleCleanup: targetDocuments,
    staleDocuments,
    missingDocuments: expected.size,
    mismatchedDocuments,
    ok: DRY_RUN || (expected.size === 0 && mismatchedDocuments === 0),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error("テストFirestoreの全件ハッシュ照合に失敗しました。");
  if (!DRY_RUN) console.log("Test Firestore matches production plus generated metricYears.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
