const LOCAL_SITE_URL = "http://localhost:3000";

export function getSiteUrl(): URL {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();

  if (configuredUrl) {
    try {
      const parsed = new URL(configuredUrl);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        return new URL(parsed.origin);
      }
    } catch {
      // Invalid configuration falls back to the local development URL.
    }
  }

  return new URL(LOCAL_SITE_URL);
}

export function getAbsoluteSiteUrl(path = "/"): string {
  return new URL(path, getSiteUrl()).toString();
}
