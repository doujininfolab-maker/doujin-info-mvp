import { HomeDashboard } from "@/components/HomeDashboard";
import { DEFAULT_SEGMENT } from "@/lib/siteSegments";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import {
  getHomeDashboardData,
  getLatestRankingProducts,
  getNewProducts,
  getSaleProducts,
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

  const [rankingProducts, newProducts, recentProducts, saleProducts, homeData] = await Promise.all([
    getLatestRankingProducts({ ...filter, limitCount: 10, workType: rankingWorkType, contentType }),
    getNewProducts({ ...filter, limitCount: 10, workType: newWorkType, contentType }),
    getNewProducts({ ...filter, limitCount: 8, contentType }),
    getSaleProducts({ ...filter, limitCount: 10, contentType }),
    getHomeDashboardData({ ...filter, limitCount: 8, contentType }),
  ]);
  const { stats, circleHighlights } = homeData;

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
