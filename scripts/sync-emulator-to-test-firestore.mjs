#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const EMULATOR_PROJECT = process.env.LOCAL_FIREBASE_PROJECT || "doujin-info-mvp";
const TARGET_PROJECT = process.env.TEST_FIREBASE_PROJECT || "doujin-info-mvp";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8081";
const CONFIRMATION = process.argv.find((argument) => argument.startsWith("--confirm-target="))
  ?.slice("--confirm-target=".length);
const DRY_RUN = process.argv.includes("--dry-run");
const PAGE_SIZE = 250;
const REQUEST_RETRY_LIMIT = 5;

const DESCENDANT_COLLECTION_IDS = [
  "batchRuns",
  "chunks",
  "dailyMetrics",
  "debugDlsiteProductHtml",
  "homeDashboardListViewScopes",
  "homeDashboardListViewSections",
  "homeDashboardListViewVersions",
  "items",
  "metricYears",
  "lists",
  "newListViewBlocks",
  "newListViewLists",
  "newListViewVersions",
  "productDiscoveries",
  "rankingListViewBlocks",
  "rankingListViewLists",
  "rankingListViewVersions",
  "saleListViewBlocks",
  "saleListViewLists",
  "saleListViewVersions",
  "sellerListViewBlocks",
  "sellerListViewLists",
  "sellerListViewVersions",
  "syncStates",
  "versions",
  "views",
];

function assertSafeTarget() {
  if (TARGET_PROJECT !== "doujin-info-mvp") {
    throw new Error(`送信先はテストproject doujin-info-mvpだけ許可されています: ${TARGET_PROJECT}`);
  }
  if (/prod/i.test(TARGET_PROJECT) || TARGET_PROJECT === "doujin-info-prod") {
    throw new Error(`本番projectへの書込みは禁止されています: ${TARGET_PROJECT}`);
  }
  if (!DRY_RUN && CONFIRMATION !== TARGET_PROJECT) {
    throw new Error("実行には --confirm-target=doujin-info-mvp が必要です。");
  }
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/i.test(EMULATOR_HOST)) {
    throw new Error(`読取元はローカルEmulatorだけ許可されています: ${EMULATOR_HOST}`);
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
  if (candidates.length === 0) {
    throw new Error("firebase-toolsが見つかりません。先にnpx firebase-tools@latest --versionを実行してください。");
  }
  return candidates[0].path;
}

function databasePath(projectId) {
  return `projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(DATABASE_ID)}`;
}

function emulatorUrl(path) {
  return `http://${EMULATOR_HOST}/v1/${path}`;
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
      const response = await fetch(url, options);
      if ((response.status === 429 || response.status >= 500) && attempt < REQUEST_RETRY_LIMIT) {
        await response.text();
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      return await readJson(response, operation);
    } catch (error) {
      if (attempt === REQUEST_RETRY_LIMIT || (error.status && error.status < 500 && error.status !== 429)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${operation} failed after retries`);
}

function authHeaders(accessToken, emulator = false) {
  return {
    authorization: `Bearer ${emulator ? "owner" : accessToken}`,
    "content-type": "application/json",
  };
}

async function listRootCollectionIds({ projectId, accessToken, emulator }) {
  const collectionIds = [];
  let pageToken;
  do {
    const path = `${databasePath(projectId)}/documents:listCollectionIds`;
    const body = await requestJson(
      emulator ? emulatorUrl(path) : cloudUrl(path),
      {
        method: "POST",
        headers: authHeaders(accessToken, emulator),
        body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
      },
      `${emulator ? "emulator" : "test"} listCollectionIds`,
    );
    collectionIds.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return collectionIds;
}

async function fetchCollectionPage({ projectId, accessToken, emulator, collectionId, startAfterName }) {
  const path = `${databasePath(projectId)}/documents:runQuery`;
  const body = await requestJson(
    emulator ? emulatorUrl(path) : cloudUrl(path),
    {
      method: "POST",
      headers: authHeaders(accessToken, emulator),
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId, allDescendants: true }],
          orderBy: [{ field: { fieldPath: "__name__" }, direction: "ASCENDING" }],
          limit: PAGE_SIZE,
          ...(startAfterName
            ? { startAt: { values: [{ referenceValue: startAfterName }], before: false } }
            : {}),
        },
      }),
    },
    `${emulator ? "emulator" : "test"} runQuery(${collectionId})`,
  );
  return body.flatMap((result) => (result.document ? [result.document] : []));
}

async function* readCollectionGroup(options) {
  let startAfterName;
  while (true) {
    const documents = await fetchCollectionPage({ ...options, startAfterName });
    for (const document of documents) yield document;
    if (documents.length < PAGE_SIZE) return;
    startAfterName = documents.at(-1).name;
  }
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, normalize(child)]),
  );
}

function documentHash(document) {
  return createHash("sha256").update(JSON.stringify(normalize(document.fields || {}))).digest("hex");
}

function chunkWrites(writes) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const write of writes) {
    const bytes = Buffer.byteLength(JSON.stringify(write));
    if (current.length > 0 && (current.length >= 400 || currentBytes + bytes > 8_000_000)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(write);
    currentBytes += bytes;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

async function sendWrites(accessToken, writes, operation) {
  for (const [index, chunk] of chunkWrites(writes).entries()) {
    const body = await requestJson(
      cloudUrl(`${databasePath(TARGET_PROJECT)}/documents:batchWrite`),
      {
        method: "POST",
        headers: authHeaders(accessToken, false),
        body: JSON.stringify({ writes: chunk }),
      },
      `${operation} ${index + 1}`,
    );
    const failures = (body.status || []).filter((status) => Number(status.code || 0) !== 0);
    if (failures.length > 0) throw new Error(`${operation} returned write failures: ${JSON.stringify(failures)}`);
  }
}

async function main() {
  assertSafeTarget();
  const firebaseToolsRoot = findFirebaseToolsRoot();
  const auth = require(join(firebaseToolsRoot, "lib", "auth.js"));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLIへログインしてください。");
  const token = await auth.getAccessToken(account.tokens.refresh_token, [
    "https://www.googleapis.com/auth/cloud-platform",
  ]);
  const accessToken = token.access_token;

  const [sourceRoots, targetRoots] = await Promise.all([
    listRootCollectionIds({ projectId: EMULATOR_PROJECT, accessToken, emulator: true }),
    listRootCollectionIds({ projectId: TARGET_PROJECT, accessToken, emulator: false }),
  ]);
  const collectionIds = [...new Set([...sourceRoots, ...targetRoots, ...DESCENDANT_COLLECTION_IDS])].sort();
  const expected = new Map();
  const seenSource = new Set();
  let copied = 0;

  console.log(`Source: emulator ${EMULATOR_PROJECT}/${DATABASE_ID} @ ${EMULATOR_HOST}`);
  console.log(`Target: TEST ONLY ${TARGET_PROJECT}/${DATABASE_ID}`);
  console.log(`Firebase account: ${account.user.email}`);
  console.log(DRY_RUN ? "Mode: dry-run (no writes/deletes)" : "Mode: synchronize and verify");

  for (const collectionId of collectionIds) {
    let collectionCount = 0;
    let pending = [];
    for await (const document of readCollectionGroup({
      projectId: EMULATOR_PROJECT,
      accessToken,
      emulator: true,
      collectionId,
    })) {
      if (seenSource.has(document.name)) continue;
      seenSource.add(document.name);
      expected.set(document.name, documentHash(document));
      collectionCount += 1;
      copied += 1;
      if (!DRY_RUN) {
        pending.push({ update: { name: document.name, fields: document.fields || {} } });
        if (pending.length >= 400) {
          await sendWrites(accessToken, pending, `copy ${collectionId}`);
          pending = [];
        }
      }
      if (copied % 50_000 === 0) console.log(`source: ${copied.toLocaleString()} documents`);
    }
    if (!DRY_RUN && pending.length > 0) await sendWrites(accessToken, pending, `copy ${collectionId}`);
    if (collectionCount > 0) console.log(`${collectionId}: ${collectionCount.toLocaleString()}`);
  }

  let targetCount = 0;
  let deleted = 0;
  let missing = 0;
  let mismatched = 0;
  const seenTarget = new Set();
  for (const collectionId of collectionIds) {
    let pendingDeletes = [];
    for await (const document of readCollectionGroup({
      projectId: TARGET_PROJECT,
      accessToken,
      emulator: false,
      collectionId,
    })) {
      if (seenTarget.has(document.name)) continue;
      seenTarget.add(document.name);
      targetCount += 1;
      const expectedHash = expected.get(document.name);
      if (!expectedHash) {
        deleted += 1;
        if (!DRY_RUN) {
          pendingDeletes.push({ delete: document.name });
          if (pendingDeletes.length >= 400) {
            await sendWrites(accessToken, pendingDeletes, `delete stale ${collectionId}`);
            pendingDeletes = [];
          }
        }
      } else if (expectedHash !== documentHash(document)) {
        mismatched += 1;
      }
      expected.delete(document.name);
    }
    if (!DRY_RUN && pendingDeletes.length > 0) {
      await sendWrites(accessToken, pendingDeletes, `delete stale ${collectionId}`);
    }
  }
  missing = expected.size;

  const result = {
    sourceDocuments: copied,
    targetDocumentsBeforeStaleCleanup: targetCount,
    staleDocuments: deleted,
    missingDocuments: missing,
    mismatchedDocuments: mismatched,
    ok: DRY_RUN || (missing === 0 && mismatched === 0),
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error("テストFirestoreの全件照合に失敗しました。");
  if (!DRY_RUN) console.log("Test Firestore matches the verified local emulator dataset.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
