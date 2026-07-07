import Link from "next/link";

export const metadata = { title: "使い方" };

export default function GuidePage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">GUIDE</p>
        <h1>使い方</h1>
        <p>
          Doujin Infoは、DLsite女性向け同人作品を、検索・ランキング・新着・ジャンル・サークルから探しやすくするための情報サイトです。
          掲載情報は取得時点の参考情報です。購入前には、必ずDLsite公式の商品ページで最新情報をご確認ください。
        </p>

        <div className="staticPage__grid">
          <div>
            <h2>作品を探す</h2>
            <p>
              TOPページやランキング、新着、セール、ジャンル、サークル一覧から作品を探せます。
              TL/乙女向け・BLの切り替えや、作品形式タブを使って表示対象を絞り込めます。
            </p>
          </div>
          <div>
            <h2>キーワード検索</h2>
            <p>
              検索結果ページでは、作品名・サークル名・ジャンルなどを対象にキーワード検索できます。
              検索対象は「全て」「作品名」「サークル名」「ジャンル」から選択できます。
            </p>
          </div>
          <div>
            <h2>ランキング・注目作品</h2>
            <p>
              ランキング、最近追加された作品、注目サークルなどから、人気作品や新しい作品を確認できます。
              表示順位や数値は、取得時点のデータをもとにした参考情報です。
            </p>
          </div>
          <div>
            <h2>作品詳細・サークル詳細</h2>
            <p>
              作品詳細ページでは価格、販売数、評価、発売日、ジャンル、販売推移などを確認できます。
              サークル詳細ページでは、同じサークルの作品や販売傾向を確認できます。
            </p>
          </div>
          <div>
            <h2>グラフについて</h2>
            <p>
              グラフは、直近の販売データがある作品・サークルのみ表示されます。
              新着で取得された作品でも、継続取得対象にならない場合は、販売推移が表示されないことがあります。
            </p>
          </div>
          <div>
            <h2>公式ページで確認</h2>
            <p>
              作品詳細の「公式サイトで見る」からDLsiteの商品ページへ移動できます。
              価格、割引、販売状況、年齢制限などの最新情報は、DLsite公式ページをご確認ください。
            </p>
          </div>
        </div>

        <div className="staticPage__actions">
          <Link href="/">TOPへ戻る</Link>
          <Link href="/faq">よくある質問を見る</Link>
        </div>
      </section>
    </main>
  );
}
