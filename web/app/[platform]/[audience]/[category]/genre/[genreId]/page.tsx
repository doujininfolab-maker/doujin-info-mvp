import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getProductsByGenre } from "@/lib/firebase/products";
import { fillProducts } from "@/lib/mockProducts";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ platform: string; audience: string; category: string; genreId: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category, genreId } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${genreId} | ${segment.label}` : genreId };
}

export default async function GenrePage({ params }: PageProps) {
  const { platform, audience, category, genreId } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();
  const products = await getProductsByGenre({ platform: segment.platform, audience: segment.audience, category: segment.category, genreId, limitCount: 30 });
  return (
    <div className="listPage">
      <SegmentNav segment={segment} />
      <section className="contentSection">
        <SectionHeader title={`${genreId} の作品`} description={`${segment.label}のジャンル別作品`} icon="♟" />
        <ProductGrid products={fillProducts(products, 12)} variant="grid" />
      </section>
    </div>
  );
}
