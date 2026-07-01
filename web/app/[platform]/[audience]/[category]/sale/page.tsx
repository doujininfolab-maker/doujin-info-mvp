import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { DiscountTabs, WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getSaleProducts } from "@/lib/firebase/products";
import { parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ platform: string; audience: string; category: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function parseDiscount(value: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const num = Number(raw);
  return num === 30 || num === 50 || num === 70 || num === 90 ? num : undefined;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { platform, audience, category } = await params;
  const segment = getSegment(platform, audience, category);
  return { title: segment ? `${segment.label}のセール作品` : "セール作品" };
}

export default async function SalePage({ params, searchParams }: PageProps) {
  const { platform, audience, category } = await params;
  const query = searchParams ? await searchParams : {};
  const limitCount = parsePageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const offsetCount = (pageNumber - 1) * limitCount;
  const workType = parseWorkType(query.workType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const discountRateMin = parseDiscount(query.discount);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getSaleProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
    workType,
    contentType,
    discountRateMin,
  });

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title="セール・値引き中" description="割引中の作品" icon="◆">
          <WorkTypeTabs
            basePath={`${segment.path}/sale`}
            currentWorkType={workType}
            currentParams={{
              discount: discountRateMin === undefined ? undefined : String(discountRateMin),
              contentType: contentTypeParam,
              limit: String(limitCount),
              page: "1",
            }}
          />
        </SectionHeader>
        <div className="listFilterRow">
          <DiscountTabs
            basePath={`${segment.path}/sale`}
            currentDiscountRateMin={discountRateMin}
            currentParams={{ workType, contentType: contentTypeParam, limit: String(limitCount), page: "1" }}
          />
        </div>
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
