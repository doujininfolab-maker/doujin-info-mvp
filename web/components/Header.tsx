import Link from "next/link";
import { LogoIcon, NavIcon, SearchIcon } from "@/components/icons/SiteIcons";

export function Header() {
  return (
    <header className="siteHeader">
      <div className="siteHeader__inner">
        <div className="siteHeader__top">
          <Link className="brand" href="/" aria-label="Doujin Info サイトトップ">
            <LogoIcon />
            <span className="brand__text">
              <strong>Doujin Info</strong>
              <small>同人インフォ</small>
            </span>
          </Link>

          <form className="searchBox" role="search" action="/search" method="get">
            <input name="q" aria-label="検索" placeholder="作品名・サークル名・ジャンルで検索" />
            <button type="submit" aria-label="検索する">
              <SearchIcon />
            </button>
          </form>
        </div>

        <div className="siteHeader__bottom">
          <nav className="primaryNav" aria-label="主要メニュー">
            <Link href="/dlsite/female/doujin/ranking"><NavIcon>♕</NavIcon>ランキング</Link>
            <Link href="/dlsite/female/doujin/new"><NavIcon>◉</NavIcon>新着</Link>
            <Link href="/dlsite/female/doujin/sale"><NavIcon>◇</NavIcon>セール</Link>
            <Link href="/dlsite/female/doujin/circle"><NavIcon>♧</NavIcon>サークル</Link>
            <Link href="/dlsite/female/doujin"><NavIcon>⌘</NavIcon>ジャンル</Link>
          </nav>

          <div className="headerSwitches" aria-label="現在の対象">
            <div className="toggleGroup" aria-label="現在のプラットフォーム">
              <span className="toggleGroup__item isActive">DLsite</span>
            </div>
            <div className="toggleGroup" aria-label="現在の対象ジャンル">
              <span className="toggleGroup__item isActive">女性向け</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
