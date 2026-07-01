import Link from "next/link";
import type { GenreSummary, HomeDashboardStats, Product, ProductCategorySummary, ProductWorkType, SellerSummary, SiteSegment } from "@/lib/types";
import { fillProducts } from "@/lib/mockProducts";
import { ProductGrid } from "./ProductGrid";
import { DashboardSidebar } from "./DashboardSidebar";
import { SectionHeader } from "./SectionHeader";
import { ScrollRail } from "./ScrollRail";
import { GenreIcon } from "@/components/icons/SiteIcons";
import { WorkTypeTabs } from "./WorkTypeTabs";
import { WORK_TYPE_OPTIONS, buildFilterHref } from "@/lib/workTypes";
import { CONTENT_TYPE_OPTIONS } from "@/lib/contentCategories";

const genreIcons = ["♟", "♫", "▤", "●", "▥", "♥", "◐", "✦", "◆", "◇", "▣", "☾"];
const genreTones = ["purple", "orange", "orange", "purple", "purple", "blue", "pink", "pink"] as const;

type GenreTone = (typeof genreTones)[number];
type StatTone = "pink" | "orange" | "purple";
type HomeStatItem = {
  label: string;
  value: string;
  suffix: string;
  icon: string;
  tone: StatTone;
  href?: string;
  isGenre?: boolean;
};

function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}

function getProductImage(product?: Product): string {
  if (!product) return "/no-image.svg";

  return (
    product.mainImageUrl ||
    product.images?.[0]?.thumbnailUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    "/no-image.svg"
  );
}

function genreHref(segment: SiteSegment, genre: GenreSummary): string {
  const genreId = genre.genreId || `dlsite:${genre.name}`;
  if (genreId.startsWith("dlsite:")) {
    return `${segment.path}/genre/dlsite:${encodeURIComponent(genreId.replace(/^dlsite:/, ""))}`;
  }
  return `${segment.path}/genre/${encodeURIComponent(genreId)}`;
}


function categoryHref(segment: SiteSegment, category: ProductCategorySummary, contentTypeParam?: string): string {
  if (category.kind === "contentType") {
    return buildFilterHref(`${segment.path}/ranking`, {}, { contentType: category.value });
  }
  return buildFilterHref(`${segment.path}/ranking`, {}, { workType: category.value, contentType: contentTypeParam });
}

function defaultCategorySummaries(): ProductCategorySummary[] {
  const contentTypeCategories = CONTENT_TYPE_OPTIONS.map((option) => ({
    name: option.label,
    categoryId: `contentType:${option.value}`,
    kind: "contentType" as const,
    value: option.value,
    productCount: 0,
    totalSalesCount: 0,
  }));

  const workTypeCategories = WORK_TYPE_OPTIONS.filter((option) => option.value !== "all").map((option) => ({
    name: option.label,
    categoryId: `workType:${option.value}`,
    kind: "workType" as const,
    value: option.value,
    productCount: 0,
    totalSalesCount: 0,
  }));

  return [...contentTypeCategories, ...workTypeCategories];
}

function getGenreIcon(index: number): string {
  return genreIcons[index % genreIcons.length];
}

function getGenreTone(index: number): GenreTone {
  return genreTones[index % genreTones.length];
}

function HomeStatsPanel({ stats, segment, contentTypeParam }: { stats: HomeDashboardStats; segment: SiteSegment; contentTypeParam?: string }) {
  const topGenre = stats.topGenre;
  const homeStats: HomeStatItem[] = [
    { label: "掲載作品数", value: formatNumber(stats.productCount), suffix: "作品", icon: "▣", tone: "pink" as const },
    { label: "本日の更新", value: formatNumber(stats.todayUpdatedCount), suffix: "作品", icon: "✦", tone: "orange" as const },
    { label: "セール件数", value: formatNumber(stats.saleCount), suffix: "件", icon: "◆", tone: "pink" as const },
    {
      label: "注目ジャンル",
      value: topGenre?.name ?? "取得待ち",
      suffix: topGenre ? `${formatNumber(topGenre.productCount)}作品` : "データなし",
      icon: "●",
      tone: "purple" as const,
      href: topGenre ? buildFilterHref(genreHref(segment, topGenre), {}, { contentType: contentTypeParam }) : undefined,
      isGenre: true,
    },
  ];

  return (
    <section className="sidebarCard sideMetricsPanel" aria-label="サイト指標">
      <div className="sideStatsGrid">
        {homeStats.map((stat) => {
          const content = (
            <>
              <span className={`iconShell iconTone--${stat.tone}`}>{stat.icon}</span>
              <span>
                <small>{stat.label}</small>
                <strong>
                  {stat.value}<em>{stat.suffix}</em>
                </strong>
              </span>
            </>
          );

          return stat.href ? (
            <Link className="statCard statCard--side statCard--genre" href={stat.href} key={stat.label}>
              {content}
            </Link>
          ) : (
            <div className={`statCard statCard--side${stat.isGenre ? " statCard--genre" : ""}`} key={stat.label}>
              {content}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HomeDashboard({
  segment,
  pagePath,
  rankingProducts,
  rankingWorkType,
  contentTypeParam,
  newProducts,
  recentProducts,
  newWorkType,
  saleProducts,
  stats,
  circleHighlights,
}: {
  segment: SiteSegment;
  pagePath: string;
  rankingProducts: Product[];
  rankingWorkType?: ProductWorkType;
  contentTypeParam?: string;
  newProducts: Product[];
  recentProducts: Product[];
  newWorkType?: ProductWorkType;
  saleProducts: Product[];
  stats: HomeDashboardStats;
  circleHighlights: SellerSummary[];
}) {
  const ranking = fillProducts(rankingProducts, 6);
  const newest = fillProducts(newProducts, 8);
  const sales = fillProducts(saleProducts, 8).map((product, index) => ({
    ...product,
    isDiscounted: product.isDiscounted ?? true,
    discountRate: product.discountRate ?? (index % 3 === 0 ? 30 : 20),
  }));
  const popularGenres = stats.popularGenres.slice(0, 12);
  const popularCategories = (stats.popularCategories.length ? stats.popularCategories : defaultCategorySummaries()).slice(0, 12);
  const rankingListHref = buildFilterHref(`${segment.path}/ranking`, {}, {
    workType: rankingWorkType,
    contentType: contentTypeParam,
  });
  const newListHref = buildFilterHref(`${segment.path}/new`, {}, { workType: newWorkType, contentType: contentTypeParam });

  return (
    <div className="dashboardPage">
      <div className="dashboardLayout">
        <div className="mainColumn">
          <section className="contentSection rankingSection">
            <SectionHeader title="人気ランキング" href={rankingListHref} icon="♕">
              <div className="homeSectionControls homeSectionControls--ranking">
                <WorkTypeTabs
                  basePath={pagePath}
                  currentWorkType={rankingWorkType}
                  currentParams={{
                    newWorkType,
                    contentType: contentTypeParam,
                  }}
                  paramName="rankingWorkType"
                />
              </div>
            </SectionHeader>
            <ProductGrid products={ranking} showRank variant="ranking" rail ariaLabel="人気ランキングの商品リスト" contentTypeParam={contentTypeParam} />
          </section>

          <section className="contentSection">
            <SectionHeader title="新着作品" href={newListHref} icon="NEW">
              <div className="homeSectionControls homeSectionControls--new">
                <WorkTypeTabs
                  basePath={pagePath}
                  currentWorkType={newWorkType}
                  currentParams={{
                    rankingWorkType,
                    contentType: contentTypeParam,
                  }}
                  paramName="newWorkType"
                />
              </div>
            </SectionHeader>
            <ProductGrid products={newest} variant="new" rail ariaLabel="新着作品の商品リスト" contentTypeParam={contentTypeParam} />
          </section>

          <section className="contentSection">
            <SectionHeader title="セール・値引き中" href={buildFilterHref(`${segment.path}/sale`, {}, { contentType: contentTypeParam })} icon="◆" />
            <ProductGrid products={sales} variant="sale" rail ariaLabel="セール作品の商品リスト" contentTypeParam={contentTypeParam} />
          </section>

        </div>
        <div className="dashboardSideStack">
          <HomeStatsPanel stats={stats} segment={segment} contentTypeParam={contentTypeParam} />
          <DashboardSidebar popularGenres={popularGenres} recentProducts={recentProducts} segment={segment} contentTypeParam={contentTypeParam} />
        </div>
        <section className="contentSection railOnlySection dashboardFullWidthSection">
          <SectionHeader title="カテゴリから探す" href={buildFilterHref(`${segment.path}/ranking`, {}, { contentType: contentTypeParam })} icon="▤" />
          <ScrollRail ariaLabel="カテゴリ一覧">
            {popularCategories.length ? popularCategories.map((category, index) => (
              <Link className="genreCard" href={categoryHref(segment, category, contentTypeParam)} key={category.categoryId}>
                <GenreIcon tone={getGenreTone(index)}>{getGenreIcon(index)}</GenreIcon>
                <span><strong>{category.name}</strong><small>{formatNumber(category.productCount)}作品</small></span>
              </Link>
            )) : (
              <div className="genreCard genreCard--empty">
                <GenreIcon tone="pink">▤</GenreIcon>
                <span><strong>カテゴリ取得待ち</strong><small>作品データ取得後に表示</small></span>
              </div>
            )}
          </ScrollRail>
        </section>

        <section className="contentSection railOnlySection dashboardFullWidthSection">
          <SectionHeader title="注目サークル" href={buildFilterHref(`${segment.path}/circle`, {}, { contentType: contentTypeParam })} icon="♕" />
          <ScrollRail ariaLabel="注目サークル一覧">
            {circleHighlights.length ? circleHighlights.map((circle) => (
              <Link className="circleCard" href={buildFilterHref(`${segment.path}/circle/${encodeURIComponent(circle.sellerKey)}`, {}, { contentType: contentTypeParam })} key={circle.sellerKey}>
                <img src={getProductImage(circle.topProduct ?? circle.latestProduct)} alt="" loading="lazy" />
                <span><strong>{circle.sellerName}</strong><small>作品 {formatNumber(circle.productCount)} / 販売 {formatNumber(circle.totalSalesCount)}</small></span>
                <em>詳細</em>
              </Link>
            )) : (
              <div className="circleCard circleCard--empty">サークルデータ取得後に表示されます。</div>
            )}
          </ScrollRail>
        </section>
      </div>
    </div>
  );
}
