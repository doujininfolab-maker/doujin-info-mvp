import type { MetadataRoute } from "next";
import { DEFAULT_SEGMENT } from "@/lib/siteSegments";
import { getAbsoluteSiteUrl } from "@/lib/siteUrl";

const CORE_ROUTES: ReadonlyArray<{
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;
  priority: number;
}> = [
  { path: "/", changeFrequency: "daily", priority: 1 },
  { path: `${DEFAULT_SEGMENT.path}/ranking`, changeFrequency: "daily", priority: 0.9 },
  { path: `${DEFAULT_SEGMENT.path}/new`, changeFrequency: "daily", priority: 0.9 },
  { path: `${DEFAULT_SEGMENT.path}/sale`, changeFrequency: "daily", priority: 0.9 },
  { path: `${DEFAULT_SEGMENT.path}/genre`, changeFrequency: "daily", priority: 0.8 },
  { path: `${DEFAULT_SEGMENT.path}/circle`, changeFrequency: "daily", priority: 0.8 },
  { path: "/guide", changeFrequency: "monthly", priority: 0.5 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.5 },
  { path: "/about", changeFrequency: "monthly", priority: 0.4 },
  { path: "/contact", changeFrequency: "monthly", priority: 0.4 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", changeFrequency: "yearly", priority: 0.3 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return CORE_ROUTES.map((route) => ({
    url: getAbsoluteSiteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
