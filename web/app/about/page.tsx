import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "このサイトについて",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <main className="staticPage staticPage--about">
      <section className="staticPage__card">
        <h1>このサイトについて</h1>
        <div className="staticPage__grid aboutSections">
          <section>
            <h2>同人インフォとは</h2>
            <p>同人インフォは、女性向け同人作品の情報をまとめて探せるポータルサイトです。DLsiteで販売されている同人作品のランキングや新着作品、セール情報などを分かりやすくお届けします。</p>
          </section>
          <section>
            <h2>主な機能</h2>
            <ul>
              <li><strong>ランキング：</strong>人気作品をリアルタイムでランキング表示</li>
              <li><strong>新着作品：</strong>最新の同人作品をいち早くチェック</li>
              <li><strong>セール：</strong>お得なセール対象作品をまとめて確認</li>
              <li><strong>ジャンル：</strong>好みのジャンルから作品を探せる</li>
              <li><strong>サークル：</strong>気になるサークルの作品を一覧で確認</li>
              <li><strong>キーワード検索：</strong>フリーワードで作品を検索</li>
              <li><strong>売上・販売数の推移：</strong>作品の人気動向をグラフで確認</li>
            </ul>
          </section>
          <section>
            <h2>掲載情報について</h2>
            <p>本サイトに掲載している情報は、DLsiteの公開情報をもとに独自に集計・作成したものです。作品の販売状況や価格などは、DLsiteのサイト上でご確認ください。</p>
          </section>
          <section>
            <h2>運営方針</h2>
            <p>ユーザーの皆さまに役立つ情報を中立的な立場で提供することを目的としています。特定の作品やサークルを推奨・優遇することはありません。</p>
          </section>
          <section>
            <h2>免責事項</h2>
            <p>本サイトの情報は可能な限り正確に提供するよう努めていますが、その正確性・完全性を保証するものではありません。本サイトの利用によって生じたいかなる損害についても、当サイトは一切の責任を負いかねます。</p>
          </section>
        </div>
        <div className="staticPage__actions">
          <Link href="/guide">ご利用ガイドはこちら</Link>
          <Link href="/contact">お問い合わせへ</Link>
        </div>
      </section>
    </main>
  );
}
