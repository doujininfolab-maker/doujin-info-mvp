import Link from "next/link";

export const metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">PRIVACY</p>
        <h1>プライバシーポリシー</h1>
        <p>
          Doujin Infoは、利用者のプライバシーに配慮し、本サイトの運営に必要な範囲で情報を取り扱います。
          本ポリシーは、今後の機能追加や利用サービスの変更に応じて改定する場合があります。
        </p>

        <div className="staticPage__grid">
          <div>
            <h2>取得する情報</h2>
            <p>
              通常の閲覧において、氏名、住所、電話番号などを直接入力していただく機能は現在設けていません。
              お問い合わせ機能を設置した場合は、返信や確認に必要な連絡先、問い合わせ内容、対象作品情報などを取得する場合があります。
            </p>
          </div>
          <div>
            <h2>利用目的</h2>
            <p>
              取得した情報は、お問い合わせ対応、不具合確認、掲載情報の修正・削除対応、サイト改善、迷惑行為への対応のために利用します。
            </p>
          </div>
          <div>
            <h2>Cookie・アクセス解析</h2>
            <p>
              現在の実装では、Google Analytics等のアクセス解析タグは確認されていません。将来アクセス解析や広告配信を導入する場合は、本ページに追記します。
            </p>
          </div>
          <div>
            <h2>外部サービス</h2>
            <p>
              本サイトはFirebase Hosting、Firebase、Google Cloud等のサービスを利用して運営される場合があります。
              外部サイトへ移動した後の情報の取り扱いは、各外部サービスの規約・ポリシーに従います。
            </p>
          </div>
          <div>
            <h2>アフィリエイトリンク</h2>
            <p>
              本サイト内の外部リンクには、アフィリエイトリンクが含まれる場合があります。外部サイトでの商品購入や利用手続きは、リンク先サイトの規約に従ってください。
            </p>
          </div>
          <div>
            <h2>第三者提供・改定</h2>
            <p>
              法令に基づく場合などを除き、取得した情報を目的外に第三者へ提供しません。本ポリシーは、必要に応じて予告なく改定する場合があります。
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
