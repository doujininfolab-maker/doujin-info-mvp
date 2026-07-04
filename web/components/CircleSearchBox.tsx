"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons/SiteIcons";

type CircleSearchBoxProps = {
  value?: string;
};

export function CircleSearchBox({ value = "" }: CircleSearchBoxProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState(value);
  const [isPending, startTransition] = useTransition();
  const isComposingRef = useRef(false);

  useEffect(() => {
    setKeyword(value);
  }, [value]);

  const updateQuery = (nextKeyword: string) => {
    const params = new URLSearchParams(searchParams.toString());
    const normalizedKeyword = nextKeyword.trim();

    params.delete("page");

    if (normalizedKeyword) {
      params.set("q", normalizedKeyword);
    } else {
      params.delete("q");
    }

    const query = params.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  };

  return (
    <form
      className="searchBox circleSearchBox"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        updateQuery(keyword);
      }}
    >
      <input
        aria-label="サークル検索"
        value={keyword}
        placeholder="サークル名で検索"
        autoComplete="off"
        onChange={(event) => {
          const nextKeyword = event.target.value;
          setKeyword(nextKeyword);
          if (!isComposingRef.current) {
            updateQuery(nextKeyword);
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          isComposingRef.current = false;
          updateQuery(event.currentTarget.value);
        }}
      />
      <button type="submit" aria-label="サークルを検索する" disabled={isPending}>
        <SearchIcon />
      </button>
    </form>
  );
}
