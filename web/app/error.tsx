"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled page error", error);
  }, [error]);

  return (
    <section className="routeError" role="alert">
      <div className="routeError__card">
        <p className="routeError__eyebrow">ERROR</p>
        <h1>ページを表示できませんでした</h1>
        <p>
          一時的な通信エラーが発生した可能性があります。時間をおいて再度お試しください。
        </p>
        <div className="routeError__actions">
          <button type="button" onClick={reset}>再読み込みする</button>
          <a href="/">TOPへ戻る</a>
        </div>
      </div>
    </section>
  );
}
