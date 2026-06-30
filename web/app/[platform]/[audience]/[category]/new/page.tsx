import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getNewProducts } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}の新着作品` : "新着作品" };
}

export default async function NewPage({ params, searchParams }: PageProps) {
  const { platform, audience, category } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const offsetCount = (pageNumber - 1) * limitCount;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getNewProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title="新着作品" description={`${segment.label}の新着`} icon="●">
          <div className="listToolbar">
            <PageSizeSelect value={limitCount} />
            <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
          </div>
        </SectionHeader>
        <ProductGrid products={products} variant="list" />
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
