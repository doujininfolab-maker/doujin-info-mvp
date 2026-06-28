import Link from "next/link";
import type { SiteSegment } from "@/lib/types";
import { getSegmentPath } from "@/lib/siteSegments";

export function SegmentNav({ segment }: { segment: SiteSegment }) {
  const basePath = getSegmentPath(segment.platform, segment.audience, segment.category);

  return (
    <nav className="segmentNav" aria-label="セグメントナビゲーション">
      <Link href={basePath}>TOP</Link>
      <Link href={`${basePath}/ranking`}>ランキング</Link>
      <Link href={`${basePath}/new`}>新着</Link>
      <Link href={`${basePath}/sale`}>セール</Link>
      <Link href={`${basePath}/genre/dlsite:tl`}>TL</Link>
      <Link href={`${basePath}/genre/dlsite:asmr`}>ASMR</Link>
    </nav>
  );
}
