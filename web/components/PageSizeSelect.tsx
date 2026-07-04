"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PAGE_SIZE_OPTIONS = [30, 50, 100, 200] as const;

type PageSizeSelectProps = {
  value: number;
  options?: readonly number[];
};

export function PageSizeSelect({ value, options = PAGE_SIZE_OPTIONS }: PageSizeSelectProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="listToolbar__selectLabel">
      <span>表示件数</span>
      <select
        className="listToolbar__select"
        value={value}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          params.set("limit", event.target.value);
          params.set("page", "1");
          const query = params.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}件
          </option>
        ))}
      </select>
    </label>
  );
}
