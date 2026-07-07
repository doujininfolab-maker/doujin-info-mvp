import { HomeDashboard } from "@/components/HomeDashboard";
import { DEFAULT_SEGMENT } from "@/lib/siteSegments";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import {
  getHomeDashboardData,
  getHomeRandomNewProducts,
  getHomeRandomRecentAddedProducts,
  getHomeRandomSaleProducts,
  getHomeRandomWeeklyCircleHighlights,
  getLatestRankingProducts,
} from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

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

  const [rankingProducts, newProducts, recentProducts, saleProducts, homeData, weeklyCircleHighlights] = await Promise.all([
    getLatestRankingProducts({ ...filter, limitCount: 10, workType: rankingWorkType, contentType }),
    getHomeRandomNewProducts({ ...filter, limitCount: 10, workType: newWorkType, contentType }),
    getHomeRandomRecentAddedProducts({ ...filter, limitCount: 5, contentType }),
    getHomeRandomSaleProducts({ ...filter, limitCount: 10, contentType }),
    getHomeDashboardData({ ...filter, limitCount: 10, contentType }),
    getHomeRandomWeeklyCircleHighlights({ ...filter, limitCount: 10, contentType }),
  ]);
  const { stats } = homeData;
  const circleHighlights = weeklyCircleHighlights.length ? weeklyCircleHighlights : homeData.circleHighlights;

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
