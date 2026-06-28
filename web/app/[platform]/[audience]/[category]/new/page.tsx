import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getNewProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return segment ? { title: `${segment.label} 新着` } : {};
}

export default async function NewPage({ params }: PageProps) {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getNewProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount: 50,
  });

  return (
    <div className="stack">
      <section className="pageHero">
        <p className="eyebrow">New</p>
        <h1>{segment.label} 新着</h1>
        <p>releaseDate降順で表示します。</p>
      </section>
      <SegmentNav segment={segment} />
      <ProductGrid products={products} />
    </div>
  );
}
