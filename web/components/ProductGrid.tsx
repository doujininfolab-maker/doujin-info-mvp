import type { Product } from "@/lib/types";
import { ProductCard, type ProductCardVariant } from "./ProductCard";
import { ScrollRail } from "./ScrollRail";

export function ProductGrid({
  products,
  showRank = false,
  rankOffset = 0,
  variant = "grid",
  rail = false,
  ariaLabel = "商品リスト",
  listRankMetric = "revenue",
  contentTypeParam,
}: {
  products: Product[];
  showRank?: boolean;
  rankOffset?: number;
  variant?: ProductCardVariant;
  rail?: boolean;
  ariaLabel?: string;
  listRankMetric?: "revenue" | "sales";
  contentTypeParam?: string;
}) {
  const content = products.map((product, index) => (
    <ProductCard
      key={product.productId}
      product={product}
      rank={showRank ? rankOffset + index + 1 : undefined}
      variant={variant}
      listRankMetric={listRankMetric}
      contentTypeParam={contentTypeParam}
    />
  ));

  if (rail) {
    const resetKey = products.map((product) => product.productId).join("|");
    return <ScrollRail ariaLabel={ariaLabel} resetKey={resetKey}>{content}</ScrollRail>;
  }

  return <div className={`productGrid productGrid--${variant}`}>{content}</div>;
}
