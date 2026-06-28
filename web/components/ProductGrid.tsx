import type { Product } from "@/lib/types";
import { EmptyState } from "./EmptyState";
import { ProductCard } from "./ProductCard";

export function ProductGrid({ products, showRank = false }: { products: Product[]; showRank?: boolean }) {
  if (products.length === 0) {
    return <EmptyState title="商品がありません" description="Firestoreに対象セグメントの商品データを投入してください。" />;
  }

  return (
    <div className="productGrid">
      {products.map((product, index) => (
        <ProductCard key={product.productId} product={product} rank={showRank ? index + 1 : undefined} />
      ))}
    </div>
  );
}
