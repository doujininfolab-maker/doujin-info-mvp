import Link from "next/link";

export default function NotFoundPage() {
  return (
    <div className="emptyState">
      <h1>ページが見つかりません</h1>
      <p>URLが間違っているか、まだ有効化されていないセグメントです。</p>
      <Link className="button" href="/">TOPへ戻る</Link>
    </div>
  );
}
