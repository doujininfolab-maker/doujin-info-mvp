import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatDate, formatNumber, formatRating } from "@/lib/format";
import { PriceLabel } from "./PriceLabel";
import { buildFilterHref } from "@/lib/workTypes";
import { CrownIcon } from "@/components/icons/SiteIcons";

export type ProductCardVariant = "ranking" | "compact" | "sale" | "new" | "grid" | "list";

function getProductImage(product: Product): string {
  return (
    product.mainImageUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    product.images?.[0]?.thumbnailUrl ||
    "/no-image.svg"
  );
}

function getTags(product: Product, count = 2, contentTypeParam?: string): Array<{ label: string; href: string }> {
  const segmentPath = getProductSegmentPath(product);
  const source = product.genres?.length ? product.genres : product.tags ?? [];
  return source.slice(0, count).map((label, index) => {
    const rawGenreId = product.genreIds?.[index] || `dlsite:${label}`;
    return {
      label,
      href: buildFilterHref(`${segmentPath}/genre/${encodeURIComponent(rawGenreId)}`, {}, { contentType: contentTypeParam }),
    };
  });
}

function getProductSegmentPath(product: Product): string {
  return `/${product.platform}/${product.audience}/${product.category}`;
}

function getWorkTypeHref(product: Product, contentTypeParam?: string): string {
  const segmentPath = getProductSegmentPath(product);
  return buildFilterHref(`${segmentPath}/ranking`, {}, { workType: product.workType, contentType: contentTypeParam });
}

function getSellerHref(product: Product, contentTypeParam?: string): string | undefined {
  const sellerKey = product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim();
  if (!sellerKey) return undefined;
  return buildFilterHref(`${getProductSegmentPath(product)}/circle/${encodeURIComponent(sellerKey)}`, {}, { contentType: contentTypeParam });
}

function getProductHref(product: Product, contentTypeParam?: string): string {
  return buildFilterHref(`/work/${product.productId}`, {}, { contentType: contentTypeParam });
}

function getWorkTypeLabel(product: Product): string {
  return product.workTypeLabel || product.workType || product.category;
}

function formatCurrencyValue(value?: number): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "-円";
  return `${formatNumber(Math.round(value))}円`;
}

function getEstimatedRevenue(product: Product): number | undefined {
  const price = product.priceCurrent;
  const sales = product.salesCount;

  if (typeof price !== "number" || typeof sales !== "number") return undefined;
  return price * sales;
}

export function ProductCard({
  product,
  rank,
  variant = "compact",
  listRankMetric = "revenue",
  contentTypeParam,
}: {
  product: Product;
  rank?: number;
  variant?: ProductCardVariant;
  listRankMetric?: "revenue" | "sales";
  contentTypeParam?: string;
}) {
  const imageUrl = getProductImage(product);
  const isList = variant === "list";
  const tags = getTags(product, isList ? 8 : 2, contentTypeParam);
  const sellerName = product.seller?.sellerName ?? product.seller?.sellerId ?? "サークル未取得";
  const sellerHref = getSellerHref(product, contentTypeParam);
  const isSale = variant === "sale" || product.isDiscounted || Boolean(product.discountRate);
  const isNew = variant === "new";
  const isRankingList = isList && Boolean(rank);
  const estimatedRevenue = getEstimatedRevenue(product);
  const productHref = getProductHref(product, contentTypeParam);

  return (
    <article className={`productCard productCard--${variant}`}>
      <Link className="productCard__imageLink" href={productHref}>
        <img className="productCard__image" src={imageUrl} alt={product.title} loading="lazy" />
        {rank && !isList ? <span className="rankBadge">{rank <= 3 ? <CrownIcon rank={rank} /> : rank}</span> : null}
        {isNew ? <span className="cornerBadge cornerBadge--new">NEW</span> : null}
        {isSale && product.discountRate ? <span className="cornerBadge cornerBadge--sale">{product.discountRate}%<br />OFF</span> : null}
      </Link>
      <div className="productCard__body">
        {isList ? (
          <Link className="productCard__type" href={getWorkTypeHref(product, contentTypeParam)}>
            {getWorkTypeLabel(product)}
          </Link>
        ) : null}
        <Link className="productCard__title" href={productHref}>{product.title}</Link>
        <p className="productCard__seller">
          サークル：{sellerHref ? <Link href={sellerHref}>{sellerName}</Link> : sellerName}
        </p>
        <PriceLabel
          priceCurrent={product.priceCurrent}
          priceOriginal={product.priceOriginal}
          discountRate={product.discountRate}
          isDiscounted={product.isDiscounted}
          compact
        />
        <div className="productCard__meta">
          {!isRankingList ? <span>販売 {formatNumber(product.salesCount)}</span> : null}
          <span>★ {formatRating(product.rating ?? product.ratingAverage)}</span>
          {isList ? <span>発売 {formatDate(product.releaseDate)}</span> : null}
        </div>
        {tags.length ? (
          <div className="tagRow">
            {tags.map((tag) => <Link href={tag.href} key={`${tag.label}_${tag.href}`}>{tag.label}</Link>)}
          </div>
        ) : null}
      </div>
      {isRankingList ? (
        <div
          className={`listRankBadge listRankBadge--sales${listRankMetric === "sales" ? " listRankBadge--countOnly" : ""}`}
          aria-label={
            listRankMetric === "sales"
              ? `${rank}位 販売数 ${formatNumber(product.salesCount)}本`
              : `${rank}位 売上額 ${formatCurrencyValue(estimatedRevenue)} 販売数 ${formatNumber(product.salesCount)}本`
          }
        >
          <div className="listRankBadge__rank">
            <span>♛</span>
            <strong>{rank}</strong>
          </div>
          <div className="listRankBadge__metrics">
            {listRankMetric === "sales" ? (
              <strong>{formatNumber(product.salesCount)}本</strong>
            ) : (
              <>
                <strong>{formatCurrencyValue(estimatedRevenue)}</strong>
                <small>{formatNumber(product.salesCount)}本</small>
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  );
}
