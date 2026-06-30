import Link from "next/link";

export const metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">TERMS</p>
        <h1>利用規約</h1>
        <p>本ページはMVP段階の仮ページです。公開運用前に、サイト利用条件・免責事項・禁止事項を整理して正式な内容へ更新します。</p>
        <div className="staticPage__actions"><Link href="/">TOPへ戻る</Link></div>
      </section>
    </main>
  );
}
