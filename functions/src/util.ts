import crypto from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import type { Category, Platform, RankingType } from "./types";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toYyyyMMdd(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}${parts.month}${parts.day}`;
}


export function toIsoDateJst(date = new Date()): string {
  const yyyymmdd = toYyyyMMdd(date);
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

export function nowTimestamp(): Timestamp {
  return Timestamp.now();
}

export function buildProductId(platform: Platform, category: Category, sourceProductId: string): string {
  return `${platform}_${category}_${sourceProductId}`;
}

export function buildRankingKey(target: {
  platform: Platform;
  audience: string;
  category: Category;
  rankingType: RankingType;
}): string {
  return `${target.platform}_${target.audience}_${target.category}_${target.rankingType}`;
}

export function buildSnapshotId(date: string, rankingKey: string): string {
  return `${date}_${rankingKey}`;
}

export function buildRankItemId(rank: number, productId: string): string {
  return `${rank.toString().padStart(4, "0")}_${productId}`;
}

export function createRunId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${prefix}_${stamp}_${suffix}`;
}

export function buildSearchTokens(values: string[]): string[] {
  const tokens = new Set<string>();
  for (const value of values) {
    const normalized = value.toLowerCase().trim();
    if (!normalized) continue;
    tokens.add(normalized);
    for (const part of normalized.split(/[\s　/_-]+/)) {
      if (part.length >= 2) tokens.add(part);
    }
  }
  return [...tokens];
}


function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => withoutUndefined(item))
      .filter((item) => item !== undefined) as T;
  }

  if (!isPlainRecord(value)) {
    return value;
  }

  const cleaned: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    cleaned[key] = withoutUndefined(item);
  }

  return cleaned as T;
}
