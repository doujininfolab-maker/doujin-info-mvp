import Link from "next/link";
import type { GenreSummary, Product, SiteSegment } from "@/lib/types";
import { buildFilterHref } from "@/lib/workTypes";

function genreHref(segment: SiteSegment, genre: GenreSummary): string {
  const genreId = genre.genreId || `dlsite:${genre.name}`;
  if (genreId.startsWith("dlsite:")) {
    return `${segment.path}/genre/dlsite:${encodeURIComponent(genreId.replace(/^dlsite:/, ""))}`;
  }
  return `${segment.path}/genre/${encodeURIComponent(genreId)}`;
}

function productHref(product: Product, contentTypeParam?: string): string {
  return buildFilterHref(`/work/${product.productId}`, {}, { contentType: contentTypeParam });
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

export function DashboardSidebar({
  recentProducts = [],
  popularGenres = [],
  segment,
  contentTypeParam,
}: {
  recentProducts?: Product[];
  popularGenres?: GenreSummary[];
  segment: SiteSegment;
  contentTypeParam?: string;
}) {
  const recentItems = recentProducts.slice(0, 3);
  const genreItems = popularGenres.slice(0, 10);

  return (
    <aside className="dashboardSidebar" aria-label="サイドバー">
      <section className="sidebarCard">
        <h2 className="sidebarCard__title"><span>⌁</span>人気ジャンル</h2>
        {genreItems.length ? (
          <div className="trendTagGrid">
            {genreItems.map((genre, index) => (
              <Link className="trendTag" href={buildFilterHref(genreHref(segment, genre), {}, { contentType: contentTypeParam })} key={genre.genreId} title={genre.name}>
                <span className="trendTag__number">{index + 1}</span>
                <span className="trendTag__label">{genre.name}</span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="sidebarEmptyText">ジャンルデータ取得後に表示されます。</p>
        )}
        <Link className="sidebarMore" href={buildFilterHref(`${segment.path}/genre`, {}, { contentType: contentTypeParam })}>ジャンル一覧へ 〉</Link>
      </section>

      <section className="sidebarCard">
        <h2 className="sidebarCard__title"><span>☞</span>最近追加された作品</h2>
        {recentItems.length ? (
          <div className="recentList">
            {recentItems.map((item) => (
              <Link className="recentItem" href={productHref(item, contentTypeParam)} key={item.productId}>
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
        <Link className="sidebarMore" href={buildFilterHref(`${segment.path}/new`, {}, { contentType: contentTypeParam })}>もっと見る 〉</Link>
      </section>
    </aside>
  );
}
