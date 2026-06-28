import Link from "next/link";
import type { SiteSegment } from "@/lib/types";

export function SegmentNav({ segment }: { segment: SiteSegment }) {
  const items = [
    { label: "TOP", href: segment.path, icon: "⌂" },
    { label: "ランキング", href: `${segment.path}/ranking`, icon: "♕" },
    { label: "新着", href: `${segment.path}/new`, icon: "◉" },
    { label: "セール", href: `${segment.path}/sale`, icon: "◇" },
    { label: "TL", href: `${segment.path}/genre/dlsite:tl`, icon: "♟" },
    { label: "ASMR", href: `${segment.path}/genre/dlsite:asmr`, icon: "◐" },
  ];

  return (
    <nav className="segmentNav" aria-label="カテゴリナビゲーション">
      {items.map((item) => <Link key={item.href} href={item.href}>{item.icon} {item.label}</Link>)}
    </nav>
  );
}
