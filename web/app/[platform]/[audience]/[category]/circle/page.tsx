import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionHeader } from "@/components/SectionHeader";
import { SellerList } from "@/components/SellerCard";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { CircleSearchBox } from "@/components/CircleSearchBox";
import { ListPagination } from "@/components/ListPagination";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getSellerSummaries } from "@/lib/firebase/products";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}のサークル一覧` : "サークル一覧" };
}

export default async function CircleListPage({ params, searchParams }: PageProps) {
  const { platform, audience, category } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const sellerQuery = Array.isArray(query.q) ? query.q[0] ?? "" : query.q ?? "";
  const offsetCount = (pageNumber - 1) * limitCount;
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const sellers = await getSellerSummaries({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
    contentType,
    sellerQuery,
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection sellerListSection">
        <SectionHeader title="サークル一覧" description={`${segment.label}のサークル`} icon="♧">
          <CircleSearchBox value={sellerQuery} />
        </SectionHeader>
        <div className="listToolbar listToolbar--below sellerListToolbar">
          <PageSizeSelect value={limitCount} />
          <ListPagination page={pageNumber} limit={limitCount} hasNext={sellers.length === limitCount} />
        </div>
        <SellerList sellers={sellers} contentTypeParam={contentTypeParam} />
        <ListPagination page={pageNumber} limit={limitCount} hasNext={sellers.length === limitCount} />
      </section>
    </div>
  );
}
