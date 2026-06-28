import Link from "next/link";
import type { Product } from "@/lib/types";
import { formatNumber, formatRating } from "@/lib/format";
import { PriceLabel } from "./PriceLabel";
import { PlatformBadge } from "./PlatformBadge";
import { RankingBadge } from "./RankingBadge";

export function ProductCard({ product, rank }: { product: Product; rank?: number }) {
  const imageUrl = product.thumbnailUrl || product.mainImageUrl || product.images?.[0]?.thumbnailUrl || product.images?.[0]?.url || "/no-image.svg";

  return (
    <article className="productCard">
      <Link className="productCard__imageLink" href={`/work/${product.productId}`}>
        <img className="productCard__image" src={imageUrl} alt={product.title} loading="lazy" />
        <RankingBadge rank={rank} />
      </Link>
      <div className="productCard__body">
        <PlatformBadge platform={product.platform} audience={product.audience} category={product.category} />
        <Link className="productCard__title" href={`/work/${product.productId}`}>
          {product.title}
        </Link>
        {product.seller?.sellerName ? <p className="productCard__seller">{product.seller.sellerName}</p> : null}
        <PriceLabel
          priceCurrent={product.priceCurrent}
          priceOriginal={product.priceOriginal}
          discountRate={product.discountRate}
          isDiscounted={product.isDiscounted}
        />
        <div className="productCard__meta">
          <span>販売 {formatNumber(product.salesCount)}</span>
          <span>★ {formatRating(product.rating ?? product.ratingAverage)}</span>
          <span>レビュー {formatNumber(product.reviewCount)}</span>
        </div>
      </div>
    </article>
  );
}
