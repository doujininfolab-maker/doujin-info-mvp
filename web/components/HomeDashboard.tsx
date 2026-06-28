import Link from "next/link";
import type { Product, SiteSegment } from "@/lib/types";
import { fillProducts } from "@/lib/mockProducts";
import { ProductGrid } from "./ProductGrid";
import { DashboardSidebar } from "./DashboardSidebar";
import { SectionHeader } from "./SectionHeader";
import { SegmentNav } from "./SegmentNav";
import { ScrollRail } from "./ScrollRail";
import { GenreIcon, StatIcon } from "@/components/icons/SiteIcons";

const stats = [
  { label: "掲載作品数", value: "128,456", suffix: "作品", icon: "▣", tone: "pink" as const },
  { label: "本日の更新", value: "1,243", suffix: "作品", icon: "✦", tone: "orange" as const },
  { label: "セール件数", value: "892", suffix: "件", icon: "◆", tone: "pink" as const },
  { label: "注目ジャンル", value: "ボーイズラブ", suffix: "人気No.1", icon: "●", tone: "purple" as const },
];

const genres = [
  { name: "ボーイズラブ", count: "62,341作品", icon: "♟", tone: "purple" as const },
  { name: "音声作品", count: "34,812作品", icon: "♫", tone: "orange" as const },
  { name: "漫画", count: "21,987作品", icon: "▤", tone: "orange" as const },
  { name: "ゲーム", count: "7,654作品", icon: "●", tone: "purple" as const },
  { name: "ノベル", count: "18,203作品", icon: "▥", tone: "purple" as const },
  { name: "シチュエーション", count: "15,459作品", icon: "♥", tone: "blue" as const },
  { name: "ASMR", count: "9,201作品", icon: "◐", tone: "pink" as const },
];

const circles = [
  { name: "Luna Note", followers: "12,345", image: "/ui/avatar-01.svg" },
  { name: "TearDrop", followers: "9,876", image: "/ui/avatar-02.svg" },
  { name: "petit étoile", followers: "8,765", image: "/ui/avatar-03.svg" },
  { name: "Scent Note", followers: "7,654", image: "/ui/avatar-04.svg" },
  { name: "melty.", followers: "6,543", image: "/ui/avatar-05.svg" },
  { name: "moonlit", followers: "5,432", image: "/ui/avatar-06.svg" },
];

function RankingTabs() {
  return (
    <div className="rankingTabs" aria-label="ランキング期間">
      <button type="button" className="isActive">日間</button>
      <button type="button">週間</button>
      <button type="button">月間</button>
    </div>
  );
}

export function HomeDashboard({
  segment,
  rankingProducts,
  newProducts,
  saleProducts,
}: {
  segment: SiteSegment;
  rankingProducts: Product[];
  newProducts: Product[];
  saleProducts: Product[];
}) {
  const ranking = fillProducts(rankingProducts, 6);
  const newest = fillProducts(newProducts, 8);
  const sales = fillProducts(saleProducts, 8).map((product, index) => ({
    ...product,
    isDiscounted: product.isDiscounted ?? true,
    discountRate: product.discountRate ?? (index % 3 === 0 ? 30 : 20),
  }));

  return (
    <div className="dashboardPage">
      <div className="dashboardLayout">
        <div className="mainColumn">
          <section className="heroSection">
            <div className="heroSection__main">
              <div className="heroCopy">
                <p className="eyebrow">DLSITE / FEMALE / DOUJIN</p>
                <h1>女性向け同人が、<br /><span>すぐ見つかる。</span></h1>
                <p className="heroLead">ランキング・新着・セール情報をまとめてチェック。ジャンルやサークルから、あなたの“好き”をもっと深掘り。</p>
                <div className="heroActions">
                  <Link className="button button--primary" href={`${segment.path}/ranking`}>♕ ランキングを見る</Link>
                  <Link className="button button--secondary" href={`${segment.path}/new`}>✦ 新着を見る</Link>
                </div>
              </div>
              <div className="heroVisual" aria-hidden="true">
                <img src="/ui/hero-visual.svg" alt="" />
              </div>
            </div>
            <div className="statsGrid">
              {stats.map((stat) => (
                <div className={`statCard ${stat.label === "注目ジャンル" ? "statCard--genre" : ""}`} key={stat.label}>
                  <StatIcon tone={stat.tone}>{stat.icon}</StatIcon>
                  <span><small>{stat.label}</small><strong>{stat.value}<em>{stat.suffix}</em></strong></span>
                </div>
              ))}
            </div>
          </section>

          <SegmentNav segment={segment} />

          <section className="contentSection rankingSection">
            <SectionHeader title="人気ランキング" description="販売数・人気度の高い作品" href={`${segment.path}/ranking`} icon="♕">
              <RankingTabs />
            </SectionHeader>
            <ProductGrid products={ranking} showRank variant="ranking" rail ariaLabel="人気ランキングの商品リスト" />
          </section>

          <section className="contentSection">
            <SectionHeader title="新着作品" href={`${segment.path}/new`} icon="NEW" />
            <ProductGrid products={newest} variant="new" rail ariaLabel="新着作品の商品リスト" />
          </section>

          <section className="contentSection">
            <SectionHeader title="セール・値引き中" href={`${segment.path}/sale`} icon="◆" />
            <ProductGrid products={sales} variant="sale" rail ariaLabel="セール作品の商品リスト" />
          </section>

          <section className="contentSection railOnlySection">
            <SectionHeader title="ジャンルから探す" icon="♟" />
            <ScrollRail ariaLabel="ジャンル一覧">
              {genres.map((genre) => (
                <a className="genreCard" href={`${segment.path}/genre/dlsite:${genre.name}`} key={genre.name}>
                  <GenreIcon tone={genre.tone}>{genre.icon}</GenreIcon>
                  <span><strong>{genre.name}</strong><small>{genre.count}</small></span>
                </a>
              ))}
            </ScrollRail>
          </section>

          <section className="contentSection railOnlySection">
            <SectionHeader title="注目サークル" href={segment.path} icon="♕" />
            <ScrollRail ariaLabel="注目サークル一覧">
              {circles.map((circle) => (
                <a className="circleCard" href="#" key={circle.name}>
                  <img src={circle.image} alt="" loading="lazy" />
                  <span><strong>{circle.name}</strong><small>フォロワー {circle.followers}</small></span>
                  <em>フォロー</em>
                </a>
              ))}
            </ScrollRail>
          </section>
        </div>
        <DashboardSidebar />
      </div>
    </div>
  );
}
