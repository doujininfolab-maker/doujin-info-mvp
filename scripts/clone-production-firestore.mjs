#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const SOURCE_PROJECT = process.env.SOURCE_FIREBASE_PROJECT || "doujin-info-prod";
const DESTINATION_PROJECT = process.env.LOCAL_FIREBASE_PROJECT || "doujin-info-mvp";
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || "(default)";
const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8081";
const KEEP_EXISTING_DATA = process.argv.includes("--keep");
const REQUEST_RETRY_LIMIT = 6;
const skipArgument = process.argv.find((argument) => argument.startsWith("--skip="));
const SKIPPED_COLLECTION_IDS = new Set(
  (skipArgument?.slice("--skip=".length) || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

// Firestore has no API that lists every collection-group ID in one request.
// Root collections are discovered from production. These descendant collection
// IDs cover every subcollection used by this repository.
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

function findFirebaseToolsRoot() {
  const explicitRoot = process.env.FIREBASE_TOOLS_ROOT;
  if (explicitRoot && existsSync(join(explicitRoot, "lib", "auth.js"))) {
    return explicitRoot;
  }

  const configuredCache = process.env.npm_config_cache;
  const windowsCache = process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "npm-cache")
    : undefined;
  const npmCache = configuredCache || windowsCache || execFileSync("npm", ["config", "get", "cache"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const npxCache = join(npmCache, "_npx");
  if (!existsSync(npxCache)) {
    throw new Error("firebase-tools が見つかりません。先に npx firebase-tools@latest --version を実行してください。");
  }

  const candidates = readdirSync(npxCache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(npxCache, entry.name, "node_modules", "firebase-tools"))
    .filter((path) => existsSync(join(path, "lib", "auth.js")))
    .map((path) => {
      const packageJson = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      return { path, version: packageJson.version || "0.0.0" };
    })
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));

  if (candidates.length === 0) {
    throw new Error("firebase-tools が見つかりません。先に npx firebase-tools@latest --version を実行してください。");
  }
  return candidates[0].path;
}

function encodeDatabasePath(projectId) {
  return `projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(DATABASE_ID)}`;
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
        console.warn(`${operation} failed (${response.status}); retry ${attempt}/${REQUEST_RETRY_LIMIT - 1}`);
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
        continue;
      }
      return await readJson(response, operation);
    } catch (error) {
      if (attempt === REQUEST_RETRY_LIMIT || (error.status && error.status < 500 && error.status !== 429)) {
        throw error;
      }
      console.warn(`${operation} connection failed; retry ${attempt}/${REQUEST_RETRY_LIMIT - 1}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error(`${operation} failed after retries`);
}

async function fetchRootCollectionIds(accessToken) {
  const collectionIds = [];
  let pageToken;
  do {
    const body = await requestJson(
      `https://firestore.googleapis.com/v1/${encodeDatabasePath(SOURCE_PROJECT)}/documents:listCollectionIds`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ pageSize: 1000, ...(pageToken ? { pageToken } : {}) }),
      },
      "listCollectionIds",
    );
    collectionIds.push(...(body.collectionIds || []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return collectionIds;
}

async function fetchCollectionGroupPage(accessToken, collectionId, startAfterName) {
  const pageSize = 250;
  const body = await requestJson(
    `https://firestore.googleapis.com/v1/${encodeDatabasePath(SOURCE_PROJECT)}/documents:runQuery`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
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
    `runQuery(${collectionId})`,
  );
  return {
    documents: body.flatMap((result) => (result.document ? [result.document] : [])),
    pageSize,
  };
}

function rewriteReferences(value) {
  if (Array.isArray(value)) {
    return value.map(rewriteReferences);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const rewritten = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "referenceValue" && typeof child === "string") {
      rewritten[key] = child.replace(
        `projects/${SOURCE_PROJECT}/databases/${DATABASE_ID}/documents/`,
        `projects/${DESTINATION_PROJECT}/databases/${DATABASE_ID}/documents/`,
      );
    } else {
      rewritten[key] = rewriteReferences(child);
    }
  }
  return rewritten;
}

function toLocalDocument(document) {
  const sourcePrefix = `projects/${SOURCE_PROJECT}/databases/${DATABASE_ID}/documents/`;
  const destinationPrefix = `projects/${DESTINATION_PROJECT}/databases/${DATABASE_ID}/documents/`;
  if (!document.name.startsWith(sourcePrefix)) {
    throw new Error(`Unexpected source document name: ${document.name}`);
  }
  return {
    name: document.name.replace(sourcePrefix, destinationPrefix),
    fields: rewriteReferences(document.fields || {}),
  };
}

function chunkWrites(documents) {
  const chunks = [];
  let current = [];
  let currentBytes = 0;
  for (const document of documents) {
    const write = { update: toLocalDocument(document) };
    const bytes = Buffer.byteLength(JSON.stringify(write));
    if (current.length > 0 && (current.length >= 400 || currentBytes + bytes > 8_000_000)) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(write);
    currentBytes += bytes;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

async function clearEmulator() {
  await requestJson(
    `http://${EMULATOR_HOST}/emulator/v1/${encodeDatabasePath(DESTINATION_PROJECT)}/documents`,
    { method: "DELETE" },
    "clear emulator",
  );
}

async function writeToEmulator(documents) {
  const chunks = chunkWrites(documents);
  async function writeChunk(chunk, label) {
    try {
      await requestJson(
        `http://${EMULATOR_HOST}/v1/${encodeDatabasePath(DESTINATION_PROJECT)}/documents:batchWrite`,
        {
          method: "POST",
          headers: {
            authorization: "Bearer owner",
            "content-type": "application/json",
          },
          body: JSON.stringify({ writes: chunk }),
        },
        label,
      );
    } catch (error) {
      if (error.status === 400 && chunk.length > 1) {
        const middle = Math.ceil(chunk.length / 2);
        console.warn(`${label} rejected; splitting ${chunk.length} writes`);
        await writeChunk(chunk.slice(0, middle), `${label}a`);
        await writeChunk(chunk.slice(middle), `${label}b`);
        return;
      }
      if (chunk.length === 1) {
        console.error(`Rejected document: ${chunk[0].update?.name || chunk[0].delete || "unknown"}`);
      }
      throw error;
    }
  }
  for (let index = 0; index < chunks.length; index += 1) {
    await writeChunk(chunks[index], `batchWrite ${index + 1}/${chunks.length}`);
  }
}

async function main() {
  if (SOURCE_PROJECT === DESTINATION_PROJECT) {
    throw new Error("本番とローカルの project ID は別にしてください。");
  }

  const firebaseToolsRoot = findFirebaseToolsRoot();
  const auth = require(join(firebaseToolsRoot, "lib", "auth.js"));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) {
    throw new Error("Firebase CLI のログインがありません。firebase login を実行してください。");
  }

  const token = await auth.getAccessToken(account.tokens.refresh_token, [
    "https://www.googleapis.com/auth/cloud-platform",
  ]);
  const rootCollectionIds = await fetchRootCollectionIds(token.access_token);
  const collectionIds = [...new Set([...rootCollectionIds, ...DESCENDANT_COLLECTION_IDS])]
    .filter((collectionId) => !SKIPPED_COLLECTION_IDS.has(collectionId))
    .sort();

  console.log(`Source: ${SOURCE_PROJECT}/${DATABASE_ID}`);
  console.log(`Destination: ${DESTINATION_PROJECT}/${DATABASE_ID} @ ${EMULATOR_HOST}`);
  console.log(`Firebase account: ${account.user.email}`);
  if (KEEP_EXISTING_DATA) {
    console.log("Keeping existing local emulator data.");
  } else {
    console.log("Clearing local emulator data...");
    await clearEmulator();
  }

  const seenDocumentNames = new Set();
  let copied = 0;
  for (const collectionId of collectionIds) {
    let collectionCopied = 0;
    let startAfterName;
    while (true) {
      const page = await fetchCollectionGroupPage(
        token.access_token,
        collectionId,
        startAfterName,
      );
      const documents = page.documents.filter((document) => {
        if (seenDocumentNames.has(document.name)) {
          return false;
        }
        seenDocumentNames.add(document.name);
        return true;
      });
      if (documents.length > 0) {
        await writeToEmulator(documents);
        copied += documents.length;
        collectionCopied += documents.length;
      }
      if (page.documents.length < page.pageSize) {
        break;
      }
      startAfterName = page.documents.at(-1).name;
    }
    if (collectionCopied > 0) {
      console.log(`${collectionId}: ${collectionCopied}`);
    }
  }

  console.log(`Done. Copied ${copied} documents without modifying production.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
