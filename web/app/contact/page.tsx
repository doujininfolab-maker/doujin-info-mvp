import Link from "next/link";

export const metadata = { title: "お問い合わせ" };

export default function ContactPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">CONTACT</p>
        <h1>お問い合わせ</h1>
        <p>
          掲載情報の修正依頼、削除依頼、不具合報告、権利者様・サークル関係者様からのご連絡、広告・提携に関するご相談を受け付ける窓口です。
        </p>
        <p>
          お問い合わせフォームまたは連絡先は公開運用前に設置予定です。設置後は、対象作品のURL、RJ番号、修正内容、権利者様からのご連絡であることが分かる情報を添えてご連絡ください。
        </p>

        <div className="staticPage__grid">
          <div>
            <h2>作品情報の修正・削除依頼</h2>
            <p>
              作品名、サークル名、価格、画像、ジャンルなどの掲載内容に問題がある場合は、対象作品が分かる情報を添えてご連絡ください。
            </p>
          </div>
          <div>
            <h2>不具合報告</h2>
            <p>
              画面表示の崩れ、検索結果の不具合、リンク切れ、グラフ表示の問題などがある場合は、発生ページと状況をお知らせください。
            </p>
          </div>
          <div>
            <h2>権利者様からのご連絡</h2>
            <p>
              権利者様、サークル関係者様からのご連絡は、内容を確認のうえ対応を検討します。確認のため追加情報をお願いする場合があります。
            </p>
          </div>
          <div>
            <h2>返信について</h2>
            <p>
              内容により返信まで時間がかかる場合や、返信できない場合があります。迷惑行為、営業目的のみの連絡には対応しない場合があります。
            </p>
          </div>
        </div>

        <div className="staticPage__actions">
          <Link href="/faq">よくある質問を見る</Link>
          <Link href="/">TOPへ戻る</Link>
        </div>
      </section>
    </main>
  );
}
