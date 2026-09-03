import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "ご利用ガイド",
  alternates: { canonical: "/guide" },
};

const guideSections = [
  ["同人インフォについて", "同人インフォは、同人作品のランキングや売上予測、レビューなどをまとめて閲覧できる非公式の情報サイトです。"],
  ["掲載データについて", "本サイトに掲載されているデータは、各販売サイトの公開情報をもとに自動収集・集計したものです。そのため、実際の販売状況やデータと異なる場合があります。"],
  ["ランキングについて", "ランキングは、推定売上や販売数、レビュー評価などを総合的に集計し、独自のアルゴリズムで算出しています。集計タイミングや指標の重みにより、順位は変動します。"],
  ["推定売上について", "推定売上は、販売サイトの公開ランキングや価格、レビュー数などから独自に算出した目安です。実際の売上額とは異なる場合があります。"],
  ["作品・サークル・ジャンルの探し方", "画面上部の検索アイコンからキーワード検索ができます。また、ジャンル（TL / BL / すべて）やランキング、新着作品からも作品を探すことができます。"],
  ["外部販売サイトへの移動", "作品詳細ページの「販売サイトで見る」ボタンをタップすると、外部の販売サイト（DLsite・FANZA・Ci-enなど）に移動します。購入や閲覧は各サイトで行ってください。"],
  ["注意事項", "本サイトは非公式の情報サイトであり、各販売サイトや運営者とは一切関係ありません。内容の正確性を保証するものではありませんので、あらかじめご了承ください。"],
] as const;

export default function GuidePage() {
  return (
    <main className="staticPage staticPage--guide">
      <section className="staticPage__card">
        <h1>ご利用ガイド</h1>
        <p className="staticPage__lead">同人インフォの使い方やデータの見方についてご案内します。</p>

        <nav className="guideToc" aria-label="目次">
          <strong>目次</strong>
          <ol>
            {guideSections.map(([title], index) => <li key={title}><a href={`#guide-${index + 1}`}>{title}</a></li>)}
          </ol>
          <Link href="/">トップへ戻る ›</Link>
        </nav>

        <div className="staticPage__grid guideSections">
          {guideSections.map(([title, description], index) => (
            <section id={`guide-${index + 1}`} key={title}>
              <h2>{title}</h2>
              <p>{description}</p>
            </section>
          ))}
        </div>

        <div className="staticPage__actions">
          <Link href="/">トップへ戻る</Link>
          <Link href="/faq">よくある質問を見る</Link>
        </div>
      </section>
    </main>
  );
}
