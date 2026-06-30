import Link from "next/link";

export const metadata = { title: "運営について" };

export default function AboutPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">ABOUT</p>
        <h1>運営について</h1>
        <p>Doujin Infoは、同人作品の公開情報を整理し、作品探しをしやすくするための情報サイトです。</p>
        <p>掲載内容は参考情報であり、価格・販売数・評価などの最新情報は各公式サイトをご確認ください。</p>
        <div className="staticPage__actions"><Link href="/">TOPへ戻る</Link></div>
      </section>
    </main>
  );
}
