import type { FirestoreTimestampLike } from "./types";

export function formatPrice(price?: number): string {
  if (price == null) return "価格未取得";
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(price);
}

export function formatNumber(value?: number): string {
  if (value == null) return "-";
  return new Intl.NumberFormat("ja-JP").format(value);
}

export function formatRating(value?: number): string {
  if (value == null) return "-";
  return value.toFixed(2);
}

export function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function timestampToDate(value?: FirestoreTimestampLike | string): Date | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof value.toDate === "function") {
    return value.toDate();
  }
  return new Date(value.seconds * 1000 + Math.floor(value.nanoseconds / 1_000_000));
}
