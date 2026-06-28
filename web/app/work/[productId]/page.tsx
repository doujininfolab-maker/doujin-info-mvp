import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductImageGallery } from "@/components/ProductImageGallery";
import { PriceLabel } from "@/components/PriceLabel";
import { PlatformBadge } from "@/components/PlatformBadge";
import { getProductById } from "@/lib/firebase/products";
import { formatDate, formatNumber, formatRating } from "@/lib/format";
import { getSegmentPath } from "@/lib/siteSegments";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ productId: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { productId } = await params;
  const product = await getProductById(productId);

  if (!product) {
    return { title: "商品が見つかりません" };
  }

  const description = product.description || `${product.title}の価格・ランキング・ジャンル情報を確認できます。`;
  const image = product.thumbnailUrl || product.mainImageUrl || product.images?.[0]?.url;

  return {
    title: product.title,
    description,
    openGraph: {
      title: product.title,
      description,
      type: "article",
      images: image ? [{ url: image }] : undefined,
    },
  };
}

export default async function WorkDetailPage({ params }: PageProps) {
  const { productId } = await params;
  const product = await getProductById(productId);
  if (!product) notFound();

  const officialUrl = product.affiliateUrl || product.sourceUrl;
  const segmentPath = getSegmentPath(product.platform, product.audience, product.category);

  return (
    <div className="detailPage">
      <div>
        <ProductImageGallery title={product.title} images={product.images ?? []} />
      </div>

      <article className="detailBody">
        <PlatformBadge platform={product.platform} audience={product.audience} category={product.category} />
        <h1>{product.title}</h1>
        {product.seller?.sellerName ? <p className="detailBody__seller">{product.seller.sellerName}</p> : null}

        <PriceLabel
          priceCurrent={product.priceCurrent}
          priceOriginal={product.priceOriginal}
          discountRate={product.discountRate}
          isDiscounted={product.isDiscounted}
        />

        <div className="detailStats">
          <div><span>販売数</span><strong>{formatNumber(product.salesCount)}</strong></div>
          <div><span>評価</span><strong>{formatRating(product.rating ?? product.ratingAverage)}</strong></div>
          <div><span>レビュー</span><strong>{formatNumber(product.reviewCount)}</strong></div>
          <div><span>発売日</span><strong>{formatDate(product.releaseDate)}</strong></div>
        </div>

        <div className="buttonRow">
          <a className="button" href={officialUrl} target="_blank" rel="sponsored noreferrer">
            公式サイトで見る
          </a>
          <Link className="button button--ghost" href={segmentPath}>
            一覧へ戻る
          </Link>
        </div>

        {product.description ? (
          <section className="detailSection">
            <h2>作品説明</h2>
            <p>{product.description}</p>
          </section>
        ) : null}

        <section className="detailSection">
          <h2>ジャンル</h2>
          <div className="tagList">
            {product.genres.map((genre, index) => (
              <span key={`${genre}_${index}`}>{genre}</span>
            ))}
          </div>
        </section>

        <section className="detailSection">
          <h2>タグ</h2>
          <div className="tagList">
            {product.tags.map((tag, index) => (
              <span key={`${tag}_${index}`}>{tag}</span>
            ))}
          </div>
        </section>

        <section className="detailSection detailSection--muted">
          <h2>管理情報</h2>
          <dl className="definitionList">
            <div><dt>productId</dt><dd>{product.productId}</dd></div>
            <div><dt>sourceProductId</dt><dd>{product.sourceProductId}</dd></div>
            <div><dt>affiliateProvider</dt><dd>{product.affiliateProvider}</dd></div>
            <div><dt>fetchStatus</dt><dd>{product.fetchStatus}</dd></div>
          </dl>
        </section>
      </article>
    </div>
  );
}
