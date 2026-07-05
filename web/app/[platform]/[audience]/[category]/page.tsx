import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeDashboard } from "@/components/HomeDashboard";
import { getSegment } from "@/lib/siteSegments";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import {
  getHomeDashboardData,
  getHomeRandomNewProducts,
  getHomeRandomSaleProducts,
  getLatestRankingProducts,
  getNewProducts,
} from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment) return {};

  return {
    title: segment.label,
    description: segment.description,
    openGraph: {
      title: segment.label,
      description: segment.description,
      type: "website",
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

  const [rankingProducts, newProducts, recentProducts, saleProducts, homeData] = await Promise.all([
    getLatestRankingProducts({ ...filter, limitCount: 10, workType: rankingWorkType, contentType }),
    getHomeRandomNewProducts({ ...filter, limitCount: 10, workType: newWorkType, contentType }),
    getNewProducts({ ...filter, limitCount: 10, contentType }),
    getHomeRandomSaleProducts({ ...filter, limitCount: 10, contentType }),
    getHomeDashboardData({ ...filter, limitCount: 10, contentType }),
  ]);
  const { stats, circleHighlights } = homeData;

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
