import type { Metadata } from "next";
import { HomeDashboard } from "@/components/HomeDashboard";
import { DEFAULT_SEGMENT } from "@/lib/siteSegments";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import { getHomeDashboardPageData } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function HomePage({ searchParams }: PageProps) {
  const query = searchParams ? await searchParams : {};
  const rankingWorkType = parseWorkType(query.rankingWorkType);
  const newWorkType = parseWorkType(query.newWorkType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = DEFAULT_SEGMENT;
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
      pagePath="/"
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
