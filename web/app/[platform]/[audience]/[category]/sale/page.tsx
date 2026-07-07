import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { ListEmptyState, ListPageInfo } from "@/components/ListPageInfo";
import { DiscountTabs, WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getSaleProducts } from "@/lib/firebase/products";
import { getWorkTypeLabel, parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";

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

function getDiscountLabel(value: number | undefined): string {
  return value === undefined ? "全て" : `${value}%OFF以上`;
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
  const visibleRange = products.length ? `${offsetCount + 1}〜${offsetCount + products.length}件` : "0件";

  return (
    <div className="listPage listPage--wide listPage--mobileProductList">
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
        <ListPageInfo
          title="値引き中の作品を割引率から探せます"
          description="割引率が高い作品を優先して表示します。現在価格・元価格・販売数・評価を並べて、買い時の作品を比較できます。"
          items={[
            { label: "対象", value: getContentScopeLabel(contentScope) },
            { label: "作品形式", value: getWorkTypeLabel(workType) },
            { label: "割引条件", value: getDiscountLabel(discountRateMin) },
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
          <ListEmptyState title="条件に合うセール作品が見つかりませんでした。" description="割引率の条件を下げるか、TL / BL や作品形式を変更してください。" />
        )}
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
