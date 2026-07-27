import "server-only";

import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type {
  HomeDashboardListViewCommonPayload,
  HomeDashboardListViewCompressedSectionDocument,
  HomeDashboardListViewManifestDocument,
  HomeDashboardListViewProductPayload,
  HomeDashboardListViewSectionDescriptor,
  HomeDashboardListViewVersionDocument,
  HomeRankingWorkType,
  ProductCardItem,
  ProductListFilter,
} from "../types";
import { getAdminDb } from "./admin";

const HOME_DASHBOARD_LIST_VIEWS_COLLECTION = "homeDashboardListViews";
const SCOPES_SUBCOLLECTION = "homeDashboardListViewScopes";
const VERSIONS_SUBCOLLECTION = "homeDashboardListViewVersions";
const SECTIONS_SUBCOLLECTION = "homeDashboardListViewSections";
const SCHEMA_VERSION = 1;
const MAX_COMPRESSED_BYTES = 700 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const COMMON_SECTION_ID = "common";

export type HomeDashboardListViewResult = {
  common: HomeDashboardListViewCommonPayload;
  rankingProducts: ProductCardItem[];
  newCandidateProducts: ProductCardItem[];
  segmentId: string;
  contentScope: "all" | "tl" | "bl";
  versionId: string;
  sourceStatId: string;
  sourceRankingVersionId: string;
  usedPreviousVersion: boolean;
  sectionIds: string[];
  firestoreReadEstimate: number;
};

type VersionMetadata = {
  sourceStatId: string;
  sourceRankingVersionId: string;
  sections: Record<string, HomeDashboardListViewSectionDescriptor>;
};

function buildSegmentId(
  filter: Pick<ProductListFilter, "platform" | "audience" | "category">,
): string {
  return `${filter.platform}_${filter.audience}_${filter.category}`;
}

function contentScopeForFilter(filter: ProductListFilter): "all" | "tl" | "bl" {
  return filter.contentType ?? "all";
}

function buildStatId(segmentId: string, contentScope: "all" | "tl" | "bl"): string {
  return contentScope === "all" ? segmentId : `${segmentId}_${contentScope}`;
}

function rankingSectionId(workType: HomeRankingWorkType): string {
  return `ranking_${workType}`;
}

function newSectionId(workType: HomeRankingWorkType): string {
  return `new_${workType}`;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isDescriptor(value: unknown): value is HomeDashboardListViewSectionDescriptor {
  if (!value || typeof value !== "object") return false;
  const descriptor = value as Partial<HomeDashboardListViewSectionDescriptor>;
  return (
    isString(descriptor.sectionId) &&
    isFiniteNonNegativeInteger(descriptor.compressedBytes) &&
    isFiniteNonNegativeInteger(descriptor.uncompressedBytes) &&
    isString(descriptor.checksum) &&
    isFiniteNonNegativeInteger(descriptor.itemCount)
  );
}

function validateMetadata(
  value: Partial<VersionMetadata>,
  requiredSectionIds: string[],
  context: string,
): VersionMetadata {
  if (
    !isString(value.sourceStatId) ||
    !isString(value.sourceRankingVersionId) ||
    !value.sections ||
    typeof value.sections !== "object"
  ) {
    throw new Error(`Home-dashboard metadata is invalid: ${context}`);
  }
  for (const sectionId of requiredSectionIds) {
    const descriptor = value.sections[sectionId];
    if (!isDescriptor(descriptor) || descriptor.sectionId !== sectionId) {
      throw new Error(`Home-dashboard section descriptor is invalid: ${context}/${sectionId}`);
    }
  }
  return {
    sourceStatId: value.sourceStatId,
    sourceRankingVersionId: value.sourceRankingVersionId,
    sections: value.sections as Record<string, HomeDashboardListViewSectionDescriptor>,
  };
}

function toBuffer(value: unknown): Buffer | undefined {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value && typeof value === "object") {
    const bytes = value as { toUint8Array?: () => Uint8Array };
    if (typeof bytes.toUint8Array === "function") {
      return Buffer.from(bytes.toUint8Array());
    }
  }
  return undefined;
}

function sha256Hex(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function isProductCard(value: unknown): value is ProductCardItem {
  if (!value || typeof value !== "object") return false;
  const product = value as Partial<ProductCardItem>;
  return (
    isString(product.productId) &&
    isString(product.title) &&
    isString(product.platform) &&
    isString(product.audience) &&
    isString(product.category)
  );
}

function decodeSection(
  data: Partial<HomeDashboardListViewCompressedSectionDocument>,
  descriptor: HomeDashboardListViewSectionDescriptor,
  versionId: string,
): unknown {
  const payload = toBuffer(data.payload);
  if (
    data.schemaVersion !== SCHEMA_VERSION ||
    data.encoding !== "gzip-json-v1" ||
    data.sectionId !== descriptor.sectionId ||
    data.versionId !== versionId ||
    data.compressedBytes !== descriptor.compressedBytes ||
    data.uncompressedBytes !== descriptor.uncompressedBytes ||
    data.checksum !== descriptor.checksum ||
    data.itemCount !== descriptor.itemCount ||
    !payload
  ) {
    throw new Error(`Home-dashboard section metadata is invalid: ${versionId}/${descriptor.sectionId}`);
  }
  if (
    payload.length !== descriptor.compressedBytes ||
    payload.length > MAX_COMPRESSED_BYTES ||
    sha256Hex(payload) !== descriptor.checksum
  ) {
    throw new Error(`Home-dashboard section checksum or size is invalid: ${versionId}/${descriptor.sectionId}`);
  }
  const uncompressed = gunzipSync(payload);
  if (
    uncompressed.length !== descriptor.uncompressedBytes ||
    uncompressed.length > MAX_UNCOMPRESSED_BYTES
  ) {
    throw new Error(`Home-dashboard section uncompressed size is invalid: ${versionId}/${descriptor.sectionId}`);
  }
  return JSON.parse(uncompressed.toString("utf8"));
}

function parseProductPayload(
  value: unknown,
  descriptor: HomeDashboardListViewSectionDescriptor,
  context: string,
): HomeDashboardListViewProductPayload {
  if (!value || typeof value !== "object") {
    throw new Error(`Home-dashboard product payload is invalid: ${context}`);
  }
  const payload = value as Partial<HomeDashboardListViewProductPayload>;
  if (
    !Array.isArray(payload.products) ||
    !payload.products.every(isProductCard) ||
    payload.products.length !== descriptor.itemCount
  ) {
    throw new Error(`Home-dashboard product payload items are invalid: ${context}`);
  }
  return { products: payload.products };
}

function parseCommonPayload(
  value: unknown,
  descriptor: HomeDashboardListViewSectionDescriptor,
  context: string,
): HomeDashboardListViewCommonPayload {
  if (!value || typeof value !== "object") {
    throw new Error(`Home-dashboard common payload is invalid: ${context}`);
  }
  const payload = value as Partial<HomeDashboardListViewCommonPayload>;
  const stats = payload.stats as Partial<HomeDashboardListViewCommonPayload["stats"]> | undefined;
  const recent = payload.recentCandidateProducts;
  const sales = payload.saleCandidateProducts;
  const weekly = payload.weeklyCircleCandidates;
  const fallbackCircles = payload.fallbackCircleHighlights;
  const weeklyCandidatesValid = Array.isArray(weekly) &&
    weekly.every((candidate) =>
      Boolean(
        candidate &&
          candidate.product &&
          isString(candidate.product.productId) &&
          typeof candidate.weeklySalesCount === "number" &&
          Number.isFinite(candidate.weeklySalesCount),
      ),
    );
  const fallbackCirclesValid = Array.isArray(fallbackCircles) &&
    fallbackCircles.every((circle) =>
      Boolean(circle && isString(circle.sellerKey) && isString(circle.sellerName)),
    );
  if (
    !stats ||
    typeof stats.productCount !== "number" ||
    !Number.isFinite(stats.productCount) ||
    typeof stats.todayUpdatedCount !== "number" ||
    !Number.isFinite(stats.todayUpdatedCount) ||
    typeof stats.saleCount !== "number" ||
    !Number.isFinite(stats.saleCount) ||
    !Array.isArray(stats.popularGenres) ||
    !Array.isArray(stats.popularCategories) ||
    !Array.isArray(recent) ||
    !recent.every(isProductCard) ||
    !Array.isArray(sales) ||
    !sales.every(isProductCard) ||
    !weeklyCandidatesValid ||
    !fallbackCirclesValid
  ) {
    throw new Error(`Home-dashboard common payload fields are invalid: ${context}`);
  }
  const itemCount = recent.length + sales.length + weekly.length + fallbackCircles.length;
  if (itemCount !== descriptor.itemCount) {
    throw new Error(`Home-dashboard common payload item count is invalid: ${context}`);
  }
  return {
    stats: stats as HomeDashboardListViewCommonPayload["stats"],
    recentCandidateProducts: recent,
    saleCandidateProducts: sales,
    weeklyCircleCandidates: weekly,
    fallbackCircleHighlights: fallbackCircles,
  };
}

async function loadFromVersion(
  scopeRef: FirebaseFirestore.DocumentReference,
  versionId: string,
  metadata: VersionMetadata,
  rankingWorkType: HomeRankingWorkType,
  newWorkType: HomeRankingWorkType,
  baseReadEstimate: number,
): Promise<Omit<HomeDashboardListViewResult, "segmentId" | "contentScope" | "usedPreviousVersion">> {
  const sectionIds = [
    COMMON_SECTION_ID,
    rankingSectionId(rankingWorkType),
    newSectionId(newWorkType),
  ];
  const versionRef = scopeRef.collection(VERSIONS_SUBCOLLECTION).doc(versionId);
  const refs = sectionIds.map((sectionId) =>
    versionRef.collection(SECTIONS_SUBCOLLECTION).doc(sectionId),
  );
  const snapshots = await getAdminDb().getAll(...refs);
  const decoded = new Map<string, unknown>();
  for (let index = 0; index < sectionIds.length; index += 1) {
    const sectionId = sectionIds[index];
    const snapshot = snapshots[index];
    if (!snapshot.exists) {
      throw new Error(`Home-dashboard section is missing: ${versionId}/${sectionId}`);
    }
    decoded.set(
      sectionId,
      decodeSection(
        snapshot.data() as Partial<HomeDashboardListViewCompressedSectionDocument>,
        metadata.sections[sectionId],
        versionId,
      ),
    );
  }
  const common = parseCommonPayload(
    decoded.get(COMMON_SECTION_ID),
    metadata.sections[COMMON_SECTION_ID],
    `${versionId}/${COMMON_SECTION_ID}`,
  );
  const ranking = parseProductPayload(
    decoded.get(rankingSectionId(rankingWorkType)),
    metadata.sections[rankingSectionId(rankingWorkType)],
    `${versionId}/${rankingSectionId(rankingWorkType)}`,
  );
  const newest = parseProductPayload(
    decoded.get(newSectionId(newWorkType)),
    metadata.sections[newSectionId(newWorkType)],
    `${versionId}/${newSectionId(newWorkType)}`,
  );
  return {
    common,
    rankingProducts: ranking.products,
    newCandidateProducts: newest.products,
    versionId,
    sourceStatId: metadata.sourceStatId,
    sourceRankingVersionId: metadata.sourceRankingVersionId,
    sectionIds,
    firestoreReadEstimate: baseReadEstimate + sectionIds.length,
  };
}

async function loadPreviousMetadata(
  scopeRef: FirebaseFirestore.DocumentReference,
  previousVersion: string,
  requiredSectionIds: string[],
  segmentId: string,
  contentScope: "all" | "tl" | "bl",
  expectedStatId: string,
): Promise<VersionMetadata> {
  const snapshot = await scopeRef.collection(VERSIONS_SUBCOLLECTION).doc(previousVersion).get();
  if (!snapshot.exists) {
    throw new Error(`Previous home-dashboard version is missing: ${previousVersion}`);
  }
  const version = snapshot.data() as Partial<HomeDashboardListViewVersionDocument>;
  if (
    version.schemaVersion !== SCHEMA_VERSION ||
    version.versionId !== previousVersion ||
    version.segmentId !== segmentId ||
    version.contentScope !== contentScope ||
    version.sourceStatId !== expectedStatId
  ) {
    throw new Error(`Previous home-dashboard version is invalid: ${previousVersion}`);
  }
  return validateMetadata(version, requiredSectionIds, previousVersion);
}

export async function getHomeDashboardListView(
  filter: ProductListFilter & {
    rankingWorkType?: HomeRankingWorkType;
    newWorkType?: HomeRankingWorkType;
  },
): Promise<HomeDashboardListViewResult | undefined> {
  const segmentId = buildSegmentId(filter);
  const contentScope = contentScopeForFilter(filter);
  const expectedStatId = buildStatId(segmentId, contentScope);
  const rankingWorkType = filter.rankingWorkType ?? "all";
  const newWorkType = filter.newWorkType ?? "all";
  const requiredSectionIds = [
    COMMON_SECTION_ID,
    rankingSectionId(rankingWorkType),
    newSectionId(newWorkType),
  ];
  const scopeRef = getAdminDb()
    .collection(HOME_DASHBOARD_LIST_VIEWS_COLLECTION)
    .doc(segmentId)
    .collection(SCOPES_SUBCOLLECTION)
    .doc(contentScope);
  const manifestSnapshot = await scopeRef.get();
  if (!manifestSnapshot.exists) return undefined;
  const manifest = manifestSnapshot.data() as Partial<HomeDashboardListViewManifestDocument>;
  if (
    manifest.schemaVersion !== SCHEMA_VERSION ||
    manifest.segmentId !== segmentId ||
    manifest.contentScope !== contentScope ||
    manifest.sourceStatId !== expectedStatId ||
    !isString(manifest.activeVersion)
  ) {
    console.warn("Home-dashboard manifest is invalid", { segmentId, contentScope });
    return undefined;
  }

  try {
    const metadata = validateMetadata(
      manifest,
      requiredSectionIds,
      `${segmentId}/${contentScope}/${manifest.activeVersion}`,
    );
    const result = await loadFromVersion(
      scopeRef,
      manifest.activeVersion,
      metadata,
      rankingWorkType,
      newWorkType,
      1,
    );
    return {
      ...result,
      segmentId,
      contentScope,
      usedPreviousVersion: false,
    };
  } catch (error) {
    console.error("Active home-dashboard list view failed validation", {
      segmentId,
      contentScope,
      activeVersion: manifest.activeVersion,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!isString(manifest.previousVersion)) return undefined;
  try {
    const metadata = await loadPreviousMetadata(
      scopeRef,
      manifest.previousVersion,
      requiredSectionIds,
      segmentId,
      contentScope,
      expectedStatId,
    );
    const result = await loadFromVersion(
      scopeRef,
      manifest.previousVersion,
      metadata,
      rankingWorkType,
      newWorkType,
      2,
    );
    console.warn("Using previous home-dashboard list view version", {
      segmentId,
      contentScope,
      previousVersion: manifest.previousVersion,
    });
    return {
      ...result,
      segmentId,
      contentScope,
      usedPreviousVersion: true,
    };
  } catch (error) {
    console.error("Previous home-dashboard list view also failed validation", {
      segmentId,
      contentScope,
      previousVersion: manifest.previousVersion,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}
