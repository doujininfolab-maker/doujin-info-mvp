import Link from "next/link";
import { contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";
import { buildFilterHref } from "@/lib/workTypes";

type SearchPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = {
  title: "検索",
  description: "作品名・サークル名・ジャンルで検索できます。",
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  const keyword = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? "";
  const contentScope = parseContentScope(params.contentType);
  const contentTypeParam = contentTypeParamForScope(contentScope);

  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">SEARCH</p>
        <h1>検索</h1>
        {keyword ? (
          <p>「{keyword}」の検索機能は準備中です。まずはランキング・新着・セール・ジャンルから探してください。</p>
        ) : (
          <p>検索機能は準備中です。まずはランキング・新着・セール・ジャンルから探してください。</p>
        )}
        <div className="staticPage__actions">
          <Link href={buildFilterHref("/dlsite/female/doujin/ranking", {}, { contentType: contentTypeParam })}>ランキングを見る</Link>
          <Link href={buildFilterHref("/dlsite/female/doujin/new", {}, { contentType: contentTypeParam })}>新着を見る</Link>
          <Link href={buildFilterHref("/dlsite/female/doujin/sale", {}, { contentType: contentTypeParam })}>セールを見る</Link>
        </div>
      </section>
    </main>
  );
}
