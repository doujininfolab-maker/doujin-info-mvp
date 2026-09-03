"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { HomeNavIcon, NewNavIcon, RankingNavIcon, SaleNavIcon, SearchIcon } from "@/components/icons/SiteIcons";
import { contentTypeParamForScope, parseContentScope } from "@/lib/contentCategories";

const items = [
  { label: "ホーム", href: "/", icon: <HomeNavIcon /> },
  { label: "ランキング", href: "/dlsite/female/doujin/ranking", icon: <RankingNavIcon /> },
  { label: "新着", href: "/dlsite/female/doujin/new", icon: <NewNavIcon /> },
  { label: "セール", href: "/dlsite/female/doujin/sale", icon: <SaleNavIcon /> },
  { label: "探す", href: "/search", icon: <SearchIcon /> },
] as const;

function getActiveLabel(pathname: string): (typeof items)[number]["label"] {
  if (pathname.includes("/ranking")) return "ランキング";
  if (pathname.endsWith("/new")) return "新着";
  if (pathname.endsWith("/sale")) return "セール";
  if (pathname === "/search" || pathname.includes("/genre") || pathname.includes("/circle") || pathname.includes("/work/")) return "探す";
  return "ホーム";
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scope = parseContentScope(searchParams.get("contentType") ?? undefined);
  const contentType = contentTypeParamForScope(scope);
  const activeLabel = getActiveLabel(pathname);

  return (
    <nav className="mobileBottomNav" aria-label="モバイルメニュー">
      {items.map((item) => {
        const isActive = item.label === activeLabel;
        const href = contentType ? `${item.href}?contentType=${encodeURIComponent(contentType)}` : item.href;

        return (
          <Link className={isActive ? "isActive" : undefined} href={href} key={item.label} prefetch={false} aria-current={isActive ? "page" : undefined}>
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
