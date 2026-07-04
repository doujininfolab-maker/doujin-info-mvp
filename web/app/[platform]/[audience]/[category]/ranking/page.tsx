import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { ListEmptyState, ListPageInfo } from "@/components/ListPageInfo";
import { RankingModeTabs, WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getLatestRankingProducts } from "@/lib/firebase/products";
import { getWorkTypeLabel, parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";
import { RANKING_MODE_OPTIONS, parseRankingMode } from "@/lib/rankingModes";

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
  const rankingModeLabel = RANKING_MODE_OPTIONS.find((option) => option.value === rankingMode)?.label ?? "日間売上";
  const visibleRange = products.length ? `${offsetCount + 1}〜${offsetCount + products.length}件` : "0件";

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
        <ListPageInfo
          title="いま売れている作品を比較できます"
          description="DLsiteの取得済みランキングと販売数をもとに、人気作品を一覧で確認できます。右端には順位と販売指標を表示します。"
          items={[
            { label: "対象", value: getContentScopeLabel(contentScope) },
            { label: "作品形式", value: getWorkTypeLabel(workType) },
            { label: "並び順", value: rankingModeLabel },
            { label: "表示中", value: visibleRange },
          ]}
          note="ランキングはバッチ取得時点の情報です。DLsite公式の表示とは取得タイミングで差が出る場合があります。"
        />
        <div className="listToolbar listToolbar--below">
          <PageSizeSelect value={limitCount} />
          <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
        </div>
        {products.length ? (
          <ProductGrid products={products} showRank rankOffset={offsetCount} variant="list" listRankMetric={listRankMetric} contentTypeParam={contentTypeParam} />
        ) : (
          <ListEmptyState title="ランキング作品が見つかりませんでした。" />
        )}
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
