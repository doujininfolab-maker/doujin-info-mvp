import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getProductsByGenre } from "@/lib/firebase/products";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string; genreId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function decodeGenreId(genreId: string): string {
  try {
    return decodeURIComponent(genreId);
  } catch {
    return genreId;
  }
}

function displayGenreName(genreId: string): string {
  return decodeGenreId(genreId).replace(/^dlsite:/, "");
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category, genreId } = await params;
  const segment = getSegment(platform, audience, category);
  const genreName = displayGenreName(genreId);
  return { title: segment ? `${genreName} | ${segment.label}` : genreName };
}

export default async function GenrePage({ params, searchParams }: PageProps) {
  const { platform, audience, category, genreId } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const offsetCount = (pageNumber - 1) * limitCount;
  const workType = parseWorkType(query.workType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const normalizedGenreId = decodeGenreId(genreId);
  const products = await getProductsByGenre({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    genreId: normalizedGenreId,
    limitCount,
    offsetCount,
    workType,
    contentType,
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title={`${displayGenreName(genreId)} の作品`} description={`${segment.label}のジャンル別作品`} icon="♟">
          <WorkTypeTabs
            basePath={`${segment.path}/genre/${encodeURIComponent(normalizedGenreId)}`}
            currentWorkType={workType}
            currentParams={{ contentType: contentTypeParam, limit: String(limitCount), page: "1" }}
          />
        </SectionHeader>
        <div className="listToolbar listToolbar--below">
          <PageSizeSelect value={limitCount} />
          <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
        </div>
        <ProductGrid products={products} variant="list" contentTypeParam={contentTypeParam} />
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
