import Link from "next/link";
import type { GenreRankingItem, GenreSortMode, ProductRankingMode, SiteSegment } from "@/lib/types";
import { formatNumber } from "@/lib/format";
import { buildFilterHref } from "@/lib/workTypes";

function genreHref(segment: SiteSegment, genreId: string): string {
  if (genreId.startsWith("dlsite:")) {
    return `${segment.path}/genre/dlsite:${encodeURIComponent(genreId.replace(/^dlsite:/, ""))}`;
  }
  return `${segment.path}/genre/${encodeURIComponent(genreId)}`;
}

function productImage(product: GenreRankingItem["topProducts"][number]): string {
  return product.mainImageUrl || product.thumbnailUrl || ("images" in product ? product.images?.[0]?.url || product.images?.[0]?.thumbnailUrl : undefined) || "/no-image.svg";
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0円";
  return `${formatNumber(Math.round(value))}円`;
}

function periodLabel(mode: ProductRankingMode): string {
  if (mode === "weekly") return "週間";
  if (mode === "monthly") return "月間";
  if (mode === "cumulative") return "累計";
  return "日間";
}

export function GenreRankingCard({
  item,
  segment,
  rankingMode,
  sortMode,
  contentTypeParam,
}: {
  item: GenreRankingItem;
  segment: SiteSegment;
  rankingMode: ProductRankingMode;
  sortMode: GenreSortMode;
  contentTypeParam?: string;
}) {
  const href = buildFilterHref(genreHref(segment, item.genreId), {}, { contentType: contentTypeParam });
  const label = periodLabel(rankingMode);

  return (
    <article className="genreRankingCard">
      <div className="genreRankingCard__rank" aria-label={`${item.rank}位`}>
        <span>♛</span>
        <strong>{item.rank}</strong>
      </div>
      <div className="genreRankingCard__body">
        <Link className="genreRankingCard__title" href={href} prefetch={false}>{item.name}</Link>
        <div className="genreRankingCard__meta">
          <span>{label}販売作品数：{formatNumber(item.productCount)}</span>
          <span>{label}販売数：{formatNumber(item.totalSalesCount)}本</span>
          {sortMode === "revenue" ? <span>{label}推定売上：{formatCurrency(item.estimatedRevenue)}</span> : null}
        </div>
        {item.topProducts.length ? (
          <div className="genreRankingCard__products" aria-label="代表作品">
            {item.topProducts.map((product) => (
              <Link href={buildFilterHref(`/work/${product.productId}`, {}, { contentType: contentTypeParam })} key={product.productId} prefetch={false} title={product.title}>
                <img src={productImage(product)} alt="" loading="lazy" />
                <span>{product.title}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <Link className="genreRankingCard__action" href={href} prefetch={false}>作品を見る</Link>
    </article>
  );
}
