import { NextResponse } from "next/server";
import { getProductTrendPoints } from "@/lib/firebase/products";

export const dynamic = "force-dynamic";

function parseDays(request: Request): number {
  const raw = new URL(request.url).searchParams.get("days");
  const parsed = Number(raw);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(365, Math.floor(parsed)))
    : 30;
}

type RouteContext = {
  params: Promise<{ productId: string }>;
};

export async function GET(request: Request, { params }: RouteContext) {
  const { productId } = await params;
  const normalizedProductId = decodeURIComponent(productId).trim();
  if (!normalizedProductId) {
    return NextResponse.json({ message: "productId is required" }, { status: 400 });
  }

  const points = await getProductTrendPoints(normalizedProductId, parseDays(request));
  return NextResponse.json(
    { points },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
