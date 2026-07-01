import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { WorkTrendCharts } from "@/components/WorkTrendCharts";
import { getSellerSummaryByKey } from "@/lib/firebase/products";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import { buildFilterHref } from "@/lib/workTypes";
import { formatDate, formatNumber } from "@/lib/format";
import { getSegment, getSegmentPath } from "@/lib/siteSegments";

export const dynamic = "force-dynamic";

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

function getMonthsBetween(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const startDate = new Date(`${start}T00:00:00+09:00`);
  const endDate = new Date(`${end}T00:00:00+09:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return undefined;
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + endDate.getMonth() - startDate.getMonth() + 1;
  return Math.max(1, months);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category, sellerKey } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment) return { title: "サークル詳細" };

  const summary = await getSellerSummaryByKey({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    sellerKey,
  });

  return { title: summary ? `${summary.sellerName}のサークル情報` : "サークル詳細" };
}

export default async function CircleDetailPage({ params, searchParams }: PageProps) {
  const { platform, audience, category, sellerKey } = await params;
  const query = searchParams ? await searchParams : {};
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const summary = await getSellerSummaryByKey({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    sellerKey,
    contentType,
  });

  if (!summary) notFound();

  const segmentPath = getSegmentPath(summary.platform, summary.audience, summary.category);
  const imageUrl = getSellerImage(summary);
  const months = getMonthsBetween(summary.firstReleaseDate, summary.latestReleaseDate);
  const products = (summary.products ?? []).slice(0, 30);
  const graphPrice = summary.averagePrice || products.find((product) => product.priceCurrent)?.priceCurrent || 1000;
  const circleSalesCount = summary.products?.reduce((sum, product) => sum + (product.salesCount ?? 0), 0) ?? summary.totalSalesCount;

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

      <section className="circleOverview">
        <div className="circleOverview__tableWrap">
          <dl className="circleInfoTable">
            <div><dt>作品数</dt><dd>{formatNumber(summary.productCount)}</dd></div>
            <div><dt>新作ペース</dt><dd>{months ? `${months}ヶ月` : "-"}</dd></div>
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

      <div className="circleSalesTrendOnly">
        <WorkTrendCharts
          priceCurrent={graphPrice}
          priceOriginal={graphPrice}
          salesCount={circleSalesCount}
        />
      </div>

      <section className="detailSection sameSellerSection circleWorksSection">
        <h2>「{summary.sellerName}」のサークル作品</h2>
        <ProductGrid products={products} variant="list" contentTypeParam={contentTypeParam} />
      </section>
    </div>
  );
}
