import type { MetadataRoute } from "next";
import { getAbsoluteSiteUrl, getSiteUrl } from "@/lib/siteUrl";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/search"],
    },
    sitemap: getAbsoluteSiteUrl("/sitemap.xml"),
    host: getSiteUrl().origin,
  };
}
