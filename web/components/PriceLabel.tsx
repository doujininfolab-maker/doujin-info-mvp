import { formatPrice } from "@/lib/format";

export function PriceLabel({
  priceCurrent,
  priceOriginal,
  discountRate,
  isDiscounted,
}: {
  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  isDiscounted?: boolean;
}) {
  return (
    <div className="priceLabel">
      <span className="priceLabel__current">{formatPrice(priceCurrent)}</span>
      {isDiscounted && priceOriginal && priceOriginal > (priceCurrent ?? 0) ? (
        <span className="priceLabel__original">{formatPrice(priceOriginal)}</span>
      ) : null}
      {isDiscounted && discountRate ? <span className="discountBadge">{discountRate}% OFF</span> : null}
    </div>
  );
}
