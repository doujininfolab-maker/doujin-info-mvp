import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import type {
  HomeDashboardListViewCompressedSectionDocument,
  HomeDashboardListViewSectionDescriptor,
} from "../../types";
import { removeUndefinedDeep } from "./newListViewShared";

export const HOME_DASHBOARD_LIST_VIEW_SCHEMA_VERSION = 1;
export const HOME_DASHBOARD_LIST_VIEW_ENCODING = "gzip-json-v1" as const;
export const HOME_DASHBOARD_LIST_VIEW_SOFT_COMPRESSED_BYTES = 256 * 1024;
export const HOME_DASHBOARD_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES = 700 * 1024;
export const HOME_DASHBOARD_LIST_VIEW_MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;

export const HOME_DASHBOARD_COMMON_SECTION_ID = "common";

export function buildHomeDashboardRankingSectionId(workType: string): string {
  return `ranking_${workType}`;
}

export function buildHomeDashboardNewSectionId(workType: string): string {
  return `new_${workType}`;
}

export function sha256HomeDashboardListView(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export type BuiltHomeDashboardSection = {
  descriptor: HomeDashboardListViewSectionDescriptor;
  document: HomeDashboardListViewCompressedSectionDocument;
};

export function buildCompressedHomeDashboardSection(
  sectionId: string,
  versionId: string,
  payload: unknown,
  itemCount: number,
  generatedAt: FirebaseFirestore.Timestamp,
): BuiltHomeDashboardSection {
  const cleaned = removeUndefinedDeep(payload);
  const json = Buffer.from(JSON.stringify(cleaned), "utf8");
  if (json.length > HOME_DASHBOARD_LIST_VIEW_MAX_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Home-dashboard section uncompressed payload exceeds the safety limit: section=${sectionId}, bytes=${json.length}`,
    );
  }

  const compressed = gzipSync(json, { level: 6 });
  if (compressed.length > HOME_DASHBOARD_LIST_VIEW_ABSOLUTE_COMPRESSED_BYTES) {
    throw new Error(
      `Home-dashboard section compressed payload exceeds the absolute limit: section=${sectionId}, bytes=${compressed.length}`,
    );
  }
  if (compressed.length > HOME_DASHBOARD_LIST_VIEW_SOFT_COMPRESSED_BYTES) {
    console.warn("Home-dashboard section exceeds the soft compressed size target", {
      sectionId,
      compressedBytes: compressed.length,
    });
  }

  const checksum = sha256HomeDashboardListView(compressed);
  const descriptor: HomeDashboardListViewSectionDescriptor = {
    sectionId,
    compressedBytes: compressed.length,
    uncompressedBytes: json.length,
    checksum,
    itemCount,
  };

  return {
    descriptor,
    document: {
      schemaVersion: HOME_DASHBOARD_LIST_VIEW_SCHEMA_VERSION,
      encoding: HOME_DASHBOARD_LIST_VIEW_ENCODING,
      sectionId,
      versionId,
      compressedBytes: compressed.length,
      uncompressedBytes: json.length,
      checksum,
      itemCount,
      payload: compressed,
      generatedAt,
    },
  };
}
