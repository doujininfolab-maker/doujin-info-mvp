import { notFound, redirect } from "next/navigation";
import { SITE_SEGMENTS, isAudience, isPlatform } from "@/lib/siteSegments";

export default async function AudiencePage({ params }: { params: Promise<{ platform: string; audience: string }> }) {
  const { platform, audience } = await params;
  if (!isPlatform(platform) || !isAudience(audience)) notFound();

  const segment = SITE_SEGMENTS.find((item) => item.platform === platform && item.audience === audience && item.enabled);
  if (segment) redirect(segment.path);

  notFound();
}
