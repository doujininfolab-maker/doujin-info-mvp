import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { RankingModeTabs, WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getLatestRankingProducts } from "@/lib/firebase/products";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import { parseRankingMode } from "@/lib/rankingModes";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}ランキング` : "ランキング" };
}

export default async function RankingPage({ params, searchParams }: PageProps) {
  const { platform, audience, category } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const offsetCount = (pageNumber - 1) * limitCount;
  const workType = parseWorkType(query.workType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const rankingMode = parseRankingMode(query.rankingMode);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getLatestRankingProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
    rankingMode,
    workType,
    contentType,
  });

  const listRankMetric = rankingMode === "dailyRevenue" ? "revenue" : "sales";

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title="人気ランキング" description={`${segment.label}の人気作品`} icon="♕">
          <div className="listHeaderFilters listHeaderFilters--ranking">
            <RankingModeTabs
              basePath={`${segment.path}/ranking`}
              currentRankingMode={rankingMode}
              currentParams={{
                workType,
                contentType: contentTypeParam,
                limit: String(limitCount),
                page: "1",
              }}
            />
            <WorkTypeTabs
              basePath={`${segment.path}/ranking`}
              currentWorkType={workType}
              currentParams={{
                rankingMode: rankingMode === "dailyRevenue" ? undefined : rankingMode,
                contentType: contentTypeParam,
                limit: String(limitCount),
                page: "1",
              }}
            />
          </div>
        </SectionHeader>
        <div className="listToolbar listToolbar--below">
          <PageSizeSelect value={limitCount} />
          <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
        </div>
        <ProductGrid products={products} showRank rankOffset={offsetCount} variant="list" listRankMetric={listRankMetric} contentTypeParam={contentTypeParam} />
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
