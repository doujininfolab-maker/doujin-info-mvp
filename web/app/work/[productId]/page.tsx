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
import {
  contentTypeParamForScope,
  getContentScopeLabel,
  parseContentScope,
  type ProductContentScope,
} from "@/lib/contentCategories";
import { formatDate, formatNumber, formatRating } from "@/lib/format";
import { getSegmentPath } from "@/lib/siteSegments";
import type {
  CurrentDailyRevenueRanking,
  Product,
  ProductRatingBreakdown,
  ProductSalesEdition,
  SourceRankingEntry,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ productId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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

function getSingleQueryValue(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.trim() || undefined;
}

function normalizeStoredContentType(value: string | undefined): "tl" | "bl" | undefined {
  const raw = value?.toString().replace(/^dlsite:/, "").trim().toLowerCase();
  if (!raw) return undefined;
  if (["tl", "otm", "乙女向け", "ティーンズラブ"].includes(raw)) return "tl";
  if (["bl", "bl1", "ボーイズラブ"].includes(raw)) return "bl";
  return undefined;
}

function productHasContentType(product: Product, contentType: "tl" | "bl"): boolean {
  const ids = (product.contentTypeIds ?? []).map((id) => normalizeStoredContentType(id));
  if (ids.includes(contentType)) return true;
  const labels = (product.contentTypes ?? []).map((label) => normalizeStoredContentType(label));
  return labels.includes(contentType);
}

function resolveDetailContentScope(
  value: string | string[] | undefined,
  product: Product,
): ProductContentScope {
  const raw = getSingleQueryValue(value)?.toLowerCase();
  if (raw === "all" || raw === "tl" || raw === "bl") {
    return parseContentScope(raw);
  }

  const isTl = productHasContentType(product, "tl");
  const isBl = productHasContentType(product, "bl");
  return isBl && !isTl ? "bl" : "tl";
}

function formatCurrentRankingSourceDate(value: string): string | undefined {
  const match = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return `${month}/${day}`;
}

type DisplayCurrentDailyRevenueRanking = CurrentDailyRevenueRanking & {
  sourceDateLabel: string;
};

function getDisplayCurrentDailyRevenueRanking(
  product: Product,
  contentScope: ProductContentScope,
): DisplayCurrentDailyRevenueRanking | undefined {
  const ranking = product.currentDailyRevenueRankings?.[contentScope];
  if (
    !ranking ||
    !Number.isInteger(ranking.rank) ||
    ranking.rank < 1 ||
    ranking.rank > 300
  ) {
    return undefined;
  }

  const sourceDateLabel = formatCurrentRankingSourceDate(ranking.sourceDate);
  return sourceDateLabel ? { ...ranking, sourceDateLabel } : undefined;
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function getDisplayRankingDate(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;

  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return undefined;
  }

  return normalized;
}

function getDisplayRatingBreakdown(product: Product): ProductRatingBreakdown[] {
  const ratingCount = product.ratingCount ?? product.reviewCount;
  if (
    !isNonNegativeInteger(ratingCount) ||
    ratingCount === 0 ||
    !Array.isArray(product.ratingBreakdown)
  ) {
    return [];
  }

  const breakdownByStar = new Map<ProductRatingBreakdown["star"], number>();
  for (const item of product.ratingBreakdown) {
    if (
      !item ||
      !([1, 2, 3, 4, 5] as const).includes(item.star) ||
      !isNonNegativeInteger(item.count) ||
      breakdownByStar.has(item.star)
    ) {
      return [];
    }
    breakdownByStar.set(item.star, item.count);
  }

  if (breakdownByStar.size !== 5) return [];

  const breakdown = ([5, 4, 3, 2, 1] as const).map((star) => ({
    star,
    count: breakdownByStar.get(star) ?? 0,
  }));
  const breakdownTotal = breakdown.reduce((sum, item) => sum + item.count, 0);

  return breakdownTotal === ratingCount ? breakdown : [];
}

const SOURCE_RANKING_TERMS = [
  { term: "day", label: "24時間" },
  { term: "week", label: "7日間" },
  { term: "month", label: "30日間" },
  { term: "total", label: "累計" },
] as const;

const SOURCE_RANKING_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  all: "総合",
  game: "ゲーム",
  comic: "マンガ・ノベル",
  illust: "CG・イラスト",
  cg: "CG・イラスト",
  novel: "ノベル",
  movie: "動画",
  audio: "ボイス・ASMR",
  voice: "ボイス・ASMR",
  music: "音楽",
  tool: "ツール/アクセサリ",
  etc: "その他",
  other: "その他",
};

type DisplaySourceRanking = SourceRankingEntry & { label: string };

function getSourceRankingCategoryLabel(category: string): string {
  const normalizedCategory = category.trim().toLowerCase();
  return SOURCE_RANKING_CATEGORY_LABELS[normalizedCategory] ?? category.trim();
}

function getDisplaySourceRankings(product: Product): DisplaySourceRanking[] {
  if (!Array.isArray(product.sourceRankings)) return [];

  const rankingsByKey = new Map<string, SourceRankingEntry>();
  const categoryOrder = new Map<string, number>();

  for (const ranking of product.sourceRankings) {
    const category = ranking?.category?.trim();
    const normalizedCategory = category?.toLowerCase();
    if (
      !ranking ||
      !category ||
      !normalizedCategory ||
      !SOURCE_RANKING_TERMS.some(({ term }) => term === ranking.term) ||
      !isNonNegativeInteger(ranking.rank) ||
      ranking.rank < 1
    ) {
      continue;
    }

    if (!categoryOrder.has(normalizedCategory)) {
      categoryOrder.set(normalizedCategory, categoryOrder.size);
    }

    const key = `${normalizedCategory}:${ranking.term}`;
    if (!rankingsByKey.has(key)) {
      rankingsByKey.set(key, { ...ranking, category });
    }
  }

  const termOrder = new Map(
    SOURCE_RANKING_TERMS.map(({ term }, index) => [term, index]),
  );

  return [...rankingsByKey.values()]
    .sort((left, right) => {
      const leftCategory = left.category.trim().toLowerCase();
      const rightCategory = right.category.trim().toLowerCase();
      const leftCategoryOrder =
        leftCategory === "all" ? -1 : (categoryOrder.get(leftCategory) ?? 0);
      const rightCategoryOrder =
        rightCategory === "all" ? -1 : (categoryOrder.get(rightCategory) ?? 0);

      return (
        leftCategoryOrder - rightCategoryOrder ||
        (termOrder.get(left.term) ?? Number.MAX_SAFE_INTEGER) -
          (termOrder.get(right.term) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map((ranking) => {
      const termLabel = SOURCE_RANKING_TERMS.find(
        ({ term }) => term === ranking.term,
      )?.label;
      const categoryLabel = getSourceRankingCategoryLabel(ranking.category);
      return {
        ...ranking,
        rankDate: getDisplayRankingDate(ranking.rankDate),
        label: `${termLabel ?? ranking.term}（${categoryLabel}）`,
      };
    });
}

function getDisplaySalesEditions(product: Product): ProductSalesEdition[] {
  if (!Array.isArray(product.salesEditions) || product.salesEditions.length === 0) return [];

  const editions: ProductSalesEdition[] = [];
  for (const edition of product.salesEditions) {
    const languageLabel = edition?.languageLabel?.trim() || edition?.languageCode?.trim();
    if (
      !edition ||
      typeof edition.sourceProductId !== "string" ||
      !edition.sourceProductId.trim() ||
      !languageLabel ||
      !isNonNegativeInteger(edition.salesCount)
    ) {
      return [];
    }
    editions.push(edition);
  }

  editions.sort((left, right) => {
    const leftOrder = Number.isFinite(left.displayOrder) ? left.displayOrder! : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.displayOrder) ? right.displayOrder! : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.sourceProductId.localeCompare(right.sourceProductId);
  });

  const editionTotal = editions.reduce((sum, edition) => sum + edition.salesCount, 0);
  const displayTotal = resolveDisplayTotalSalesCount(product.totalSalesCount, product.salesCount);
  return displayTotal === undefined || editionTotal === displayTotal ? editions : [];
}


export default async function WorkDetailPage({ params, searchParams }: PageProps) {
  const { productId } = await params;
  const query = searchParams ? await searchParams : {};
  const product = await getProductById(productId);
  if (!product) notFound();

  const officialUrl = getProductOutboundUrl(product);
  const segmentPath = getSegmentPath(product.platform, product.audience, product.category);
  const headerImage = product.thumbnailUrl || product.mainImageUrl || product.images?.[0]?.url || "/no-image.svg";
  const primaryGenreLabel = product.workTypeLabel || getPrimaryGenreLabel(product.genres ?? [], product.category);
  const workTypeHref = buildWorkTypeHref(segmentPath, product.workType);
  const sellerHref = buildSellerHref(segmentPath, product.seller?.sellerId, product.seller?.sellerName);
  const contentScope = resolveDetailContentScope(query.contentType, product);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const contentScopeLabel = getContentScopeLabel(contentScope);
  const currentDailyRevenueRanking = getDisplayCurrentDailyRevenueRanking(
    product,
    contentScope,
  );
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
  const ratingBreakdown = getDisplayRatingBreakdown(product);
  const ratingBreakdownMax = Math.max(0, ...ratingBreakdown.map((item) => item.count));
  const sourceRankings = getDisplaySourceRankings(product);
  const salesEditions = getDisplaySalesEditions(product);
  const salesEditionsTotal = salesEditions.reduce((sum, edition) => sum + edition.salesCount, 0);
  const showDetailDataRail =
    ratingBreakdown.length > 0 || sourceRankings.length > 0 || salesEditions.length > 0;

  return (
    <div className={`detailPage${showDetailDataRail ? " detailPage--withDataRail" : ""}`}>
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
        {currentDailyRevenueRanking ? (
          <div
            className="detailRankBadge"
            aria-label={`${contentScopeLabel}全作品の推定日間売上ランキング${currentDailyRevenueRanking.rank}位、${currentDailyRevenueRanking.sourceDateLabel}集計`}
          >
            <span>♛</span>
            <strong>推定日間売上 {formatNumber(currentDailyRevenueRanking.rank)}位</strong>
            <small>
              {contentScopeLabel}・全作品・{currentDailyRevenueRanking.sourceDateLabel}集計
            </small>
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

      {showDetailDataRail ? (
        <aside className="detailDataRail" aria-label="作品データ内訳">
          {ratingBreakdown.length > 0 ? (
            <section className="detailDataCard" aria-labelledby="rating-breakdown-heading">
              <h2 id="rating-breakdown-heading" className="detailDataCard__heading">評価内訳</h2>
              <div className="ratingBreakdown">
                {ratingBreakdown.map((item) => {
                  const width = ratingBreakdownMax > 0 ? (item.count / ratingBreakdownMax) * 100 : 0;
                  return (
                    <div className="ratingBreakdown__row" key={item.star}>
                      <span className="ratingBreakdown__label">★{item.star}</span>
                      <span className="ratingBreakdown__track" aria-hidden="true">
                        <span className="ratingBreakdown__bar" style={{ width: `${width}%` }} />
                      </span>
                      <span className="ratingBreakdown__count">{formatNumber(item.count)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {sourceRankings.length > 0 ? (
            <section className="detailDataCard" aria-labelledby="source-rankings-heading">
              <div className="detailDataCard__titleRow">
                <h2 id="source-rankings-heading" className="detailDataCard__heading">ランキング内訳</h2>
                <span className="detailDataCard__source">DLsite公式</span>
              </div>
              <dl className="detailDataList">
                {sourceRankings.map((ranking) => (
                  <div className="detailDataList__row" key={`${ranking.category}:${ranking.term}`}>
                    <dt>{ranking.label}</dt>
                    <dd className="detailDataList__value detailDataList__value--ranking">
                      <span className="detailDataList__rank">{formatNumber(ranking.rank)}位</span>
                      {ranking.rankDate ? (
                        <time className="detailDataList__date" dateTime={ranking.rankDate}>
                          {formatDate(ranking.rankDate)}
                        </time>
                      ) : null}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          {salesEditions.length > 0 ? (
            <section className="detailDataCard" aria-labelledby="sales-editions-heading">
              <h2 id="sales-editions-heading" className="detailDataCard__heading">言語別販売数</h2>
              <dl className="detailDataList">
                {salesEditions.map((edition, index) => (
                  <div className="detailDataList__row" key={`${edition.sourceProductId}_${index}`}>
                    <dt>{edition.languageLabel?.trim() || edition.languageCode?.trim()}</dt>
                    <dd className="detailDataList__value">{formatNumber(edition.salesCount)}</dd>
                  </div>
                ))}
                <div className="detailDataList__row detailDataList__row--total">
                  <dt>総DL数</dt>
                  <dd className="detailDataList__value detailDataList__value--accent">
                    {formatNumber(salesEditionsTotal)}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
        </aside>
      ) : null}

      <article className="detailBelow">
        {showTrendCharts ? (
          <WorkTrendCharts
            priceCurrent={product.priceCurrent}
            priceOriginal={product.priceOriginal}
            salesCount={product.salesCount}
            trendPoints={trendPoints}
            trendDataUrl={`/api/trends/product/${encodeURIComponent(product.productId)}`}
            initialTrendDays={initialTrendDays}
            compactPrimaryHeader
          />
        ) : null}

        {sameSellerProducts.length > 0 ? (
          <section className="detailSection sameSellerSection">
            <h2>同じサークルの作品</h2>
            <ProductGrid
              products={sameSellerProducts}
              variant="list"
              contentTypeParam={contentTypeParam}
            />
          </section>
        ) : null}

      </article>
    </div>
  );
}
