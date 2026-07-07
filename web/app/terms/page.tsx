import Link from "next/link";

export const metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">TERMS</p>
        <h1>利用規約</h1>
        <p>
          本規約は、Doujin Infoの利用条件を定めるものです。本サイトを利用する場合、本規約に同意したものとみなします。
        </p>

        <div className="staticPage__grid">
          <div>
            <h2>本サイトの位置づけ</h2>
            <p>
              本サイトは、DLsite女性向け同人作品の公開情報を整理して表示する非公式の情報サイトです。DLsite公式サイトではありません。
            </p>
          </div>
          <div>
            <h2>掲載情報について</h2>
            <p>
              価格、販売数、評価、ランキング、推定売上、発売日、割引情報などは取得時点の参考情報です。正確性、最新性、完全性を保証するものではありません。
            </p>
          </div>
          <div>
            <h2>外部サイトへのリンク</h2>
            <p>
              本サイトから外部サイトへ移動した後の商品購入、登録、問い合わせ、トラブル等については、リンク先サイトの規約・ポリシーに従うものとします。
            </p>
          </div>
          <div>
            <h2>アフィリエイト</h2>
            <p>
              本サイト内の外部リンクには、アフィリエイトリンクが含まれる場合があります。リンク経由の購入により、運営者に報酬が発生する場合があります。
            </p>
          </div>
          <div>
            <h2>成人向けコンテンツ</h2>
            <p>
              本サイトには成人向け作品が表示される場合があります。未成年の方の閲覧・利用はお控えください。
            </p>
          </div>
          <div>
            <h2>禁止事項</h2>
            <p>
              不正アクセス、過度なアクセス、情報の無断大量取得、第三者の権利侵害、運営を妨害する行為、法令や公序良俗に反する行為を禁止します。
            </p>
          </div>
          <div>
            <h2>免責事項</h2>
            <p>
              本サイトの情報を利用したこと、または利用できなかったことにより生じた損害について、運営者は責任を負いません。
              重要な判断や購入前には、必ず公式サイトで最新情報をご確認ください。
            </p>
          </div>
          <div>
            <h2>変更・停止</h2>
            <p>
              本サイトの仕様、掲載内容、提供機能、本規約は、必要に応じて予告なく変更・停止する場合があります。
            </p>
          </div>
        </div>

        <div className="staticPage__actions">
          <Link href="/privacy">プライバシーポリシーを見る</Link>
          <Link href="/contact">お問い合わせへ</Link>
        </div>
      </section>
    </main>
  );
}
