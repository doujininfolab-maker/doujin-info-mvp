import type { Metadata } from "next";
import Link from "next/link";

const DEFAULT_CONTACT_FORM_URL = "https://forms.gle/MPH9jyVfsaiaNsc97";

export const metadata: Metadata = {
  title: "お問い合わせ",
  description: "掲載情報の修正・削除依頼、不具合報告、権利者様からのご連絡を受け付けています。",
  alternates: { canonical: "/contact" },
};

function getContactFormUrl(): string | undefined {
  const configuredUrl = process.env.CONTACT_FORM_URL?.trim() || DEFAULT_CONTACT_FORM_URL;

  try {
    const url = new URL(configuredUrl);
    const isGoogleForms = url.protocol === "https:" && (
      url.hostname === "forms.gle" ||
      (url.hostname === "docs.google.com" && url.pathname.startsWith("/forms/"))
    );

    return isGoogleForms ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export default function ContactPage() {
  const contactFormUrl = getContactFormUrl();

  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">CONTACT</p>
        <h1>お問い合わせ</h1>
        <p>
          掲載情報の修正依頼、削除依頼、不具合報告、権利者様・サークル関係者様からのご連絡、広告・提携に関するご相談を受け付けています。
        </p>

        <div className="contactFormCallout">
          <div>
            <h2>Googleフォームからお問い合わせください</h2>
            <p>
              対象ページのURL、RJ番号、問い合わせ内容を添えていただくと確認がスムーズです。返信が必要な場合は、フォーム内に連絡先をご入力ください。
            </p>
          </div>
          {contactFormUrl ? (
            <a className="button button--official" href={contactFormUrl} target="_blank" rel="noreferrer">
              お問い合わせフォームを開く
            </a>
          ) : (
            <span className="contactFormCallout__pending">お問い合わせフォームは現在準備中です。</span>
          )}
        </div>

        <div className="staticPage__grid">
          <div>
            <h2>作品情報の修正・削除依頼</h2>
            <p>
              作品名、サークル名、価格、画像、ジャンルなどの掲載内容に問題がある場合は、対象URLとRJ番号を添えてご連絡ください。
            </p>
          </div>
          <div>
            <h2>不具合報告</h2>
            <p>
              画面表示の崩れ、検索結果の不具合、リンク切れ、グラフ表示の問題などがある場合は、発生ページ、操作内容、利用端末をお知らせください。
            </p>
          </div>
          <div>
            <h2>権利者様からのご連絡</h2>
            <p>
              権利者様、サークル関係者様からのご連絡は、内容を確認のうえ対応します。確認のため追加情報をお願いする場合があります。
            </p>
          </div>
          <div>
            <h2>返信について</h2>
            <p>
              内容により返信まで時間がかかる場合や、個別に返信できない場合があります。迷惑行為や営業目的のみの連絡には対応しない場合があります。
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
