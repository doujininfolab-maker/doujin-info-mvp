"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

function mergeHref(pathname: string, searchParams: URLSearchParams, page: number, limit: number): string {
  const params = new URLSearchParams(searchParams.toString());
  params.set("limit", String(limit));
  params.set("page", String(page));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const prevPage = Math.max(1, page - 1);
  const nextPage = page + 1;

  return (
    <nav className="listPagination" aria-label="ページ移動">
      {page > 1 ? (
        <Link className="listPagination__button" href={mergeHref(pathname, searchParams, prevPage, limit)}>
          « 前へ
        </Link>
      ) : (
        <span className="listPagination__button listPagination__button--disabled">« 前へ</span>
      )}
      <span className="listPagination__current">{page}</span>
      {hasNext ? (
        <Link className="listPagination__button" href={mergeHref(pathname, searchParams, nextPage, limit)}>
          次へ »
        </Link>
      ) : (
        <span className="listPagination__button listPagination__button--disabled">次へ »</span>
      )}
    </nav>
  );
}
