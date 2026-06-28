import { formatPrice } from "@/lib/format";

export function PriceLabel({
  priceCurrent,
  priceOriginal,
  discountRate,
  isDiscounted,
  compact = false,
}: {
  priceCurrent?: number;
  priceOriginal?: number;
  discountRate?: number;
  isDiscounted?: boolean;
  compact?: boolean;
}) {
  const showOriginal = Boolean(isDiscounted && priceOriginal && priceCurrent && priceOriginal > priceCurrent);
  return (
    <div className={compact ? "priceLine priceLine--compact" : "priceLine"}>
      <strong>{formatPrice(priceCurrent)}</strong>
      {showOriginal ? <del>{formatPrice(priceOriginal)}</del> : null}
      {isDiscounted && discountRate ? <span>{discountRate}% OFF</span> : null}
    </div>
  );
}
