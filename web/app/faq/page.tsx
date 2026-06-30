import Link from "next/link";

export const metadata = { title: "よくある質問" };

export default function FaqPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">FAQ</p>
        <h1>よくある質問</h1>
        <dl className="staticPage__faq">
          <dt>表示されている販売数や価格は正確ですか？</dt>
          <dd>公開情報をもとにした参考値です。最新・正確な情報は公式サイトで確認してください。</dd>
          <dt>購入はできますか？</dt>
          <dd>作品詳細の「公式サイトで見る」からDLsiteの商品ページへ移動できます。</dd>
          <dt>FANZAや男性向け作品は対応していますか？</dt>
          <dd>横展開予定ですが、MVPではDLsite女性向け同人を優先しています。</dd>
        </dl>
        <div className="staticPage__actions"><Link href="/contact">お問い合わせへ</Link></div>
      </section>
    </main>
  );
}
