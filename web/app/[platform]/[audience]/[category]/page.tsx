import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HomeDashboard } from "@/components/HomeDashboard";
import { getSegment } from "@/lib/siteSegments";
import { getLatestRankingProducts, getNewProducts, getSaleProducts } from "@/lib/firebase/products";

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
    getLatestRankingProducts({ ...filter, limitCount: 10, rankingType: "daily" }),
    getNewProducts({ ...filter, limitCount: 10 }),
    getSaleProducts({ ...filter, limitCount: 10 }),
  ]);

  return <HomeDashboard segment={segment} rankingProducts={rankingProducts} newProducts={newProducts} saleProducts={saleProducts} />;
}
