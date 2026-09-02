#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PROJECT_ID = "doujin-info-mvp";
const DATABASE_ID = "(default)";
const productId = process.argv[2];
const year = process.argv[3] || "2026";
const date = process.argv[4];

if (!productId) throw new Error("usage: node scripts/inspect-test-product-metric.mjs PRODUCT_ID [YEAR]");
if (PROJECT_ID !== "doujin-info-mvp") throw new Error("test project guard failed");

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
    const token = await auth.getAccessToken(account.tokens.refresh_token, ["https://www.googleapis.com/auth/cloud-platform"]);
    return token.access_token;
  }

  const gcloud = join(
    process.env.LOCALAPPDATA || "",
    "Google", "Cloud SDK", "google-cloud-sdk", "bin", "gcloud.cmd",
  );
  if (!existsSync(gcloud)) throw new Error("neither firebase-tools nor gcloud was found");
  return execFileSync(gcloud, ["auth", "print-access-token"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
}

function decode(value) {
  if (value === undefined) return undefined;
  if (value.nullValue !== undefined) return null;
  if (value.stringValue !== undefined) return value.stringValue;
  if (value.integerValue !== undefined) return Number(value.integerValue);
  if (value.doubleValue !== undefined) return value.doubleValue;
  if (value.booleanValue !== undefined) return value.booleanValue;
  if (value.timestampValue !== undefined) return value.timestampValue;
  if (value.arrayValue !== undefined) return (value.arrayValue.values || []).map(decode);
  if (value.mapValue !== undefined) {
    return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, decode(child)]));
  }
  return value;
}

async function getDocument(accessToken, path) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${encodeURIComponent(DATABASE_ID)}/documents/${path}`;
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}): ${await response.text()}`);
  const body = await response.json();
  return Object.fromEntries(Object.entries(body.fields || {}).map(([key, value]) => [key, decode(value)]));
}

const accessToken = await getAccessToken();
const product = await getDocument(accessToken, `products/${encodeURIComponent(productId)}`);
const metricYear = await getDocument(accessToken, `products/${encodeURIComponent(productId)}/metricYears/${year}`);
const legacyMetric = date
  ? await getDocument(accessToken, `products/${encodeURIComponent(productId)}/dailyMetrics/${date}`)
  : undefined;

console.log(JSON.stringify({
  projectId: PROJECT_ID,
  productId,
  product: {
    salesCount: product.salesCount,
    lastDailySalesSnapshotDate: product.lastDailySalesSnapshotDate,
    lastDailySalesSnapshotCount: product.lastDailySalesSnapshotCount,
    previousDailySalesSnapshotDate: product.previousDailySalesSnapshotDate,
    previousDailySalesSnapshotCount: product.previousDailySalesSnapshotCount,
    recentSalesSnapshots: product.recentSalesSnapshots,
    rankingMetrics: product.rankingMetrics,
  },
  metricYear: {
    year: metricYear.year,
    points: metricYear.points,
  },
  legacyMetric,
}, null, 2));
