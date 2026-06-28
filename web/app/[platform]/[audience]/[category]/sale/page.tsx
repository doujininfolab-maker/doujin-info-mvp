import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getSaleProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return segment ? { title: `${segment.label} セール` } : {};
}

export default async function SalePage({ params }: PageProps) {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getSaleProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount: 50,
  });

  return (
    <div className="stack">
      <section className="pageHero">
        <p className="eyebrow">Sale</p>
        <h1>{segment.label} セール</h1>
        <p>isDiscounted=trueの商品をdiscountRate降順で表示します。</p>
      </section>
      <SegmentNav segment={segment} />
      <ProductGrid products={products} />
    </div>
  );
}
