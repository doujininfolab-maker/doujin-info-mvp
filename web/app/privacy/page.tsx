import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "プライバシーポリシー",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <main className="staticPage">
      <section className="staticPage__card">
        <p className="staticPage__eyebrow">PRIVACY</p>
        <h1>プライバシーポリシー</h1>
        <p>
          Doujin Info（以下「本サイト」）は、利用者のプライバシーに配慮し、本サイトの運営に必要な範囲で情報を取り扱います。
        </p>
        <p className="staticPage__updatedAt">制定日・最終更新日：2026年7月26日</p>

        <div className="staticPage__grid">
          <div>
            <h2>取得する情報</h2>
            <p>
              本サイトの閲覧時に、IPアドレス、User-Agent、アクセス日時、アクセス先URL、参照元などが、サーバーログとして記録される場合があります。
              Googleフォームからお問い合わせいただいた場合は、入力された連絡先、問い合わせ内容、対象作品情報などを取得します。
            </p>
          </div>
          <div>
            <h2>利用目的</h2>
            <p>
              取得した情報は、お問い合わせ対応、不具合確認、掲載情報の修正・削除対応、セキュリティ確保、迷惑行為への対応、本サイトの改善のために利用します。
            </p>
          </div>
          <div>
            <h2>Cookie・アクセス解析</h2>
            <p>
              現在、本サイトではGoogle Analytics等のアクセス解析サービスを利用していません。将来、アクセス解析や広告配信を導入する場合は、本ページを改定して利用目的等を明示します。
            </p>
          </div>
          <div>
            <h2>利用する外部サービス</h2>
            <p>
              本サイトはFirebase App Hosting、Cloud Firestore、Google Cloud、Googleフォーム等のサービスを利用します。
              各サービスにおける情報の取り扱いは、各事業者の規約・プライバシーポリシーにも従います。
            </p>
          </div>
          <div>
            <h2>アフィリエイトリンク</h2>
            <p>
              本サイトはDLsiteアフィリエイトプログラムを利用しています。作品リンク経由で購入された場合、運営者に報酬が発生することがあります。
            </p>
          </div>
          <div>
            <h2>保存期間・第三者提供</h2>
            <p>
              取得した情報は、利用目的の達成に必要な期間保存した後、適切な方法で削除します。法令に基づく場合などを除き、取得した情報を目的外に第三者へ提供しません。
            </p>
          </div>
          <div>
            <h2>開示・訂正・削除</h2>
            <p>
              ご本人から、保有する情報の開示、訂正、削除等の申し出があった場合は、本人確認を行ったうえで、法令に従い合理的な範囲で対応します。
            </p>
          </div>
          <div>
            <h2>本ポリシーの改定</h2>
            <p>
              法令、サービス内容、利用する外部サービスの変更等に応じて、本ポリシーを改定する場合があります。重要な変更は本ページでお知らせします。
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
