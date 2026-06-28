import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentNav } from "@/components/SegmentNav";
import { getSegment } from "@/lib/siteSegments";
import { getPopularProducts, getNewProducts, getSaleProducts} from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment) return {};

  return {
    title: segment.label,
    description: segment.description,
    openGraph: {
      title: segment.label,
      description: segment.description,
      type: "website",
    },
  };
}

export default async function SegmentTopPage({ params }: PageProps) {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const filter = {
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
  };

  const [rankingProducts, newProducts, saleProducts] = await Promise.all([
    getPopularProducts({ ...filter, limitCount: 12 }),
    getNewProducts({ ...filter, limitCount: 12 }),
    getSaleProducts({ ...filter, limitCount: 12 }),
  ]);

  return (
    <div className="stack">
      <section className="pageHero">
        <p className="eyebrow">{segment.platform} / {segment.audience} / {segment.category}</p>
        <h1>{segment.label}</h1>
        <p>{segment.description}</p>
      </section>

      <SegmentNav segment={segment} />

      <section>
        <SectionHeader title="人気ランキング" href={`${segment.path}/ranking`} />
        <ProductGrid products={rankingProducts} showRank />
      </section>

      <section>
        <SectionHeader title="新着" href={`${segment.path}/new`} />
        <ProductGrid products={newProducts} />
      </section>

      <section>
        <SectionHeader title="セール中" href={`${segment.path}/sale`} />
        <ProductGrid products={saleProducts} />
      </section>
    </div>
  );
}
