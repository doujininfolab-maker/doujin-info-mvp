import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="emptyState">
      <div className="emptyState__card">
        <div className="emptyState__code" aria-hidden="true">404</div>
        <h1>ページが見つかりません</h1>
        <p>お探しのページは削除されたか、URLが変更された可能性があります。</p>
        <Link className="button" href="/">ホームへ戻る</Link>
      </div>
    </div>
  );
}
