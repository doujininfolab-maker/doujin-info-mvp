import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { WorkTrendCharts } from "@/components/WorkTrendCharts";
import { ProductGrid } from "@/components/ProductGrid";
import { PriceLabel } from "@/components/PriceLabel";
import { PlatformBadge } from "@/components/PlatformBadge";
import {
  getProductById,
  getProductTrendPoints,
  getProductTrendPointsFromSnapshots,
  getProductsBySameSeller,
  hasRecentProductTrendData,
} from "@/lib/firebase/products";
import { getProductOutboundUrl } from "@/lib/affiliate";
import { formatDate, formatNumber, formatRating } from "@/lib/format";
import { getSegmentPath } from "@/lib/siteSegments";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ productId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { productId } = await params;
  const product = await getProductById(productId);

  if (!product) {
    return { title: "商品が見つかりません" };
  }

  const description = product.description || `${product.title}の価格・ランキング・ジャンル情報を確認できます。`;
  const image = product.thumbnailUrl || product.mainImageUrl || product.images?.[0]?.url;

  const canonical = `/work/${encodeURIComponent(product.productId)}`;

  return {
    title: product.title,
    description,
    alternates: { canonical },
    openGraph: {
      title: product.title,
      description,
      type: "article",
      url: canonical,
      images: image ? [{ url: image }] : undefined,
    },
  };
}

function getPrimaryGenreLabel(genres: string[], category: string): string {
  const normalizedGenres = genres.map((genre) => genre.trim()).filter(Boolean);

  if (normalizedGenres.some((genre) => ["マンガ", "漫画", "コミック"].includes(genre))) {
    return "マンガ";
  }

  if (normalizedGenres.some((genre) => genre.includes("ノベル") || genre.includes("小説"))) {
    return "ノベル";
  }

  if (normalizedGenres.some((genre) => genre.includes("音声") || genre.includes("ASMR"))) {
    return "音声";
  }

  if (normalizedGenres.some((genre) => genre.includes("ゲーム"))) {
    return "ゲーム";
  }

  if (category === "comic") return "マンガ";
  if (category === "voice") return "音声";
  if (category === "game") return "ゲーム";
  return "同人";
}

function getDailyRank(product: Awaited<ReturnType<typeof getProductById>>): number | undefined {
  return product?.latestRankings?.find((ranking) => ranking.type === "daily")?.rank;
}

function buildGenreHref(segmentPath: string, genre: string): string {
  const normalizedGenre = genre.trim().toLowerCase();
  return `${segmentPath}/genre/dlsite:${encodeURIComponent(normalizedGenre)}`;
}

function buildWorkTypeHref(segmentPath: string, workType?: string): string {
  return workType ? `${segmentPath}/ranking?workType=${workType}` : `${segmentPath}/ranking`;
}

function buildSellerHref(segmentPath: string, sellerId?: string, sellerName?: string): string | undefined {
  const sellerKey = sellerId?.trim() || sellerName?.trim();
  return sellerKey ? `${segmentPath}/circle/${encodeURIComponent(sellerKey)}` : undefined;
}

function resolveDisplayTotalSalesCount(
  totalSalesCount?: number,
  salesCount?: number,
): number | undefined {
  const validSalesCount =
    typeof salesCount === "number" &&
    Number.isFinite(salesCount) &&
    salesCount >= 0
      ? salesCount
      : undefined;
  const validTotalSalesCount =
    typeof totalSalesCount === "number" &&
    Number.isFinite(totalSalesCount) &&
    totalSalesCount >= 0
      ? totalSalesCount
      : undefined;

  if (
    validTotalSalesCount !== undefined &&
    (validSalesCount === undefined || validTotalSalesCount >= validSalesCount)
  ) {
    return validTotalSalesCount;
  }

  return validSalesCount;
}


export default async function WorkDetailPage({ params }: PageProps) {
  const { productId } = await params;
  const product = await getProductById(productId);
  if (!product) notFound();

  const officialUrl = getProductOutboundUrl(product);
  const segmentPath = getSegmentPath(product.platform, product.audience, product.category);
  const headerImage = product.thumbnailUrl || product.mainImageUrl || product.images?.[0]?.url || "/no-image.svg";
  const primaryGenreLabel = product.workTypeLabel || getPrimaryGenreLabel(product.genres ?? [], product.category);
  const workTypeHref = buildWorkTypeHref(segmentPath, product.workType);
  const sellerHref = buildSellerHref(segmentPath, product.seller?.sellerId, product.seller?.sellerName);
  const dailyRank = getDailyRank(product);
  const snapshotTrendPoints = getProductTrendPointsFromSnapshots(product, 35);
  const useSnapshotTrend = hasRecentProductTrendData(snapshotTrendPoints);
  const [sameSellerProducts, trendPoints] = await Promise.all([
    getProductsBySameSeller({
      platform: product.platform,
      audience: product.audience,
      category: product.category,
      sellerId: product.seller?.sellerId,
      sellerName: product.seller?.sellerName,
      excludeProductId: product.productId,
    }),
    useSnapshotTrend
      ? Promise.resolve(snapshotTrendPoints)
      : getProductTrendPoints(product.productId, 30),
  ]);
  const initialTrendDays = useSnapshotTrend ? 35 : 30;
  const showTrendCharts = hasRecentProductTrendData(trendPoints);

  return (
    <div className="detailPage">
      <header className="detailHeader detailHeader--compact">
        <div className="detailHeader__workThumb">
          <img src={headerImage} alt="" />
        </div>
        <div className="detailHeader__body">
          <div className="detailHeader__metaLine">
            <Link className="detailHeader__genrePill" href={workTypeHref}>{primaryGenreLabel}</Link>
            <div className="badgeRow detailHeader__badges">
              <PlatformBadge platform={product.platform} audience={product.audience} category={product.category} />
            </div>
          </div>
          <h1 className="detailTitle detailTitle--compact">{product.title}</h1>
          {product.seller?.sellerName ? (
            <p className="detailHeader__seller">
              {sellerHref ? <Link href={sellerHref}>{product.seller.sellerName}</Link> : product.seller.sellerName}
            </p>
          ) : null}
        </div>
        {dailyRank ? (
          <div className="detailRankBadge" aria-label={`日間ランキング${dailyRank}位`}>
            <span>♛</span>
            <strong>日間{dailyRank}位</strong>
            <small>ランキング中</small>
          </div>
        ) : null}
      </header>

      <div className="detailMain">
        <ProductImageGallery title={product.title} images={product.images ?? []} officialUrl={officialUrl} />

        <aside className="detailSide">
          <PriceLabel
            priceCurrent={product.priceCurrent}
            priceOriginal={product.priceOriginal}
            discountRate={product.discountRate}
            isDiscounted={product.isDiscounted}
          />

          <dl className="detailMetaTable">
            <div>
              <dt>サークル</dt>
              <dd>{product.seller?.sellerName ? (sellerHref ? <Link href={sellerHref}>{product.seller.sellerName}</Link> : product.seller.sellerName) : "-"}</dd>
            </div>
            <div>
              <dt>総DL数</dt>
              <dd>{formatNumber(resolveDisplayTotalSalesCount(product.totalSalesCount, product.salesCount))}</dd>
            </div>
            <div><dt>評価</dt><dd>{formatRating(product.rating ?? product.ratingAverage)}</dd></div>
            <div><dt>評価数</dt><dd>{formatNumber(product.ratingCount ?? product.reviewCount)}</dd></div>
            <div><dt>発売日</dt><dd>{formatDate(product.releaseDate)}</dd></div>
          </dl>

          <div className="buttonRow buttonRow--side">
            <a className="button button--official" href={officialUrl} target="_blank" rel="sponsored noreferrer">
              DLsiteで詳細を見る
            </a>
            <Link className="button button--ghost" href={segmentPath}>
              一覧へ戻る
            </Link>
          </div>

          {product.genres.length > 0 ? (
            <section className="detailSideSection">
              <h2>ジャンル</h2>
              <div className="tagList">
                {product.genres.slice(0, 12).map((genre, index) => (
                  <Link className="tagList__item" href={buildGenreHref(segmentPath, genre)} key={`${genre}_${index}`}>
                    {genre}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <article className="detailBelow">
        {showTrendCharts ? (
          <WorkTrendCharts
            priceCurrent={product.priceCurrent}
            priceOriginal={product.priceOriginal}
            salesCount={product.salesCount}
            trendPoints={trendPoints}
            trendDataUrl={`/api/trends/product/${encodeURIComponent(product.productId)}`}
            initialTrendDays={initialTrendDays}
          />
        ) : null}

        {sameSellerProducts.length > 0 ? (
          <section className="detailSection sameSellerSection">
            <h2>同じサークルの作品</h2>
            <ProductGrid products={sameSellerProducts} variant="list" />
          </section>
        ) : null}

      </article>
    </div>
  );
}
