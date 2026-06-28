import Link from "next/link";
import { getEnabledSegments, SITE_SEGMENTS } from "@/lib/siteSegments";

export function Header() {
  const enabledSegments = getEnabledSegments();
  const disabledCount = SITE_SEGMENTS.filter((segment) => !segment.enabled).length;

  return (
    <header className="siteHeader">
      <div className="siteHeader__inner">
        <Link className="siteHeader__logo" href="/">
          同人インフォMVP
        </Link>
        <nav className="siteHeader__nav" aria-label="主要ナビゲーション">
          {enabledSegments.map((segment) => (
            <Link key={segment.key} href={segment.path}>
              {segment.shortLabel}
            </Link>
          ))}
          <span className="siteHeader__soon">横展開予定 {disabledCount}</span>
        </nav>
      </div>
    </header>
  );
}
