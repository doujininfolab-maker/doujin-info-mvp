import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "よくある質問",
  alternates: { canonical: "/faq" },
};

const questions = [
  ["このサイトは何のサイトですか？", "DLsite女性向け同人作品を、検索・ランキング・新着・ジャンル・サークルから探しやすくするための情報サイトです。"],
  ["DLsite公式サイトですか？", "いいえ。本サイトはDLsite公式サイトではありません。掲載情報は公開情報をもとに整理した参考情報です。"],
  ["表示されている販売数や価格は正確ですか？", "取得時点の参考値です。価格、割引、販売数、評価、販売状況はDLsite公式ページと異なる場合があります。"],
  ["推定売上は実際の売上ですか？", "いいえ。販売数の増加と価格などをもとに算出した目安であり、実際の売上を保証するものではありません。"],
  ["グラフが表示されない作品があるのはなぜですか？", "グラフは直近の販売データがある場合のみ表示されます。新着で取得された作品でも、継続取得対象にならない場合は表示されないことがあります。"],
  ["ランキングの基準は何ですか？", "日間・週間・月間は取得した販売数の増加を、推定日間売上は販売数の増加と価格をもとに集計しています。累計は取得時点の累計販売数です。DLsite公式ランキングとは異なります。"],
  ["TLとBLの切り替えは何ですか？", "表示する作品の対象をTL、BL、または全てに切り替えるための機能です。"],
  ["検索しても作品が出ない場合はありますか？", "あります。本サイトのDBに未取得の作品、検索対象外の作品、表記ゆれがある作品は表示されない場合があります。"],
  ["成人向け作品は表示されますか？", "表示される場合があります。成人向け作品を含む可能性があるため、未成年の方の閲覧・利用はお控えください。"],
  ["購入はできますか？", "作品詳細の「DLsiteで詳細を見る（PR）」からDLsiteの商品ページへ移動できます。購入手続きはDLsite公式サイト上で行われます。"],
  ["アフィリエイトリンクを利用していますか？", "はい。本サイトはDLsiteアフィリエイトプログラムを利用しています。作品リンク経由で購入された場合、運営者に報酬が発生することがあります。"],
  ["作品情報の修正依頼・削除依頼はできますか？", "権利者様、サークル関係者様からの修正・削除依頼は、お問い合わせページからご連絡ください。内容を確認のうえ対応します。"],
] as const;

export default function FaqPage() {
  return (
    <main className="staticPage staticPage--faq">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">FAQ</p>
        <h1>よくある質問</h1>
        <div className="staticPage__faq">
          {questions.map(([question, answer], index) => (
            <details key={question} open={index === 0 || index === 5}>
              <summary><span>{question}</span></summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
        <div className="staticPage__actions">
          <Link href="/contact">お問い合わせへ</Link>
          <Link href="/guide">使い方を見る</Link>
        </div>
      </section>
    </main>
  );
}
