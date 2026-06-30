import Link from "next/link";
import type { Product } from "@/lib/types";

const popularGenres = [
  "監禁・束縛",
  "年の差",
  "執着",
  "幼なじみ",
  "同棲",
  "シチュエーションCD",
  "オメガバース",
  "片想い",
  "先輩×後輩",
  "癒やし",
];

function genreHref(tag: string): string {
  return `/dlsite/female/doujin/genre/dlsite:${encodeURIComponent(tag)}`;
}

function productHref(product: Product): string {
  return `/work/${product.productId}`;
}

function getProductImage(product: Product): string {
  return (
    product.mainImageUrl ||
    product.images?.[0]?.thumbnailUrl ||
    product.images?.[0]?.url ||
    product.thumbnailUrl ||
    "/no-image.svg"
  );
}

export function DashboardSidebar({ recentProducts = [] }: { recentProducts?: Product[] }) {
  const recentItems = recentProducts.slice(0, 3);

  return (
    <aside className="dashboardSidebar" aria-label="サイドバー">
      <section className="sidebarCard">
        <h2 className="sidebarCard__title"><span>⌁</span>人気ジャンル</h2>
        <div className="trendTagGrid">
          {popularGenres.map((tag, index) => (
            <Link className="trendTag" href={genreHref(tag)} key={tag} title={tag}>
              <span className="trendTag__number">{index + 1}</span>
              <span className="trendTag__label">{tag}</span>
            </Link>
          ))}
        </div>
        <Link className="sidebarMore" href="/dlsite/female/doujin">ジャンル一覧へ 〉</Link>
      </section>

      <section className="sidebarCard">
        <h2 className="sidebarCard__title"><span>☞</span>最近追加された作品</h2>
        {recentItems.length ? (
          <div className="recentList">
            {recentItems.map((item) => (
              <Link className="recentItem" href={productHref(item)} key={item.productId}>
                <img src={getProductImage(item)} alt="" loading="lazy" />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.seller?.sellerName ?? "サークル未取得"}</small>
                  <em>新着</em>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="sidebarEmptyText">作品データ取得後に表示されます。</p>
        )}
        <Link className="sidebarMore" href="/dlsite/female/doujin/new">もっと見る 〉</Link>
      </section>
    </aside>
  );
}
