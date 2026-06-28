import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getNewProducts } from "@/lib/firebase/products";
import { fillProducts } from "@/lib/mockProducts";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ platform: string; audience: string; category: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}の新着作品` : "新着作品" };
}

export default async function NewPage({ params }: PageProps) {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();
  const products = await getNewProducts({ platform: segment.platform, audience: segment.audience, category: segment.category, limitCount: 30 });
  return (
    <div className="listPage">
      <SegmentNav segment={segment} />
      <section className="contentSection">
        <SectionHeader title="新着作品" description={`${segment.label}の新着`} icon="NEW" />
        <ProductGrid products={fillProducts(products, 12)} variant="grid" />
      </section>
    </div>
  );
}
