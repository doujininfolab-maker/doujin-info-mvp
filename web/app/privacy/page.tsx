import Link from "next/link";

export const metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">PRIVACY</p>
        <h1>プライバシーポリシー</h1>
        <p>本ページはMVP段階の仮ページです。公開運用前に、アクセス解析・広告・アフィリエイト等の利用状況に合わせて正式な内容へ更新します。</p>
        <div className="staticPage__actions"><Link href="/">TOPへ戻る</Link></div>
      </section>
    </main>
  );
}
