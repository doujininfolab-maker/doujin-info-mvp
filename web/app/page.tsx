import { HomeDashboard } from "@/components/HomeDashboard";
import { DEFAULT_SEGMENT } from "@/lib/siteSegments";
import { getLatestRankingProducts, getNewProducts, getSaleProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const segment = DEFAULT_SEGMENT;
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
