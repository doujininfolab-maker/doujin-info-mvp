"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "@/components/icons/SiteIcons";
import { SEARCH_TARGET_OPTIONS, type SearchTarget } from "@/lib/searchTarget";

type SearchPageFormProps = {
  keyword: string;
  searchTarget: SearchTarget;
  contentTypeParam?: string;
  workType?: string;
  limitCount: number;
};

export function SearchPageForm({ keyword, searchTarget, contentTypeParam, workType, limitCount }: SearchPageFormProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [currentKeyword, setCurrentKeyword] = useState(keyword);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrentKeyword(keyword);
  }, [keyword]);

  const updateQuery = (nextSearchTarget: SearchTarget, nextKeyword = inputRef.current?.value ?? currentKeyword) => {
    const params = new URLSearchParams(searchParams.toString());
    const normalizedKeyword = nextKeyword.trim();

    params.delete("page");

    if (normalizedKeyword) {
      params.set("q", normalizedKeyword);
    } else {
      params.delete("q");
    }

    if (nextSearchTarget === "all") {
      params.delete("searchTarget");
    } else {
      params.set("searchTarget", nextSearchTarget);
    }

    params.set("limit", String(limitCount));

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <form
      className="searchPageForm searchPageForm--withTarget"
      action="/search"
      method="get"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        updateQuery(searchTarget, currentKeyword);
      }}
    >
      <div className="searchPageForm__keyword">
        <input
          ref={inputRef}
          name="q"
          aria-label="検索キーワード"
          placeholder="作品名・サークル名・ジャンルで検索"
          value={currentKeyword}
          autoComplete="off"
          onChange={(event) => setCurrentKeyword(event.target.value)}
        />
        <button type="submit" aria-label="検索する"><SearchIcon /></button>
      </div>
      <select
        className="searchPageForm__targetSelect"
        name="searchTarget"
        aria-label="検索対象"
        value={searchTarget}
        onChange={(event) => updateQuery(event.target.value as SearchTarget)}
      >
        {SEARCH_TARGET_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {contentTypeParam ? <input type="hidden" name="contentType" value={contentTypeParam} /> : null}
      {workType ? <input type="hidden" name="workType" value={workType} /> : null}
      <input type="hidden" name="limit" value={limitCount} />
    </form>
  );
}
