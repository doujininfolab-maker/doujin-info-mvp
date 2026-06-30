import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatDate, formatNumber, formatRating } from "@/lib/format";
import { PriceLabel } from "./PriceLabel";
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

function getTags(product: Product, count = 2): string[] {
  const source = product.genres?.length ? product.genres : product.tags ?? [];
  return source.slice(0, count);
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

function getSellerHref(product: Product): string | undefined {
  const sellerKey = product.seller?.sellerId?.trim() || product.seller?.sellerName?.trim();
  if (!sellerKey) return undefined;
  return `/${product.platform}/${product.audience}/${product.category}/circle/${encodeURIComponent(sellerKey)}`;
}

export function ProductCard({
  product,
  rank,
  variant = "compact",
}: {
  product: Product;
  rank?: number;
  variant?: ProductCardVariant;
}) {
  const imageUrl = getProductImage(product);
  const tags = getTags(product, variant === "list" ? 8 : 2);
  const sellerName = product.seller?.sellerName ?? product.seller?.sellerId ?? "サークル未取得";
  const sellerHref = getSellerHref(product);
  const isSale = variant === "sale" || product.isDiscounted || Boolean(product.discountRate);
  const isNew = variant === "new";
  const isList = variant === "list";
  const isRankingList = isList && Boolean(rank);
  const estimatedRevenue = getEstimatedRevenue(product);

  return (
    <article className={`productCard productCard--${variant}`}>
      <Link className="productCard__imageLink" href={`/work/${product.productId}`}>
        <img className="productCard__image" src={imageUrl} alt={product.title} loading="lazy" />
        {rank && !isList ? <span className="rankBadge"><CrownIcon rank={rank} />{rank <= 3 ? "" : rank}</span> : null}
        {isNew ? <span className="cornerBadge cornerBadge--new">NEW</span> : null}
        {isSale && product.discountRate ? <span className="cornerBadge cornerBadge--sale">{product.discountRate}%<br />OFF</span> : null}
      </Link>
      <div className="productCard__body">
        {isList ? <span className="productCard__type">{product.workType || product.category}</span> : null}
        <Link className="productCard__title" href={`/work/${product.productId}`}>{product.title}</Link>
        <p className="productCard__seller">サークル：{sellerHref ? <Link href={sellerHref}>{sellerName}</Link> : sellerName}</p>
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
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
      </div>
      {isRankingList ? (
        <div className="listRankBadge listRankBadge--sales" aria-label={`${rank}位 売上額 ${formatCurrencyValue(estimatedRevenue)} 販売数 ${formatNumber(product.salesCount)}本`}>
          <div className="listRankBadge__rank">
            <span>♛</span>
            <strong>{rank}</strong>
          </div>
          <div className="listRankBadge__metrics">
            <strong>{formatCurrencyValue(estimatedRevenue)}</strong>
            <small>{formatNumber(product.salesCount)}本</small>
          </div>
        </div>
      ) : null}
    </article>
  );
}
