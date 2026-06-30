import Link from "next/link";
import type { SellerSummary } from "@/lib/types";
import { formatDate, formatNumber } from "@/lib/format";

function getSellerImage(seller: SellerSummary): string {
  return (
    seller.topProduct?.mainImageUrl ||
    seller.topProduct?.images?.[0]?.url ||
    seller.topProduct?.thumbnailUrl ||
    seller.latestProduct?.mainImageUrl ||
    seller.latestProduct?.thumbnailUrl ||
    "/no-image.svg"
  );
}

function buildCircleHref(seller: SellerSummary): string {
  return `/${seller.platform}/${seller.audience}/${seller.category}/circle/${encodeURIComponent(seller.sellerKey)}`;
}

function buildGenreHref(seller: SellerSummary, genreName: string): string {
  const normalizedGenre = genreName.trim().toLowerCase();
  return `/${seller.platform}/${seller.audience}/${seller.category}/genre/dlsite:${encodeURIComponent(normalizedGenre)}`;
}

export function SellerCard({ seller }: { seller: SellerSummary }) {
  const href = buildCircleHref(seller);
  const tags = seller.tags.slice(0, 8);

  return (
    <article className="sellerCard">
      <Link className="sellerCard__imageLink" href={href}>
        <img src={getSellerImage(seller)} alt="" loading="lazy" />
      </Link>

      <div className="sellerCard__body">
        <span className="sellerCard__type">サークル</span>
        <Link className="sellerCard__title" href={href}>{seller.sellerName}</Link>
        {seller.newestProductTitle ? <p className="sellerCard__latest">最新作：{seller.newestProductTitle}</p> : null}
        <div className="sellerCard__meta">
          <span>作品数 {formatNumber(seller.productCount)}</span>
          <span>合計販売 {formatNumber(seller.totalSalesCount)}</span>
          <span>平均販売 {formatNumber(seller.averageSalesCount)}</span>
          <span>最新 {formatDate(seller.latestReleaseDate)}</span>
        </div>
        {tags.length ? (
          <div className="sellerCard__tags">
            {tags.map((tag) => (
              <Link className="sellerCard__tagLink" href={buildGenreHref(seller, tag.name)} key={tag.name}>
                {tag.name}<small>{tag.count}</small>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function SellerList({ sellers }: { sellers: SellerSummary[] }) {
  return (
    <div className="sellerList">
      {sellers.map((seller) => <SellerCard key={seller.sellerKey} seller={seller} />)}
    </div>
  );
}
