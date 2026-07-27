"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SortOption<T extends string> = {
  label: string;
  value: T;
};

export function SortSelect<T extends string>({
  value,
  options,
  defaultValue,
  label = "並び順",
  paramName = "sort",
}: {
  value: T;
  options: readonly SortOption<T>[];
  defaultValue: T;
  label?: string;
  paramName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="listToolbar__selectLabel">
      <span>{label}</span>
      <select
        className="listToolbar__select"
        value={value}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams.toString());
          const nextValue = event.target.value as T;
          if (nextValue === defaultValue) {
            params.delete(paramName);
          } else {
            params.set(paramName, nextValue);
          }
          params.set("page", "1");
          const query = params.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
