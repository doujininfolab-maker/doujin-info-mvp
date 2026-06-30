"use client";

import Link from "next/link";
import { useState } from "react";
import { LogoIcon, NavIcon, SearchIcon } from "@/components/icons/SiteIcons";

function ToggleGroup<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="toggleGroup" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.value === value ? "toggleGroup__item isActive" : "toggleGroup__item"}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Header() {
  const [platform, setPlatform] = useState<"dlsite" | "fanza">("dlsite");
  const [audience, setAudience] = useState<"female" | "general">("female");

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

          <form className="searchBox" role="search">
            <input aria-label="検索" placeholder="作品名・サークル名・ジャンルで検索" />
            <button type="button" aria-label="検索する">
              <SearchIcon />
            </button>
          </form>

          <div className="headerActions" aria-label="ユーザー向けショートカット">
            <button type="button" aria-label="通知">♧</button>
            <button type="button" aria-label="お気に入り">♡</button>
          </div>
        </div>

        <div className="siteHeader__bottom">
          <nav className="primaryNav" aria-label="主要メニュー">
            <Link href="/dlsite/female/doujin/ranking"><NavIcon>♕</NavIcon>ランキング</Link>
            <Link href="/dlsite/female/doujin/new"><NavIcon>◉</NavIcon>新着</Link>
            <Link href="/dlsite/female/doujin/sale"><NavIcon>◇</NavIcon>セール</Link>
            <Link href="/dlsite/female/doujin/circle"><NavIcon>♧</NavIcon>サークル</Link>
            <Link href="/dlsite/female/doujin"><NavIcon>⌘</NavIcon>ジャンル</Link>
            <Link href="/dlsite/female/doujin"><NavIcon>♡</NavIcon>お気に入り</Link>
          </nav>

          <div className="headerSwitches">
            <ToggleGroup
              ariaLabel="プラットフォーム切り替え"
              value={platform}
              onChange={setPlatform}
              options={[{ value: "dlsite", label: "DLsite" }, { value: "fanza", label: "FANZA" }]}
            />
            <ToggleGroup
              ariaLabel="対象切り替え"
              value={audience}
              onChange={setAudience}
              options={[{ value: "female", label: "女性向け" }, { value: "general", label: "総合" }]}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
