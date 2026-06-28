import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getProductsByGenre } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string; genreId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category, genreId } = await params;
  const segment = getSegment(platform, audience, category);
  return segment ? { title: `${segment.label} ジャンル: ${decodeURIComponent(genreId)}` } : {};
}

export default async function GenrePage({ params }: PageProps) {
  const { platform, audience, category, genreId } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const decodedGenreId = decodeURIComponent(genreId);
  const products = await getProductsByGenre({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    genreId: decodedGenreId,
    limitCount: 50,
  });

  return (
    <div className="stack">
      <section className="pageHero">
        <p className="eyebrow">Genre</p>
        <h1>{segment.label} / {decodedGenreId}</h1>
        <p>genreIds array-containsで絞り込み、salesCount順で表示します。</p>
      </section>
      <SegmentNav segment={segment} />
      <ProductGrid products={products} />
    </div>
  );
}
