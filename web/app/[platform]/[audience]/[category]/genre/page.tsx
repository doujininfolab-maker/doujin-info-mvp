import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GenreRankingCard } from "@/components/GenreRankingCard";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { ListEmptyState, ListPageInfo } from "@/components/ListPageInfo";
import { WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getGenreRankingItems } from "@/lib/firebase/products";
import { getWorkTypeLabel, parseWorkType } from "@/lib/workTypes";
import { buildFilterHref } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";
import { parseRankingMode } from "@/lib/rankingModes";
import type { ProductRankingMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const GENRE_RANKING_MODE_OPTIONS: Array<{ label: string; value: ProductRankingMode }> = [
  { label: "日間", value: "daily" },
  { label: "週間", value: "weekly" },
  { label: "月間", value: "monthly" },
  { label: "累計", value: "cumulative" },
];

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function parseGenreRankingMode(value: string | string[] | undefined): ProductRankingMode {
  const mode = parseRankingMode(value);
  return mode === "dailyRevenue" ? "daily" : mode;
}

function GenreRankingModeTabs({
  basePath,
  currentRankingMode,
  currentParams = {},
}: {
  basePath: string;
  currentRankingMode: ProductRankingMode;
  currentParams?: Record<string, string | undefined>;
}) {
  return (
    <nav className="rankingModeTabs" aria-label="ジャンルランキング種別">
      {GENRE_RANKING_MODE_OPTIONS.map((option) => {
        const href = buildFilterHref(basePath, currentParams, {
          rankingMode: option.value === "daily" ? undefined : option.value,
        });

        return (
          <Link className={currentRankingMode === option.value ? "isActive" : undefined} href={href} key={option.value} scroll={false}>
            {option.label}
          </Link>
        );
      })}
    </nav>
  );
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}ジャンルランキング` : "ジャンルランキング" };
}

export default async function GenreRankingPage({ params, searchParams }: PageProps) {
  const { platform, audience, category } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const offsetCount = (pageNumber - 1) * limitCount;
  const workType = parseWorkType(query.workType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const rankingMode = parseGenreRankingMode(query.rankingMode);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const items = await getGenreRankingItems({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
    workType,
    contentType,
    rankingMode,
  });
  const rankingModeLabel = GENRE_RANKING_MODE_OPTIONS.find((option) => option.value === rankingMode)?.label ?? "日間";
  const visibleRange = items.length ? `${offsetCount + 1}〜${offsetCount + items.length}件` : "0件";

  return (
    <div className="listPage listPage--wide listPage--mobileGenreList">
      <section className="contentSection listSection genreRankingSection">
        <SectionHeader title="ジャンルランキング" description={`${segment.label}で使われているジャンル`} icon="♟">
          <div className="listHeaderFilters listHeaderFilters--ranking">
            <GenreRankingModeTabs
              basePath={`${segment.path}/genre`}
              currentRankingMode={rankingMode}
              currentParams={{
                workType,
                contentType: contentTypeParam,
                limit: String(limitCount),
                page: "1",
              }}
            />
            <WorkTypeTabs
              basePath={`${segment.path}/genre`}
              currentWorkType={workType}
              currentParams={{
                rankingMode: rankingMode === "daily" ? undefined : rankingMode,
                contentType: contentTypeParam,
                limit: String(limitCount),
                page: "1",
              }}
            />
          </div>
        </SectionHeader>
        <ListPageInfo
          title="人気ジャンルと代表作品をまとめて確認できます"
          description="ジャンルごとの作品数・累計販売数・代表作品を集計し、どのジャンルが強いかを比較できます。"
          items={[
            { label: "対象", value: getContentScopeLabel(contentScope) },
            { label: "作品形式", value: getWorkTypeLabel(workType) },
            { label: "集計", value: rankingModeLabel },
            { label: "表示中", value: visibleRange },
          ]}
        />
        <div className="listToolbar listToolbar--below">
          <PageSizeSelect value={limitCount} />
          <ListPagination page={pageNumber} limit={limitCount} hasNext={items.length === limitCount} />
        </div>
        {items.length ? (
          <div className="genreRankingList">
            {items.map((item) => (
              <GenreRankingCard item={item} segment={segment} key={item.genreId} showRevenue={rankingMode === "dailyRevenue"} contentTypeParam={contentTypeParam} />
            ))}
          </div>
        ) : (
          <ListEmptyState title="ジャンルランキングが見つかりませんでした。" description="TL / BL や作品形式を変更して再度確認してください。" />
        )}
        <ListPagination page={pageNumber} limit={limitCount} hasNext={items.length === limitCount} />
      </section>
    </div>
  );
}
