import Link from "next/link";
import type { SellerCardItem, SellerSummary } from "@/lib/types";
import { formatDate, formatNumber } from "@/lib/format";
import { buildFilterHref } from "@/lib/workTypes";

type SellerCardDisplayItem = SellerSummary | SellerCardItem;

function getSellerImage(seller: SellerCardDisplayItem): string {
  return (
    ("cardImageUrl" in seller ? seller.cardImageUrl : undefined) ||
    ("topProduct" in seller ? seller.topProduct?.mainImageUrl : undefined) ||
    ("topProduct" in seller ? seller.topProduct?.images?.[0]?.url : undefined) ||
    ("topProduct" in seller ? seller.topProduct?.thumbnailUrl : undefined) ||
    ("latestProduct" in seller ? seller.latestProduct?.mainImageUrl : undefined) ||
    ("latestProduct" in seller ? seller.latestProduct?.thumbnailUrl : undefined) ||
    "/no-image.svg"
  );
}

function buildCircleHref(seller: SellerCardDisplayItem, contentTypeParam?: string): string {
  return buildFilterHref(`/${seller.platform}/${seller.audience}/${seller.category}/circle/${encodeURIComponent(seller.sellerKey)}`, {}, { contentType: contentTypeParam });
}

function buildGenreHref(seller: SellerCardDisplayItem, genreName: string, contentTypeParam?: string): string {
  const normalizedGenre = genreName.trim().toLowerCase();
  return buildFilterHref(`/${seller.platform}/${seller.audience}/${seller.category}/genre/dlsite:${encodeURIComponent(normalizedGenre)}`, {}, { contentType: contentTypeParam });
}

export function SellerCard({ seller, contentTypeParam }: { seller: SellerCardDisplayItem; contentTypeParam?: string }) {
  const href = buildCircleHref(seller, contentTypeParam);
  const tags = seller.tags.slice(0, 8);

  return (
    <article className="sellerCard">
      <Link className="sellerCard__imageLink" href={href} prefetch={false}>
        <img src={getSellerImage(seller)} alt="" loading="lazy" />
      </Link>

      <div className="sellerCard__body">
        <span className="sellerCard__type">サークル</span>
        <Link className="sellerCard__title" href={href} prefetch={false}>{seller.sellerName}</Link>
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
              <Link className="sellerCard__tagLink" href={buildGenreHref(seller, tag.name, contentTypeParam)} key={tag.name} prefetch={false}>
                {tag.name}<small>{tag.count}</small>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

export function SellerList({ sellers, contentTypeParam }: { sellers: SellerCardDisplayItem[]; contentTypeParam?: string }) {
  return (
    <div className="sellerList">
      {sellers.map((seller) => <SellerCard key={seller.sellerKey} seller={seller} contentTypeParam={contentTypeParam} />)}
    </div>
  );
}
