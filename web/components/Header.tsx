"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { CircleNavIcon, GenreNavIcon, LogoIcon, NewNavIcon, RankingNavIcon, SaleNavIcon, SearchIcon } from "@/components/icons/SiteIcons";
import { CONTENT_SCOPE_OPTIONS, contentTypeParamForScope, parseContentScope, type ProductContentScope } from "@/lib/contentCategories";

function buildHrefWithContentScope(basePath: string, scope: ProductContentScope): string {
  const params = new URLSearchParams();
  const contentTypeParam = contentTypeParamForScope(scope);
  if (contentTypeParam) params.set("contentType", contentTypeParam);
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

function buildCurrentPathWithContentScope(pathname: string, searchParams: { toString(): string }, scope: ProductContentScope): string {
  const params = new URLSearchParams(searchParams.toString());
  const contentTypeParam = contentTypeParamForScope(scope);

  params.delete("page");
  if (contentTypeParam) {
    params.set("contentType", contentTypeParam);
  } else {
    params.delete("contentType");
  }

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

function ContentScopeSwitch({ currentScope }: { currentScope: ProductContentScope }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className="contentScopeSwitch" aria-label="表示対象">
      {CONTENT_SCOPE_OPTIONS.map((option) => (
        <Link
          className={option.value === currentScope ? "isActive" : undefined}
          href={buildCurrentPathWithContentScope(pathname, searchParams, option.value)}
          key={option.value}
          prefetch={false}
          scroll={false}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentScope = parseContentScope(searchParams.get("contentType") ?? undefined);
  const scopedHref = (path: string) => buildHrefWithContentScope(path, currentScope);
  const searchContentType = contentTypeParamForScope(currentScope);
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const isCircleListPage = pathname.endsWith("/circle");
  const isGenrePage = pathname.includes("/genre");
  const isExplorePage = pathname === "/search" || isGenrePage || isCircleListPage;

  useEffect(() => {
    setIsMobileSearchOpen(false);
  }, [pathname]);

  return (
    <header className="siteHeader">
      <div className="siteHeader__inner">
        <div className="siteHeader__top">
          <Link className="brand" href={scopedHref("/")} aria-label="Doujin Info サイトトップ" prefetch={false}>
            <LogoIcon />
          </Link>

          <button
            className="mobileSearchToggle"
            type="button"
            aria-label={isMobileSearchOpen ? "検索を閉じる" : "検索を開く"}
            aria-controls="global-search-form"
            aria-expanded={isMobileSearchOpen}
            onClick={() => setIsMobileSearchOpen((current) => !current)}
          >
            <SearchIcon />
          </button>

          <form
            id="global-search-form"
            className={`searchBox${isMobileSearchOpen ? " isMobileOpen" : ""}`}
            role="search"
            action="/search"
            method="get"
          >
            <input name="q" aria-label="検索" placeholder="作品名・サークル名・ジャンルで検索" />
            {searchContentType ? <input type="hidden" name="contentType" value={searchContentType} /> : null}
            <button type="submit" aria-label="検索する">
              <SearchIcon />
            </button>
            <button
              className="mobileSearchClose"
              type="button"
              onClick={() => setIsMobileSearchOpen(false)}
            >
              閉じる <span aria-hidden="true">×</span>
            </button>
          </form>
        </div>

        <div className="siteHeader__bottom">
          <nav className="primaryNav" aria-label="主要メニュー">
            <Link href={scopedHref("/dlsite/female/doujin/ranking")} prefetch={false}><RankingNavIcon />ランキング</Link>
            <Link href={scopedHref("/dlsite/female/doujin/new")} prefetch={false}><NewNavIcon />新着</Link>
            <Link href={scopedHref("/dlsite/female/doujin/sale")} prefetch={false}><SaleNavIcon />セール</Link>
            <Link href={scopedHref("/dlsite/female/doujin/circle")} prefetch={false}><CircleNavIcon />サークル</Link>
            <Link href={scopedHref("/dlsite/female/doujin/genre")} prefetch={false}><GenreNavIcon />ジャンル</Link>
          </nav>

          <div className="headerSwitches" aria-label="現在の対象">
            <div className="toggleGroup" aria-label="現在のプラットフォーム">
              <span className="toggleGroup__item isActive">DLsite</span>
            </div>
            <ContentScopeSwitch currentScope={currentScope} />
            <div className="toggleGroup toggleGroup--audience" aria-label="現在の対象ジャンル">
              <span className="toggleGroup__item isActive">女性向け</span>
            </div>
          </div>
        </div>

        {isExplorePage ? (
          <nav className="mobileExploreNav" aria-label="探すメニュー">
            <Link className={pathname === "/search" ? "isActive" : undefined} href={scopedHref("/search")} prefetch={false}>検索</Link>
            <Link className={isGenrePage ? "isActive" : undefined} href={scopedHref("/dlsite/female/doujin/genre")} prefetch={false}>ジャンル</Link>
            <Link className={isCircleListPage ? "isActive" : undefined} href={scopedHref("/dlsite/female/doujin/circle")} prefetch={false}>サークル</Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
