import Link from "next/link";

export const metadata = { title: "お問い合わせ" };

export default function ContactPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">CONTACT</p>
        <h1>お問い合わせ</h1>
        <p>お問い合わせフォームは準備中です。公開運用前に、連絡先またはフォームを設置予定です。</p>
        <p>掲載情報の修正依頼、権利者様からのご連絡、その他のお問い合わせ窓口として利用できるようにします。</p>
        <div className="staticPage__actions"><Link href="/">TOPへ戻る</Link></div>
      </section>
    </main>
  );
}
