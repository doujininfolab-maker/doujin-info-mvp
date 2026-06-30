import Link from "next/link";

export const metadata = { title: "使い方" };

export default function GuidePage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">GUIDE</p>
        <h1>使い方</h1>
        <p>Doujin Infoは、DLsite女性向け同人作品をランキング・新着・セール・ジャンル・サークルから探せる情報サイトです。</p>
        <div className="staticPage__grid">
          <div><h2>ランキング</h2><p>販売数や人気度の高い作品を確認できます。</p></div>
          <div><h2>新着</h2><p>最近追加・発売された作品を確認できます。</p></div>
          <div><h2>セール</h2><p>割引中の作品を確認できます。</p></div>
          <div><h2>サークル</h2><p>サークルごとの作品や販売傾向を確認できます。</p></div>
        </div>
        <div className="staticPage__actions"><Link href="/">TOPへ戻る</Link></div>
      </section>
    </main>
  );
}
