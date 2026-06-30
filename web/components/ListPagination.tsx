import Link from "next/link";

function buildHref(page: number, limit: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("page", String(page));
  return `?${params.toString()}`;
}

export function ListPagination({
  page,
  limit,
  hasNext,
}: {
  page: number;
  limit: number;
  hasNext: boolean;
}) {
  const prevPage = Math.max(1, page - 1);
  const nextPage = page + 1;

  return (
    <nav className="listPagination" aria-label="ページ移動">
      {page > 1 ? (
        <Link className="listPagination__button" href={buildHref(prevPage, limit)}>
          « 前へ
        </Link>
      ) : (
        <span className="listPagination__button listPagination__button--disabled">« 前へ</span>
      )}
      <span className="listPagination__current">{page}</span>
      {hasNext ? (
        <Link className="listPagination__button" href={buildHref(nextPage, limit)}>
          次へ »
        </Link>
      ) : (
        <span className="listPagination__button listPagination__button--disabled">次へ »</span>
      )}
    </nav>
  );
}
