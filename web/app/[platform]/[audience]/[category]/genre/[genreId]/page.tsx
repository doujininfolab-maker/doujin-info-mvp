import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getProductsByGenre } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string; genreId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function decodeRepeated(value: string): string {
  let current = value;

  for (let i = 0; i < 3; i++) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) return decoded;
      current = decoded;
    } catch {
      return current;
    }
  }

  return current;
}

function normalizeGenreId(rawGenreId: string, platform: string): string {
  const decoded = decodeRepeated(rawGenreId).trim();

  if (decoded.includes(":")) {
    const [provider, ...rest] = decoded.split(":");
    const genreName = rest.join(":").trim();
    return `${provider.toLowerCase()}:${genreName.toLowerCase()}`;
  }

  return `${platform.toLowerCase()}:${decoded.toLowerCase()}`;
}

function toGenreLabel(genreId: string): string {
  const decoded = decodeRepeated(genreId).trim();
  const label = decoded.includes(":") ? decoded.split(":").slice(1).join(":") : decoded;
  return label || decoded;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category, genreId } = await params;
  const segment = getSegment(platform, audience, category);
  const genreLabel = toGenreLabel(genreId);

  return { title: segment ? `${genreLabel} | ${segment.label}` : genreLabel };
}

export default async function GenrePage({ params, searchParams }: PageProps) {
  const { platform, audience, category, genreId } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const normalizedGenreId = normalizeGenreId(genreId, segment.platform);
  const genreLabel = toGenreLabel(normalizedGenreId);
  const products = await getProductsByGenre({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    genreId: normalizedGenreId,
    limitCount,
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title={`${genreLabel} の作品`} description={`${segment.label}のジャンル別作品`} icon="♟">
          <PageSizeSelect value={limitCount} />
        </SectionHeader>
        {products.length > 0 ? (
          <ProductGrid products={products} variant="list" />
        ) : (
          <p className="emptyText">このジャンルの商品はまだ取得されていません。</p>
        )}
      </section>
    </div>
  );
}
