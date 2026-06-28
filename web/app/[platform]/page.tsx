import { notFound, redirect } from "next/navigation";
import { DEFAULT_SEGMENT, isPlatform } from "@/lib/siteSegments";

export default async function PlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  if (!isPlatform(platform)) notFound();

  if (platform === DEFAULT_SEGMENT.platform) {
    redirect(DEFAULT_SEGMENT.path);
  }

  notFound();
}
