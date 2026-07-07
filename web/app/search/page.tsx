import { ProductGrid } from "@/components/ProductGrid";
import { SectionHeader } from "@/components/SectionHeader";
import { PageSizeSelect } from "@/components/PageSizeSelect";
import { ListPagination } from "@/components/ListPagination";
import { ListPageInfo } from "@/components/ListPageInfo";
import { WorkTypeTabs } from "@/components/WorkTypeTabs";
import { SearchPageForm } from "@/components/SearchPageForm";
import { SearchIcon } from "@/components/icons/SiteIcons";
import { searchProductsWithTotal } from "@/lib/firebase/products";
import { getSegment } from "@/lib/siteSegments";
import { contentTypeForFilter, contentTypeParamForScope, getContentScopeLabel, parseContentScope } from "@/lib/contentCategories";
import { parsePageNumber } from "@/lib/pageSize";
import { getWorkTypeLabel, parseWorkType } from "@/lib/workTypes";
import { normalizeSearchText } from "@/lib/search";
import { getSearchTargetLabel, parseSearchTarget, searchTargetParamForScope } from "@/lib/searchTarget";

export const dynamic = "force-dynamic";

const SEARCH_PAGE_SIZE_OPTIONS = [30, 50, 100] as const;

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = {
  title: "検索",
  description: "作品名・サークル名・ジャンルで検索できます。",
};

function getFirstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseSearchPageSize(value: string | string[] | undefined): 30 | 50 | 100 {
  const parsed = Number(getFirstParam(value) ?? 30);
  if (parsed === 50 || parsed === 100) return parsed;
  return 30;
}

function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const query = searchParams ? await searchParams : {};
  const keyword = normalizeSearchText(getFirstParam(query.q));
  const limitCount = parseSearchPageSize(query.limit);
  const pageNumber = parsePageNumber(query.page);
  const offsetCount = (pageNumber - 1) * limitCount;
  const workType = parseWorkType(query.workType);
  const searchTarget = parseSearchTarget(query.searchTarget);
  const searchTargetParam = searchTargetParamForScope(searchTarget);
  const searchTargetLabel = getSearchTargetLabel(searchTarget);
  const contentScope = parseContentScope(query.contentType);
  const contentType = contentTypeForFilter(contentScope);
  const contentTypeParam = contentTypeParamForScope(contentScope);
  const segment = getSegment("dlsite", "female", "doujin");

  const searchFilter = segment && keyword
    ? {
        platform: segment.platform,
        audience: segment.audience,
        category: segment.category,
        keyword,
        limitCount,
        offsetCount,
        workType,
        contentType,
        searchTarget,
      }
    : undefined;

  const { products, totalCount } = searchFilter
    ? await searchProductsWithTotal(searchFilter)
    : { products: [], totalCount: 0 };

  const hasSearched = Boolean(keyword);
  const hasNext = offsetCount + products.length < totalCount;

  return (
    <div className="listPage listPage--wide">
      <section className="contentSection listSection searchResultSection">
        <SectionHeader
          title="検索結果"
          description={hasSearched ? `「${keyword}」の検索結果 ${formatNumber(totalCount)}件` : "作品名・サークル名・ジャンルで検索できます。"}
          icon={<SearchIcon />}
        >
          <WorkTypeTabs
            basePath="/search"
            currentWorkType={workType}
            currentParams={{
              q: keyword || undefined,
              contentType: contentTypeParam,
              limit: String(limitCount),
              page: "1",
              searchTarget: searchTargetParam,
            }}
          />
        </SectionHeader>

        <SearchPageForm
          keyword={keyword}
          searchTarget={searchTarget}
          contentTypeParam={contentTypeParam}
          workType={workType}
          limitCount={limitCount}
        />

        {hasSearched ? (
          <>
            <ListPageInfo
              title="検索条件に合う作品を表示しています"
              description={searchTarget === "all"
                ? "作品名・サークル名・ジャンル・タグ・RJ番号を対象に直接部分一致で検索しています。"
                : `${searchTargetLabel}を対象に直接部分一致で検索しています。`
              }
              items={[
                { label: "キーワード", value: `「${keyword}」` },
                { label: "ヒット件数", value: `${formatNumber(totalCount)}件` },
                { label: "対象", value: getContentScopeLabel(contentScope) },
                { label: "作品形式", value: getWorkTypeLabel(workType) },
              ]}
            />
            <div className="listToolbar listToolbar--below">
              <PageSizeSelect value={limitCount} options={SEARCH_PAGE_SIZE_OPTIONS} />
              <ListPagination page={pageNumber} limit={limitCount} hasNext={hasNext} />
            </div>

            {products.length ? (
              <ProductGrid products={products} variant="list" contentTypeParam={contentTypeParam} />
            ) : (
              <div className="searchEmptyState">
                <strong>該当する作品が見つかりませんでした。</strong>
                <p>キーワードを変えるか、TL / BL の切り替えやカテゴリを変更してください。</p>
              </div>
            )}

            <ListPagination page={pageNumber} limit={limitCount} hasNext={hasNext} />
          </>
        ) : (
          <div className="searchEmptyState">
            <strong>検索キーワードを入力してください。</strong>
            <p>作品名・サークル名・ジャンル・RJ番号などで検索できます。</p>
          </div>
        )}
      </section>
    </div>
  );
}
