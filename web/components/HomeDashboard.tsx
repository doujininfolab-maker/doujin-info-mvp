import Link from "next/link";
import type { Product, SiteSegment } from "@/lib/types";
import { fillProducts } from "@/lib/mockProducts";
import { ProductGrid } from "./ProductGrid";
import { DashboardSidebar } from "./DashboardSidebar";
import { SectionHeader } from "./SectionHeader";
import { ScrollRail } from "./ScrollRail";
import { GenreIcon } from "@/components/icons/SiteIcons";

const genres = [
  { name: "ボーイズラブ", count: "62,341作品", icon: "♟", tone: "purple" as const },
  { name: "音声作品", count: "34,812作品", icon: "♫", tone: "orange" as const },
  { name: "漫画", count: "21,987作品", icon: "▤", tone: "orange" as const },
  { name: "ゲーム", count: "7,654作品", icon: "●", tone: "purple" as const },
  { name: "ノベル", count: "18,203作品", icon: "▥", tone: "purple" as const },
  { name: "シチュエーション", count: "15,459作品", icon: "♥", tone: "blue" as const },
  { name: "ASMR", count: "9,201作品", icon: "◐", tone: "pink" as const },
];

type CircleHighlight = {
  key: string;
  name: string;
  productCount: number;
  totalSales: number;
  image: string;
};

function getProductImage(product: Product): string {
  return (
    product.mainImageUrl ||
    product.images?.[0]?.thumbnailUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    "/no-image.svg"
  );
}

function buildCircleHighlights(products: Product[]): CircleHighlight[] {
  const map = new Map<string, CircleHighlight>();

  for (const product of products) {
    const name = product.seller?.sellerName?.trim() || product.seller?.sellerId?.trim();
    if (!name) continue;

    const key = product.seller?.sellerId?.trim() || name;
    const current = map.get(key);

    if (current) {
      current.productCount += 1;
      current.totalSales += product.salesCount ?? 0;
      continue;
    }

    map.set(key, {
      key,
      name,
      productCount: 1,
      totalSales: product.salesCount ?? 0,
      image: getProductImage(product),
    });
  }

  return [...map.values()]
    .sort((a, b) => b.totalSales - a.totalSales)
    .slice(0, 8);
}

const homeStats = [
  { label: "掲載作品数", value: "128,456", suffix: "作品", icon: "▣", tone: "pink" as const },
  { label: "本日の更新", value: "1,243", suffix: "作品", icon: "✦", tone: "orange" as const },
  { label: "セール件数", value: "892", suffix: "件", icon: "◆", tone: "pink" as const },
  { label: "注目ジャンル", value: "ボーイズラブ", suffix: "人気No.1", icon: "●", tone: "purple" as const, isGenre: true },
];

function HomeStatsPanel() {
  return (
    <section className="sidebarCard sideMetricsPanel" aria-label="サイト指標">
      <div className="sideStatsGrid">
        {homeStats.map((stat) => (
          <div className={`statCard statCard--side${stat.isGenre ? " statCard--genre" : ""}`} key={stat.label}>
            <span className={`iconShell iconTone--${stat.tone}`}>{stat.icon}</span>
            <span>
              <small>{stat.label}</small>
              <strong>
                {stat.value}<em>{stat.suffix}</em>
              </strong>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function RankingTabs() {
  return (
    <div className="rankingTabs rankingTabs--single" aria-label="ランキング期間">
      <span className="isActive">日間</span>
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
  const circleHighlights = buildCircleHighlights([...rankingProducts, ...newProducts, ...saleProducts]);

  return (
    <div className="dashboardPage">
      <div className="dashboardLayout">
        <div className="mainColumn">
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
                <Link className="genreCard" href={`${segment.path}/genre/dlsite:${encodeURIComponent(genre.name)}`} key={genre.name}>
                  <GenreIcon tone={genre.tone}>{genre.icon}</GenreIcon>
                  <span><strong>{genre.name}</strong><small>{genre.count}</small></span>
                </Link>
              ))}
            </ScrollRail>
          </section>

          <section className="contentSection railOnlySection">
            <SectionHeader title="注目サークル" href={`${segment.path}/circle`} icon="♕" />
            <ScrollRail ariaLabel="注目サークル一覧">
              {circleHighlights.length ? circleHighlights.map((circle) => (
                <Link className="circleCard" href={`${segment.path}/circle/${encodeURIComponent(circle.key)}`} key={circle.key}>
                  <img src={circle.image} alt="" loading="lazy" />
                  <span><strong>{circle.name}</strong><small>作品 {circle.productCount} / 販売 {circle.totalSales.toLocaleString()}</small></span>
                  <em>詳細</em>
                </Link>
              )) : (
                <div className="circleCard circleCard--empty">サークルデータ取得後に表示されます。</div>
              )}
            </ScrollRail>
          </section>
        </div>
        <div className="dashboardSideStack">
          <HomeStatsPanel />
          <DashboardSidebar recentProducts={newProducts} />
        </div>
      </div>
    </div>
  );
}
