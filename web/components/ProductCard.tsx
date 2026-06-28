import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatNumber, formatRating } from "@/lib/format";
import { PriceLabel } from "./PriceLabel";
import { CrownIcon } from "@/components/icons/SiteIcons";

export type ProductCardVariant = "ranking" | "compact" | "sale" | "new" | "grid";

function getProductImage(product: Product): string {
  return (
    product.thumbnailUrl ||
    product.mainImageUrl ||
    product.images?.[0]?.thumbnailUrl ||
    product.images?.[0]?.url ||
    "/no-image.svg"
  );
}

function getTags(product: Product): string[] {
  const source = product.genres?.length ? product.genres : product.tags ?? [];
  return source.slice(0, 2);
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
  const tags = getTags(product);
  const sellerName = product.seller?.sellerName ?? product.seller?.sellerId ?? "サークル未取得";
  const isSale = variant === "sale" || product.isDiscounted || Boolean(product.discountRate);
  const isNew = variant === "new";

  return (
    <article className={`productCard productCard--${variant}`}>
      <Link className="productCard__imageLink" href={`/work/${product.productId}`}>
        <img className="productCard__image" src={imageUrl} alt={product.title} loading="lazy" />
        {rank ? <span className="rankBadge"><CrownIcon rank={rank} />{rank <= 3 ? "" : rank}</span> : null}
        {isNew ? <span className="cornerBadge cornerBadge--new">NEW</span> : null}
        {isSale && product.discountRate ? <span className="cornerBadge cornerBadge--sale">{product.discountRate}%<br />OFF</span> : null}
      </Link>
      <div className="productCard__body">
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
        </div>
        {tags.length ? (
          <div className="tagRow">
            {tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
      </div>
    </article>
  );
}
