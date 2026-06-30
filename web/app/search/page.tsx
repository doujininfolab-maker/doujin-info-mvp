import Link from "next/link";

type SearchPageProps = {
  searchParams?: Promise<{ q?: string }>;
};

export const metadata = {
  title: "検索",
  description: "作品名・サークル名・ジャンルで検索できます。",
};

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = searchParams ? await searchParams : {};
  const keyword = params.q?.trim() ?? "";

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
          <Link href="/dlsite/female/doujin/ranking">ランキングを見る</Link>
          <Link href="/dlsite/female/doujin/new">新着を見る</Link>
          <Link href="/dlsite/female/doujin/sale">セールを見る</Link>
        </div>
      </section>
    </main>
  );
}
