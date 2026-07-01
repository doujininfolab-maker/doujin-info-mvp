"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LogoIcon, NavIcon, SearchIcon } from "@/components/icons/SiteIcons";
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
          scroll={false}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}

export function Header() {
  const searchParams = useSearchParams();
  const currentScope = parseContentScope(searchParams.get("contentType") ?? undefined);
  const scopedHref = (path: string) => buildHrefWithContentScope(path, currentScope);
  const searchContentType = contentTypeParamForScope(currentScope);

  return (
    <header className="siteHeader">
      <div className="siteHeader__inner">
        <div className="siteHeader__top">
          <Link className="brand" href={scopedHref("/")} aria-label="Doujin Info サイトトップ">
            <LogoIcon />
            <span className="brand__text">
              <strong>Doujin Info</strong>
              <small>同人インフォ</small>
            </span>
          </Link>

          <form className="searchBox" role="search" action="/search" method="get">
            <input name="q" aria-label="検索" placeholder="作品名・サークル名・ジャンルで検索" />
            {searchContentType ? <input type="hidden" name="contentType" value={searchContentType} /> : null}
            <button type="submit" aria-label="検索する">
              <SearchIcon />
            </button>
          </form>
        </div>

        <div className="siteHeader__bottom">
          <nav className="primaryNav" aria-label="主要メニュー">
            <Link href={scopedHref("/dlsite/female/doujin/ranking")}><NavIcon>♕</NavIcon>ランキング</Link>
            <Link href={scopedHref("/dlsite/female/doujin/new")}><NavIcon>◉</NavIcon>新着</Link>
            <Link href={scopedHref("/dlsite/female/doujin/sale")}><NavIcon>◇</NavIcon>セール</Link>
            <Link href={scopedHref("/dlsite/female/doujin/circle")}><NavIcon>♧</NavIcon>サークル</Link>
            <Link href={scopedHref("/dlsite/female/doujin/genre")}><NavIcon>⌘</NavIcon>ジャンル</Link>
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
      </div>
    </header>
  );
}
