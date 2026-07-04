import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { ListEmptyState, ListPageInfo } from "@/components/ListPageInfo";
import { WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getProductsByGenre } from "@/lib/firebase/products";
import { getWorkTypeLabel, parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";

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
  const genreName = displayGenreName(genreId);
  const visibleRange = products.length ? `${offsetCount + 1}〜${offsetCount + products.length}件` : "0件";

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title={`${genreName} の作品`} description={`${segment.label}のジャンル別作品`} icon="♟">
          <WorkTypeTabs
            basePath={`${segment.path}/genre/${encodeURIComponent(normalizedGenreId)}`}
            currentWorkType={workType}
            currentParams={{ contentType: contentTypeParam, limit: String(limitCount), page: "1" }}
          />
        </SectionHeader>
        <ListPageInfo
          title={`「${genreName}」の売れ筋を確認できます`}
          description="このジャンルに紐づく作品を販売数の多い順に表示します。価格・評価・発売日を見ながら、ジャンル内の人気作品を比較できます。"
          items={[
            { label: "対象", value: getContentScopeLabel(contentScope) },
            { label: "作品形式", value: getWorkTypeLabel(workType) },
            { label: "並び順", value: "販売数順" },
            { label: "表示中", value: visibleRange },
          ]}
        />
        <div className="listToolbar listToolbar--below">
          <PageSizeSelect value={limitCount} />
          <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
        </div>
        {products.length ? (
          <ProductGrid products={products} variant="list" contentTypeParam={contentTypeParam} />
        ) : (
          <ListEmptyState title={`「${genreName}」の作品が見つかりませんでした。`} description="TL / BL や作品形式を変更して再度確認してください。" />
        )}
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
