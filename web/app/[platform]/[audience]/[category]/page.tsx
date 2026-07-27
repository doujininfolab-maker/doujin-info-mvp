import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeDashboard } from "@/components/HomeDashboard";
import { DEFAULT_SEGMENT, getSegment } from "@/lib/siteSegments";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import { getHomeDashboardPageData } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment) return {};

  const canonical = segment.key === DEFAULT_SEGMENT.key ? "/" : segment.path;

  return {
    title: segment.label,
    description: segment.description,
    alternates: { canonical },
    openGraph: {
      title: segment.label,
      description: segment.description,
      type: "website",
      url: canonical,
    },
  };
}

export default async function SegmentTopPage({ params, searchParams }: PageProps) {
  const query = searchParams ? await searchParams : {};
  const rankingWorkType = parseWorkType(query.rankingWorkType);
  const newWorkType = parseWorkType(query.newWorkType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const filter = {
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
  };

  const {
    stats,
    rankingProducts,
    newProducts,
    recentProducts,
    saleProducts,
    circleHighlights,
  } = await getHomeDashboardPageData({
    ...filter,
    contentType,
    rankingWorkType,
    newWorkType,
  });

  return (
    <HomeDashboard
      segment={segment}
      pagePath={segment.path}
      rankingProducts={rankingProducts}
      rankingWorkType={rankingWorkType}
      contentTypeParam={contentTypeParam}
      newProducts={newProducts}
      recentProducts={recentProducts}
      newWorkType={newWorkType}
      saleProducts={saleProducts}
      stats={stats}
      circleHighlights={circleHighlights}
    />
  );
}
