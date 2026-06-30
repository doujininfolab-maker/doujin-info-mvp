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
  const isSale = variant === "sale" || product.isDiscounted || Boolean(product.discountRate);
  const isNew = variant === "new";
  const isList = variant === "list";

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
        <p className="productCard__seller">サークル：{sellerName}</p>
        <PriceLabel
          priceCurrent={product.priceCurrent}
          priceOriginal={product.priceOriginal}
          discountRate={product.discountRate}
          isDiscounted={product.isDiscounted}
          compact
        />
        <div className="productCard__meta">
          <span>販売 {formatNumber(product.salesCount)}</span>
          <span>★ {formatRating(product.rating ?? product.ratingAverage)}</span>
          {isList ? <span>発売 {formatDate(product.releaseDate)}</span> : null}
        </div>
        {tags.length ? (
          <div className="tagRow">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
      </div>
      {isList && rank ? (
        <div className="listRankBadge" aria-label={`${rank}位`}>
          <span>♛</span>
          <strong>{rank}</strong>
          <small>ランキング</small>
        </div>
      ) : null}
    </article>
  );
}
