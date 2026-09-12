#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PRODUCTION_PROJECT = "doujin-info-prod";
const DATABASE_ID = "(default)";
const PROJECT_ARGUMENT = argumentValue("--project=");
const CONFIRMATION = argumentValue("--confirm-project=");
const MODE_FLAGS = ["--dry-run", "--migrate", "--verify-only"].filter((flag) =>
  process.argv.includes(flag));
const PAGE_SIZE = 500;
const WRITE_BATCH_SIZE = 200;
const MAX_BATCH_BYTES = 8_000_000;
const REQUEST_RETRY_LIMIT = 6;
const TOKEN_REFRESH_MILLIS = 45 * 60 * 1000;
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
  "dailySalesCalculatedAt", "dailySalesBasis", "dailySalesObservedAt", "dailySalesDefinitionVersion",
  "fetchedAt",
];

function argumentValue(prefix) {
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function printUsage() {
  console.error([
    "Usage:",
    "  node scripts/migrate-production-metric-years.mjs --project=doujin-info-prod --dry-run",
    "  node scripts/migrate-production-metric-years.mjs --project=doujin-info-prod --verify-only",
    "  node scripts/migrate-production-metric-years.mjs --project=doujin-info-prod --confirm-project=doujin-info-prod --migrate",
  ].join("\n"));
}

function assertArguments() {
  if (MODE_FLAGS.length !== 1) {
    printUsage();
    throw new Error("--dry-run / --migrate / --verify-only のいずれか1つが必要です。");
  }
  if (PROJECT_ARGUMENT !== PRODUCTION_PROJECT) {
    throw new Error(`--project=${PRODUCTION_PROJECT} を明示してください。`);
  }
  if (MODE_FLAGS[0] === "--migrate" && CONFIRMATION !== PRODUCTION_PROJECT) {
    throw new Error(`本番書込みには --confirm-project=${PRODUCTION_PROJECT} が必要です。`);
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOSTが設定されています。本番移行では解除してください。");
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

function createTokenProvider(auth, account) {
  const scopes = ["https://www.googleapis.com/auth/cloud-platform"];
  let cached;
  let refreshAt = 0;
  return async (force = false) => {
    if (!force && cached && Date.now() < refreshAt) return cached;
    const token = await auth.getAccessToken(account.tokens.refresh_token, scopes);
    cached = token.access_token;
    refreshAt = Date.now() + TOKEN_REFRESH_MILLIS;
    return cached;
  };
}

function databasePath() {
  return `projects/${encodeURIComponent(PRODUCTION_PROJECT)}/databases/${encodeURIComponent(DATABASE_ID)}`;
}

function cloudUrl(path) {
  return `https://firestore.googleapis.com/v1/${path}`;
}

async function requestJson(tokenProvider, path, options, operation) {
  for (let attempt = 1; attempt <= REQUEST_RETRY_LIMIT; attempt += 1) {
    const accessToken = await tokenProvider(false);
    let response;
    try {
      response = await fetch(cloudUrl(path), {
        ...options,
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      if (attempt === REQUEST_RETRY_LIMIT) throw error;
      console.warn(`${operation}: connection retry ${attempt}/${REQUEST_RETRY_LIMIT - 1}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      continue;
    }
    const text = await response.text();
    const body = text ? JSON.parse(text) : undefined;
    if (response.ok) return body;
    if (response.status === 401 && attempt < REQUEST_RETRY_LIMIT) {
      await tokenProvider(true);
      continue;
    }
    if ((response.status === 429 || response.status >= 500) && attempt < REQUEST_RETRY_LIMIT) {
      console.warn(`${operation}: HTTP ${response.status}; retry ${attempt}/${REQUEST_RETRY_LIMIT - 1}`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      continue;
    }
    const error = new Error(`${operation} failed (${response.status}): ${JSON.stringify(body)}`);
    error.status = response.status;
    throw error;
  }
  throw new Error(`${operation} failed after retries`);
}

async function* readCollectionGroup(tokenProvider, collectionId) {
  let startAfterName;
  while (true) {
    const body = await requestJson(
      tokenProvider,
      `${databasePath()}/documents:runQuery`,
      {
        method: "POST",
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
      `read ${collectionId}`,
    );
    const documents = body.flatMap((item) => item.document ? [item.document] : []);
    for (const document of documents) yield document;
    if (documents.length < PAGE_SIZE) return;
    startAfterName = documents.at(-1).name;
  }
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, normalize(child)]));
}

function hashValue(value) {
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

function isValidDate(value) {
  if (!/^\d{8}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function dailyMetricIdentity(document) {
  const relative = document.name.split("/documents/")[1] || "";
  const segments = relative.split("/");
  if (segments.length !== 4 || segments[0] !== "products" || segments[2] !== "dailyMetrics") {
    throw new Error(`Unexpected dailyMetrics path: ${document.name}`);
  }
  const date = document.fields?.date?.stringValue || segments[3];
  if (!isValidDate(date)) throw new Error(`Invalid metric date: ${document.name}`);
  return { productId: segments[1], date, year: date.slice(0, 4), dayKey: date.slice(4) };
}

function metricYearIdentity(document) {
  const relative = document.name.split("/documents/")[1] || "";
  const segments = relative.split("/");
  if (segments.length !== 4 || segments[0] !== "products" || segments[2] !== "metricYears") {
    throw new Error(`Unexpected metricYears path: ${document.name}`);
  }
  return { productId: segments[1], year: segments[3] };
}

function pointFields(document) {
  return Object.fromEntries(POINT_FIELDS
    .filter((field) => document.fields?.[field] !== undefined)
    .map((field) => [field, document.fields[field]]));
}

function metadataFields(fields) {
  const metadata = {
    platform: fields?.platform,
    audience: fields?.audience,
    category: fields?.category,
  };
  if (!metadata.platform || !metadata.audience || !metadata.category) return undefined;
  return metadata;
}

function quoteFieldSegment(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ? value
    : `\`${value.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;
}

function makeMetricYearWrite(activeYear) {
  const pointPaths = Object.keys(activeYear.points)
    .sort()
    .map((dayKey) => `points.${quoteFieldSegment(dayKey)}`);
  return {
    update: {
      name: `${databasePath().replaceAll("%28", "(").replaceAll("%29", ")")}/documents/products/${activeYear.productId}/metricYears/${activeYear.year}`,
      fields: {
        schemaVersion: { integerValue: "1" },
        year: { stringValue: activeYear.year },
        ...activeYear.metadata,
        points: { mapValue: { fields: activeYear.points } },
        updatedAt: activeYear.updatedAt || { timestampValue: new Date().toISOString() },
      },
    },
    updateMask: {
      fieldPaths: [
        "schemaVersion", "year", "platform", "audience", "category", "updatedAt", ...pointPaths,
      ],
    },
  };
}

function chunkWrites(writes) {
  const chunks = [];
  let current = [];
  let bytes = 0;
  for (const write of writes) {
    const writeBytes = Buffer.byteLength(JSON.stringify(write));
    if (current.length && (current.length >= WRITE_BATCH_SIZE || bytes + writeBytes > MAX_BATCH_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = 0;
    }
    current.push(write);
    bytes += writeBytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

async function sendWrites(tokenProvider, writes) {
  for (const chunk of chunkWrites(writes)) {
    const body = await requestJson(
      tokenProvider,
      `${databasePath()}/documents:batchWrite`,
      { method: "POST", body: JSON.stringify({ writes: chunk }) },
      "write metricYears",
    );
    const failures = (body.status || []).filter((status) => Number(status.code || 0) !== 0);
    if (failures.length) throw new Error(`metricYears write failures: ${JSON.stringify(failures)}`);
  }
}

async function scanSource(tokenProvider, writeEnabled) {
  const expectedPoints = new Map();
  const expectedHeaders = new Map();
  let activeYear;
  let pendingWrites = [];
  let sourcePoints = 0;
  let yearDocuments = 0;
  let writeCount = 0;
  let maxJsonBytes = 0;

  async function flushYear() {
    if (!activeYear) return;
    const annualKey = `${activeYear.productId}/${activeYear.year}`;
    expectedHeaders.set(annualKey, hashValue({
      schemaVersion: { integerValue: "1" },
      year: { stringValue: activeYear.year },
      ...activeYear.metadata,
    }));
    const write = makeMetricYearWrite(activeYear);
    maxJsonBytes = Math.max(maxJsonBytes, Buffer.byteLength(JSON.stringify(write.update.fields)));
    yearDocuments += 1;
    if (writeEnabled) {
      pendingWrites.push(write);
      if (pendingWrites.length >= WRITE_BATCH_SIZE) {
        await sendWrites(tokenProvider, pendingWrites);
        writeCount += pendingWrites.length;
        pendingWrites = [];
      }
    }
    activeYear = undefined;
  }

  for await (const document of readCollectionGroup(tokenProvider, "dailyMetrics")) {
    const identity = dailyMetricIdentity(document);
    if (!activeYear || activeYear.productId !== identity.productId || activeYear.year !== identity.year) {
      await flushYear();
      const metadata = metadataFields(document.fields);
      if (!metadata) throw new Error(`Metric metadata missing: ${document.name}`);
      activeYear = {
        productId: identity.productId,
        year: identity.year,
        metadata,
        points: {},
        updatedAt: undefined,
      };
    }
    const point = pointFields(document);
    activeYear.points[identity.dayKey] = { mapValue: { fields: point } };
    activeYear.updatedAt = document.fields.fetchedAt ||
      document.fields.dailySalesCalculatedAt || activeYear.updatedAt;
    expectedPoints.set(`${identity.productId}/${identity.date}`, hashValue(point));
    sourcePoints += 1;
    if (sourcePoints % 50_000 === 0) {
      console.log(`dailyMetrics: ${sourcePoints.toLocaleString()} points`);
    }
  }
  await flushYear();
  if (writeEnabled && pendingWrites.length) {
    await sendWrites(tokenProvider, pendingWrites);
    writeCount += pendingWrites.length;
  }
  return { expectedPoints, expectedHeaders, sourcePoints, yearDocuments, writeCount, maxJsonBytes };
}

async function verifyDestination(tokenProvider, source) {
  let yearDocuments = 0;
  let destinationPoints = 0;
  let mismatchPoints = 0;
  let extraPoints = 0;
  let mismatchHeaders = 0;
  let extraYearDocuments = 0;
  let maxJsonBytes = 0;
  const samples = [];

  for await (const document of readCollectionGroup(tokenProvider, "metricYears")) {
    const identity = metricYearIdentity(document);
    const annualKey = `${identity.productId}/${identity.year}`;
    yearDocuments += 1;
    maxJsonBytes = Math.max(maxJsonBytes, Buffer.byteLength(JSON.stringify(document.fields || {})));
    const expectedHeaderHash = source.expectedHeaders.get(annualKey);
    if (!expectedHeaderHash) {
      extraYearDocuments += 1;
      if (samples.length < 20) samples.push({ key: annualKey, reason: "extra-year-document" });
    } else {
      const actualHeader = {
        schemaVersion: document.fields?.schemaVersion,
        year: document.fields?.year,
        platform: document.fields?.platform,
        audience: document.fields?.audience,
        category: document.fields?.category,
      };
      if (hashValue(actualHeader) !== expectedHeaderHash) {
        mismatchHeaders += 1;
        if (samples.length < 20) samples.push({ key: annualKey, reason: "header-mismatch" });
      }
      source.expectedHeaders.delete(annualKey);
    }
    const points = document.fields?.points?.mapValue?.fields || {};
    for (const [dayKey, pointValue] of Object.entries(points)) {
      const date = `${identity.year}${dayKey}`;
      const key = `${identity.productId}/${date}`;
      const expectedHash = source.expectedPoints.get(key);
      const point = pointValue?.mapValue?.fields || {};
      if (!expectedHash) {
        extraPoints += 1;
        if (samples.length < 20) samples.push({ key, reason: "extra-point" });
      } else if (hashValue(point) !== expectedHash) {
        mismatchPoints += 1;
        if (samples.length < 20) samples.push({ key, reason: "point-mismatch" });
      }
      source.expectedPoints.delete(key);
      destinationPoints += 1;
    }
  }

  const missingPoints = source.expectedPoints.size;
  const missingYearDocuments = source.expectedHeaders.size;
  for (const key of source.expectedPoints.keys()) {
    if (samples.length >= 20) break;
    samples.push({ key, reason: "missing-point" });
  }
  for (const key of source.expectedHeaders.keys()) {
    if (samples.length >= 20) break;
    samples.push({ key, reason: "missing-year-document" });
  }
  return {
    sourcePoints: source.sourcePoints,
    expectedYearDocuments: source.yearDocuments,
    yearDocuments,
    destinationPoints,
    missingPoints,
    mismatchPoints,
    extraPoints,
    missingYearDocuments,
    mismatchHeaders,
    extraYearDocuments,
    maxJsonBytes,
    samples,
    ok: missingPoints === 0 && mismatchPoints === 0 && extraPoints === 0 &&
      missingYearDocuments === 0 && mismatchHeaders === 0 && extraYearDocuments === 0,
  };
}

async function main() {
  assertArguments();
  const mode = MODE_FLAGS[0];
  const firebaseToolsRoot = findFirebaseToolsRoot();
  const auth = require(join(firebaseToolsRoot, "lib", "auth.js"));
  const account = auth.getGlobalDefaultAccount();
  if (!account?.tokens?.refresh_token) throw new Error("Firebase CLIへログインしてください。");
  const tokenProvider = createTokenProvider(auth, account);

  console.log(`Project: ${PRODUCTION_PROJECT}/${DATABASE_ID}`);
  console.log(`Firebase account: ${account.user.email}`);
  console.log(`Mode: ${mode.slice(2)}`);
  console.log("Delete operations: none");

  const source = await scanSource(tokenProvider, mode === "--migrate");
  console.log(JSON.stringify({
    sourcePoints: source.sourcePoints,
    expectedYearDocuments: source.yearDocuments,
    metricYearWrites: source.writeCount,
    maxGeneratedJsonBytes: source.maxJsonBytes,
  }, null, 2));

  if (mode === "--dry-run") return;
  const verification = await verifyDestination(tokenProvider, source);
  console.log(JSON.stringify(verification, null, 2));
  if (!verification.ok) throw new Error("本番metricYearsの全日照合に失敗しました。");
  console.log("Production metricYears match every retained dailyMetrics point.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
