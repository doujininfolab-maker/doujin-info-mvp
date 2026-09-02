#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROJECT_ID = "doujin-info-mvp";
const DATABASE_ID = "(default)";
const PAGE_SIZE = 250;
const expectedDifferencesArgument = process.argv.find((value) => value.startsWith("--expected-differences="))
  ?.slice("--expected-differences=".length);
const EXPECTED_DIFFERENCES = Object.fromEntries(
  (expectedDifferencesArgument || "")
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [date, count] = entry.split(":");
      return [date, Number(count)];
    }),
);
const POINT_FIELDS = [
  "priceCurrent", "priceOriginal", "salesCount", "dailySalesCount",
  "dailySalesStatus", "dailySalesBaseDate", "dailySalesNextDate",
  "dailySalesBaseCount", "dailySalesNextCount", "dailySalesRawDelta",
  "dailySalesPeriodDays", "periodSalesCount", "dailySalesCalculatedAt", "fetchedAt",
];
const DAILY_DELTA_FIELDS = [
  "dailySalesCount", "dailySalesStatus", "dailySalesBaseDate", "dailySalesNextDate",
  "dailySalesBaseCount", "dailySalesNextCount", "dailySalesRawDelta",
  "dailySalesPeriodDays", "periodSalesCount", "dailySalesCalculatedAt",
];

function findFirebaseToolsRoot() {
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
  return candidates[0]?.path;
}

async function getAccessToken() {
  const firebaseToolsRoot = findFirebaseToolsRoot();
  if (firebaseToolsRoot) {
    const auth = require(join(firebaseToolsRoot, "lib", "auth.js"));
    const account = auth.getGlobalDefaultAccount();
    const scopes = ["https://www.googleapis.com/auth/cloud-platform"];
    return (await auth.getAccessToken(account.tokens.refresh_token, scopes)).access_token;
  }
  const gcloud = join(
    process.env.LOCALAPPDATA || "",
    "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd",
  );
  if (!existsSync(gcloud)) throw new Error("firebase-toolsもgcloudも見つかりません。");
  return execFileSync(gcloud, ["auth", "print-access-token"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, normalize(child)]));
}

function hashPoint(fields) {
  return createHash("sha256").update(JSON.stringify(normalize(fields))).digest("hex");
}

function databasePath() {
  return `projects/${PROJECT_ID}/databases/${DATABASE_ID}`;
}

async function readJson(response, operation) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`${operation} failed (${response.status}): ${text}`);
  return body;
}

async function* readCollectionGroup(accessToken, collectionId) {
  let startAfterName;
  while (true) {
    const response = await fetch(`https://firestore.googleapis.com/v1/${databasePath()}/documents:runQuery`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
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
      signal: AbortSignal.timeout(120_000),
    });
    const body = await readJson(response, `runQuery(${collectionId})`);
    const documents = body.flatMap((value) => (value.document ? [value.document] : []));
    for (const document of documents) yield document;
    if (documents.length < PAGE_SIZE) return;
    startAfterName = documents.at(-1).name;
  }
}

function dailyIdentity(document) {
  const segments = document.name.split("/documents/")[1].split("/");
  const date = document.fields?.date?.stringValue || segments[3];
  return { productId: segments[1], date };
}

async function main() {
  if (!Object.keys(EXPECTED_DIFFERENCES).length || Object.entries(EXPECTED_DIFFERENCES).some(
    ([date, count]) => !/^\d{8}$/.test(date) || !Number.isInteger(count) || count < 0,
  )) {
    throw new Error("--expected-differences=YYYYMMDD:count,...が必要です。");
  }
  let accessToken = await getAccessToken();
  const expected = new Map();
  let legacyPointCount = 0;

  console.log(`Target READ ONLY: ${PROJECT_ID}/${DATABASE_ID}`);
  for await (const document of readCollectionGroup(accessToken, "dailyMetrics")) {
    const { productId, date } = dailyIdentity(document);
    const fields = Object.fromEntries(POINT_FIELDS
      .filter((field) => document.fields?.[field] !== undefined)
      .map((field) => [field, document.fields[field]]));
    expected.set(`${productId}/${date}`, {
      fullHash: hashPoint(fields),
      dailyDeltaHash: hashPoint(Object.fromEntries(DAILY_DELTA_FIELDS
        .filter((field) => fields[field] !== undefined)
        .map((field) => [field, fields[field]]))),
    });
    legacyPointCount += 1;
    if (legacyPointCount % 50_000 === 0) console.log(`legacy: ${legacyPointCount.toLocaleString()}`);
  }

  accessToken = await getAccessToken();
  let yearDocumentCount = 0;
  let annualPointCount = 0;
  let missingCount;
  let mismatchCount = 0;
  let dailyDeltaMismatchCount = 0;
  let extraCount = 0;
  const differenceDates = {};

  for await (const document of readCollectionGroup(accessToken, "metricYears")) {
    yearDocumentCount += 1;
    const segments = document.name.split("/documents/")[1].split("/");
    const productId = segments[1];
    const year = document.fields?.year?.stringValue || segments[3];
    const points = document.fields?.points?.mapValue?.fields || {};
    for (const [dayKey, point] of Object.entries(points)) {
      const date = `${year}${dayKey}`;
      const key = `${productId}/${date}`;
      const expectedHashes = expected.get(key);
      let different = false;
      if (!expectedHashes) {
        extraCount += 1;
        different = true;
      } else {
        const annualFields = point.mapValue?.fields || {};
        if (expectedHashes.fullHash !== hashPoint(annualFields)) {
          mismatchCount += 1;
          different = true;
        }
        const annualDailyDeltaFields = Object.fromEntries(DAILY_DELTA_FIELDS
          .filter((field) => annualFields[field] !== undefined)
          .map((field) => [field, annualFields[field]]));
        if (expectedHashes.dailyDeltaHash !== hashPoint(annualDailyDeltaFields)) {
          dailyDeltaMismatchCount += 1;
        }
      }
      if (different) {
        differenceDates[date] = (differenceDates[date] || 0) + 1;
      }
      expected.delete(key);
      annualPointCount += 1;
    }
  }
  missingCount = expected.size;
  const allDifferenceDates = [...new Set([
    ...Object.keys(differenceDates),
    ...Object.keys(EXPECTED_DIFFERENCES),
  ])].sort();
  const unexpectedDifferenceDates = allDifferenceDates.filter(
    (date) => (differenceDates[date] || 0) !== (EXPECTED_DIFFERENCES[date] || 0),
  );
  const result = {
    legacyPointCount,
    yearDocumentCount,
    annualPointCount,
    missingCount,
    mismatchCount,
    dailyDeltaMismatchCount,
    extraCount,
    differenceDates,
    expectedDifferences: EXPECTED_DIFFERENCES,
    unexpectedDifferenceDates,
    ok: missingCount === 0 &&
      dailyDeltaMismatchCount === 0 &&
      unexpectedDifferenceDates.length === 0,
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) throw new Error("バッチ後の1日単位履歴照合に失敗しました。");
  console.log("All historical dates match the expected batch update distribution.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
