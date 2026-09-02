import { NextResponse } from "next/server";
import { getSellerSummaryByKey, getSellerTrendPoints } from "@/lib/firebase/products";
import { getSegment } from "@/lib/siteSegments";

export const dynamic = "force-dynamic";

function parseDays(request: Request): number {
  const raw = new URL(request.url).searchParams.get("days");
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(365, Math.floor(parsed)))
    : 30;
}

type RouteContext = {
  params: Promise<{
    platform: string;
    audience: string;
    category: string;
    sellerKey: string;
  }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { platform, audience, category, sellerKey } = await params;
  const segment = getSegment(platform, audience, category);
  if (!segment?.enabled) {
    return NextResponse.json({ message: "segment not found" }, { status: 404 });
  }

  const normalizedSellerKey = sellerKey.trim();
  if (!normalizedSellerKey) {
    return NextResponse.json({ message: "sellerKey is required" }, { status: 400 });
  }

  const contentTypeParam = new URL(request.url).searchParams.get("contentType");
  const contentType: "tl" | "bl" | undefined = contentTypeParam === "tl" || contentTypeParam === "bl"
    ? contentTypeParam
    : undefined;

  const sellerFilter = {
    platform: segment.platform,
    audience: segment.audience,
    category: segment.category,
    sellerKey: normalizedSellerKey,
    contentType,
  };
  const summary = await getSellerSummaryByKey(sellerFilter);
  if (!summary) {
    return NextResponse.json(
      { message: "seller not found" },
      { status: 404, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const points = await getSellerTrendPoints(sellerFilter, parseDays(request));

  return NextResponse.json(
    { points },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, must-revalidate",
      },
    },
  );
}
