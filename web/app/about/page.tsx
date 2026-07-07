import Link from "next/link";

export const metadata = { title: "運営について" };

export default function AboutPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">ABOUT</p>
        <h1>運営について</h1>
        <p>
          Doujin Infoは、DLsite女性向け同人作品の公開情報を整理し、ユーザが自分の好みに合う作品を見つけやすくするための情報サイトです。
        </p>
        <p>
          本サイトはDLsite公式サイトではありません。掲載情報は取得時点の参考情報であり、価格、販売数、評価、割引、販売状況などの正確性・最新性を保証するものではありません。
        </p>

        <div className="staticPage__grid">
          <div>
            <h2>掲載データについて</h2>
            <p>
              作品情報、ランキング、販売数、価格、評価、発売日、ジャンルなどをもとに、作品探しに役立つ形で整理して表示しています。
              最新情報は必ずDLsite公式ページでご確認ください。
            </p>
          </div>
          <div>
            <h2>データ更新方針</h2>
            <p>
              データは一定間隔で取得しており、リアルタイムではありません。人気作品を中心に継続取得するため、全作品の継続データを保証するものではありません。
            </p>
          </div>
          <div>
            <h2>アフィリエイトについて</h2>
            <p>
              本サイト内の外部リンクには、アフィリエイトリンクが含まれる場合があります。リンク経由の購入により、運営者に報酬が発生する場合があります。
            </p>
          </div>
          <div>
            <h2>成人向けコンテンツについて</h2>
            <p>
              本サイトには成人向け作品が表示される場合があります。未成年の方の閲覧・利用にはご注意ください。
            </p>
          </div>
        </div>

        <div className="staticPage__actions">
          <Link href="/contact">お問い合わせへ</Link>
          <Link href="/terms">利用規約を見る</Link>
        </div>
      </section>
    </main>
  );
}
