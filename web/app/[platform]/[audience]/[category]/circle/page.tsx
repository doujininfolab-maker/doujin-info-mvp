import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListPagination } from "@/components/ListPagination";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { SectionHeader } from "@/components/SectionHeader";
import { SellerList } from "@/components/SellerCard";
import { getSellerSummaries } from "@/lib/firebase/products";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";

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
  const offsetCount = (pageNumber - 1) * limitCount;
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const sellers = await getSellerSummaries({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title="サークル一覧" description={`${segment.label}のサークル`} icon="♧">
          <div className="listToolbar">
            <PageSizeSelect value={limitCount} />
            <ListPagination page={pageNumber} limit={limitCount} hasNext={sellers.length === limitCount} />
          </div>
        </SectionHeader>
        <SellerList sellers={sellers} />
        <ListPagination page={pageNumber} limit={limitCount} hasNext={sellers.length === limitCount} />
      </section>
    </div>
  );
}
