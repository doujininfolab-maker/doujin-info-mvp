import Link from "next/link";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { SegmentNav } from "@/components/SegmentNav";
import { DEFAULT_SEGMENT, SITE_SEGMENTS } from "@/lib/siteSegments";
import { getNewProducts, getSaleProducts, getLatestRankingProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const segment = DEFAULT_SEGMENT;
  const filter = {
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
  };

  const [rankingProducts, newProducts, saleProducts] = await Promise.all([
    getLatestRankingProducts({ ...filter, limitCount: 8, rankingType: "daily" }),
    getNewProducts({ ...filter, limitCount: 8 }),
    getSaleProducts({ ...filter, limitCount: 8 }),
  ]);

  return (
    <div className="stack">
      <section className="hero">
        <div>
          <p className="eyebrow">Multi Platform MVP</p>
          <h1>DLsite・FANZA横展開前提の同人情報サイト</h1>
          <p>
            最初はDLsite女性向け同人で検証し、将来はFANZA動画・電子書籍・同人、DLsite男性向け・一般向けへ広げられる設計です。
          </p>
          <div className="hero__actions">
            <Link className="button" href={segment.path}>MVPを見る</Link>
            <Link className="button button--ghost" href={`${segment.path}/ranking`}>ランキング</Link>
          </div>
        </div>
        <div className="hero__panel">
          <h2>対応予定セグメント</h2>
          <ul>
            {SITE_SEGMENTS.map((item) => (
              <li key={item.key}>
                <span>{item.label}</span>
                <strong>{item.enabled ? "有効" : "予定"}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <SegmentNav segment={segment} />

      <section>
        <SectionHeader title="人気ランキング" description={segment.label} href={`${segment.path}/ranking`} />
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
