import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getLatestRankingProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return segment ? { title: `${segment.label} ランキング` } : {};
}

export default async function RankingPage({ params }: PageProps) {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getLatestRankingProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    rankingType: "daily",
    limitCount: 50,
  });

  return (
    <div className="stack">
      <section className="pageHero">
        <p className="eyebrow">Ranking</p>
        <h1>{segment.label} ランキング</h1>
        <p>rankingSnapshotsの最新データを優先し、なければsalesCount順で表示します。</p>
      </section>
      <SegmentNav segment={segment} />
      <ProductGrid products={products} showRank />
    </div>
  );
}
