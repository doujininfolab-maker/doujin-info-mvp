import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { NewSectionIcon } from "@/components/icons/SiteIcons";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { ListEmptyState, ListPageInfo } from "@/components/ListPageInfo";
import { WorkTypeTabs } from "@/components/WorkTypeTabs";
import { parsePageNumber, parsePageSize } from "@/lib/pageSize";
import { getSegment } from "@/lib/siteSegments";
import { getNewProducts } from "@/lib/firebase/products";
import { getWorkTypeLabel, parseWorkType } from "@/lib/workTypes";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";

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
  const workType = parseWorkType(query.workType);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = getSegment(platform, audience, category);
  if (!segment || !segment.enabled) notFound();

  const products = await getNewProducts({
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    limitCount,
    offsetCount,
    workType,
    contentType,
  });
  const visibleRange = products.length ? `${offsetCount + 1}〜${offsetCount + products.length}件` : "0件";

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection">
        <SectionHeader title="新着作品" description={`${segment.label}の新着`} icon={<NewSectionIcon />}>
          <WorkTypeTabs
            basePath={`${segment.path}/new`}
            currentWorkType={workType}
            currentParams={{ contentType: contentTypeParam, limit: String(limitCount), page: "1" }}
          />
        </SectionHeader>
        <ListPageInfo
          title="発売日が新しい作品を確認できます"
          description="新しく追加された作品を発売日順で表示します。新作の販売数・評価・価格を見ながら、伸び始めた作品を探せます。"
          items={[
            { label: "対象", value: getContentScopeLabel(contentScope) },
            { label: "作品形式", value: getWorkTypeLabel(workType) },
            { label: "並び順", value: "発売日順" },
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
          <ListEmptyState title="新着作品が見つかりませんでした。" />
        )}
        <ListPagination page={pageNumber} limit={limitCount} hasNext={products.length === limitCount} />
      </section>
    </div>
  );
}
