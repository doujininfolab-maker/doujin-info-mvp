import type { Metadata } from "next";
import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { ListPageInfo } from "@/components/ListPageInfo";
import { WorkTrendCharts } from "@/components/WorkTrendCharts";
import {
  getAggregateTrendPointsForProducts,
  getAggregateTrendPointsFromProductSnapshots,
  getSellerSummaryByKey,
  hasRecentProductTrendData,
} from "@/lib/firebase/products";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";
import { buildFilterHref } from "@/lib/workTypes";
import { formatDate, formatNumber } from "@/lib/format";
import { getSegment, getSegmentPath } from "@/lib/siteSegments";

export const dynamic = "force-dynamic";


const getCachedSellerSummary = cache(async (
  platform: string,
  audience: string,
  category: string,
  sellerKey: string,
  contentType?: "tl" | "bl",
) => getSellerSummaryByKey({
  platform: platform as "dlsite" | "fanza",
  audience: audience as "female" | "male" | "general",
  category: category as "doujin" | "game" | "video" | "ebook",
  sellerKey,
  contentType,
}));

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string; sellerKey: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getSellerImage(summary: NonNullable<Awaited<ReturnType<typeof getSellerSummaryByKey>>>): string {
  return (
    summary.topProduct?.thumbnailUrl ||
    summary.topProduct?.mainImageUrl ||
    summary.topProduct?.images?.[0]?.url ||
    summary.latestProduct?.thumbnailUrl ||
    "/no-image.svg"
  );
}

function buildGenreHref(segmentPath: string, genreName: string): string {
  const normalizedGenre = genreName.trim().toLowerCase();
  return `${segmentPath}/genre/dlsite:${encodeURIComponent(normalizedGenre)}`;
}

function formatPeriod(start?: string, end?: string): string {
  if (!start && !end) return "-";
  return `${formatDate(start)} ～ ${formatDate(end)}`;
}

function formatAverageReleaseInterval(start: string | undefined, end: string | undefined, productCount: number): string {
  if (!start || !end || productCount < 2) return "-";

  const startDate = new Date(`${start}T00:00:00+09:00`);
  const endDate = new Date(`${end}T00:00:00+09:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "-";

  const elapsedDays = Math.max(0, (endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  const intervalDays = elapsedDays / Math.max(productCount - 1, 1);

  if (intervalDays < 30.4375) {
    return `約${Math.max(1, Math.round(intervalDays))}日に1作品`;
  }

  const intervalMonths = intervalDays / 30.4375;
  const roundedMonths = intervalMonths >= 10 ? Math.round(intervalMonths) : Math.round(intervalMonths * 10) / 10;
  return `約${roundedMonths}ヶ月に1作品`;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { platform, audience, category, sellerKey } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment) return { title: "サークル詳細" };
  const query = searchParams ? await searchParams : {};
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);

  const summary = await getCachedSellerSummary(
    segment.platform,
    segment.audience,
    segment.category,
    sellerKey,
    contentType,
  );

  return {
    title: summary ? `${summary.sellerName}のサークル情報` : "サークル詳細",
    alternates: {
      canonical: `${segment.path}/circle/${encodeURIComponent(sellerKey)}`,
    },
  };
}

export default async function CircleDetailPage({ params, searchParams }: PageProps) {
  const { platform, audience, category, sellerKey } = await params;
  const query = searchParams ? await searchParams : {};
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const summary = await getCachedSellerSummary(
    segment.platform,
    segment.audience,
    segment.category,
    sellerKey,
    contentType,
  );

  if (!summary) notFound();

  const segmentPath = getSegmentPath(summary.platform, summary.audience, summary.category);
  const imageUrl = getSellerImage(summary);
  const averageReleaseInterval = formatAverageReleaseInterval(summary.firstReleaseDate, summary.latestReleaseDate, summary.productCount);
  const sellerProducts = summary.products ?? [];
  const products = [...sellerProducts].sort((a, b) => {
    const releaseDateDiff = (b.releaseDate ?? "").localeCompare(a.releaseDate ?? "");
    if (releaseDateDiff !== 0) return releaseDateDiff;

    const titleDiff = (a.title ?? "").localeCompare(b.title ?? "", "ja");
    if (titleDiff !== 0) return titleDiff;
    return a.productId.localeCompare(b.productId);
  });
  const graphPrice = summary.averagePrice || sellerProducts.find((product) => product.priceCurrent)?.priceCurrent || 1000;
  const circleSalesCount = sellerProducts.reduce((sum, product) => sum + (product.salesCount ?? 0), 0) || summary.totalSalesCount;
  const snapshotTrendPoints = getAggregateTrendPointsFromProductSnapshots(sellerProducts, 35);
  const useSnapshotTrend = hasRecentProductTrendData(snapshotTrendPoints);
  const trendPoints = useSnapshotTrend
    ? snapshotTrendPoints
    : await getAggregateTrendPointsForProducts(sellerProducts, 30);
  const initialTrendDays = useSnapshotTrend ? 35 : 30;
  const showTrendCharts = hasRecentProductTrendData(trendPoints);
  const sellerTrendBaseUrl = `/api/trends/seller/${encodeURIComponent(segment.platform)}/${encodeURIComponent(segment.audience)}/${encodeURIComponent(segment.category)}/${encodeURIComponent(summary.sellerKey)}`;
  const sellerTrendUrl = contentType
    ? `${sellerTrendBaseUrl}?contentType=${contentType}`
    : sellerTrendBaseUrl;

  return (
    <div className="circleDetailPage">
      <nav className="circleBreadcrumb" aria-label="パンくず">
        <Link href="/">ホーム</Link>
        <span>›</span>
        <Link href={buildFilterHref(segmentPath, {}, { contentType: contentTypeParam })}>DLsite女性向け同人</Link>
        <span>›</span>
        <Link href={buildFilterHref(`${segmentPath}/circle`, {}, { contentType: contentTypeParam })}>サークル一覧</Link>
        <span>›</span>
        <span>{summary.sellerName}</span>
      </nav>

      <header className="circleHeader">
        <img src={imageUrl} alt="" />
        <div>
          <div className="circleHeader__line">
            <span>サークル</span>
            <h1>{summary.sellerName}</h1>
          </div>
          {summary.newestProductTitle ? <p><strong>最新作</strong> {summary.newestProductTitle}</p> : null}
        </div>
      </header>

      <ListPageInfo
        title="サークルの販売実績と作品傾向を確認できます"
        description="代表作・最新作・販売数・ジャンル傾向をまとめています。下部の作品一覧は発売日が新しい順で表示します。"
        items={[
          { label: "対象", value: getContentScopeLabel(contentScope) },
          { label: "作品数", value: `${formatNumber(summary.productCount)}件` },
          { label: "合計販売数", value: `${formatNumber(summary.totalSalesCount)}本` },
          { label: "配信期間", value: formatPeriod(summary.firstReleaseDate, summary.latestReleaseDate) },
        ]}
      />

      <section className="circleOverview">
        <div className="circleOverview__tableWrap">
          <dl className="circleInfoTable">
            <div><dt>作品数</dt><dd>{formatNumber(summary.productCount)}</dd></div>
            <div><dt>平均発売間隔</dt><dd>{averageReleaseInterval}</dd></div>
            <div><dt>合計販売数</dt><dd>{formatNumber(summary.totalSalesCount)}</dd></div>
            <div><dt>平均販売数</dt><dd>{formatNumber(summary.averageSalesCount)}</dd></div>
            <div className="circleInfoTable__wide"><dt>配信期間</dt><dd>{formatPeriod(summary.firstReleaseDate, summary.latestReleaseDate)}</dd></div>
            <div className="circleInfoTable__wide circleInfoTable__tags">
              <dt>ジャンル</dt>
              <dd>
                {summary.tags.slice(0, 18).map((tag) => (
                  <Link href={buildFilterHref(buildGenreHref(segmentPath, tag.name), {}, { contentType: contentTypeParam })} key={tag.name}>
                    {tag.name}<small>{tag.count}</small>
                  </Link>
                ))}
              </dd>
            </div>
          </dl>
        </div>

      </section>

      {showTrendCharts ? (
        <div className="circleSalesTrendOnly">
          <WorkTrendCharts
            priceCurrent={graphPrice}
            priceOriginal={graphPrice}
            salesCount={circleSalesCount}
            trendPoints={trendPoints}
            trendDataUrl={sellerTrendUrl}
            initialTrendDays={initialTrendDays}
          />
        </div>
      ) : null}

      <section className="detailSection sameSellerSection circleWorksSection">
        <h2>「{summary.sellerName}」のサークル作品</h2>
        <p className="circleWorksSection__lead">発売日が新しい順で表示しています。</p>
        <ProductGrid products={products} variant="list" contentTypeParam={contentTypeParam} />
      </section>
    </div>
  );
}
