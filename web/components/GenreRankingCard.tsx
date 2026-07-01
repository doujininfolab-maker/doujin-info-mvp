import Link from "next/link";
import type { GenreRankingItem, SiteSegment } from "@/lib/types";
import { formatNumber } from "@/lib/format";
import { buildFilterHref } from "@/lib/workTypes";

function genreHref(segment: SiteSegment, genreId: string): string {
  if (genreId.startsWith("dlsite:")) {
    return `${segment.path}/genre/dlsite:${encodeURIComponent(genreId.replace(/^dlsite:/, ""))}`;
  }
  return `${segment.path}/genre/${encodeURIComponent(genreId)}`;
}

function productImage(product: GenreRankingItem["topProducts"][number]): string {
  return (
    product.mainImageUrl ||
    product.images?.[0]?.url ||
    product.images?.[0]?.thumbnailUrl ||
    product.thumbnailUrl ||
    "/no-image.svg"
  );
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-円";
  return `${formatNumber(Math.round(value))}円`;
}

export function GenreRankingCard({
  item,
  segment,
  showRevenue = false,
  contentTypeParam,
}: {
  item: GenreRankingItem;
  segment: SiteSegment;
  showRevenue?: boolean;
  contentTypeParam?: string;
}) {
  const href = buildFilterHref(genreHref(segment, item.genreId), {}, { contentType: contentTypeParam });

  return (
    <article className="genreRankingCard">
      <div className="genreRankingCard__rank" aria-label={`${item.rank}位`}>
        <span>♛</span>
        <strong>{item.rank}</strong>
      </div>
      <div className="genreRankingCard__body">
        <Link className="genreRankingCard__title" href={href}>{item.name}</Link>
        <div className="genreRankingCard__meta">
          <span>作品数：{formatNumber(item.productCount)}</span>
          <span>累計販売数：{formatNumber(item.totalSalesCount)}本</span>
          {showRevenue ? <span>推定売上額：{formatCurrency(item.estimatedRevenue)}</span> : null}
        </div>
        {item.topProducts.length ? (
          <div className="genreRankingCard__products" aria-label="代表作品">
            {item.topProducts.map((product) => (
              <Link href={buildFilterHref(`/work/${product.productId}`, {}, { contentType: contentTypeParam })} key={product.productId} title={product.title}>
                <img src={productImage(product)} alt="" loading="lazy" />
                <span>{product.title}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
      <Link className="genreRankingCard__action" href={href}>作品を見る</Link>
    </article>
  );
}
