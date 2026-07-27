"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { SearchIcon } from "@/components/icons/SiteIcons";

type CircleSearchBoxProps = {
  value?: string;
};

const SEARCH_DEBOUNCE_MS = 300;

export function CircleSearchBox({ value = "" }: CircleSearchBoxProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [keyword, setKeyword] = useState(value);
  const [isPending, startTransition] = useTransition();
  const isComposingRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setKeyword(value);
  }, [value]);

  useEffect(() => () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
  }, []);

  const clearScheduledUpdate = () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = undefined;
    }
  };

  const updateQuery = (nextKeyword: string) => {
    clearScheduledUpdate();

    const params = new URLSearchParams(searchParams.toString());
    const normalizedKeyword = nextKeyword.trim();
    const currentKeyword = (params.get("q") ?? "").trim();

    if (normalizedKeyword === currentKeyword) return;

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

  const scheduleQueryUpdate = (nextKeyword: string) => {
    clearScheduledUpdate();
    debounceTimerRef.current = setTimeout(() => {
      updateQuery(nextKeyword);
    }, SEARCH_DEBOUNCE_MS);
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
            scheduleQueryUpdate(nextKeyword);
          }
        }}
        onCompositionStart={() => {
          isComposingRef.current = true;
          clearScheduledUpdate();
        }}
        onCompositionEnd={(event) => {
          isComposingRef.current = false;
          scheduleQueryUpdate(event.currentTarget.value);
        }}
      />
      <button type="submit" aria-label="サークルを検索する" disabled={isPending}>
        <SearchIcon />
      </button>
    </form>
  );
}
