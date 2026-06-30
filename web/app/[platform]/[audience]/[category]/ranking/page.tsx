import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getLatestRankingProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}ランキング` : "ランキング" };
}

export default async function RankingPage({ params, searchParams }: PageProps) {
  const { platform, audience, category } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getLatestRankingProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    rankingType: "daily",
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title="人気ランキング" description={`${segment.label}の人気作品`} icon="♕">
          <PageSizeSelect value={limitCount} />
        </SectionHeader>
        <ProductGrid products={products} showRank variant="list" />
      </section>
    </div>
  );
}
