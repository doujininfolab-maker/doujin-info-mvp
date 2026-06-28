import type { Audience, Category, Platform, SiteSegment } from "./types";

export const SITE_SEGMENTS: SiteSegment[] = [
  {
    key: "dlsite_female_doujin",
    label: "DLsite 女性向け同人",
    shortLabel: "女性向け",
    platform: "dlsite",
    audience: "female",
    category: "doujin",
    path: "/dlsite/female/doujin",
    enabled: true,
    description: "DLsiteの女性向け同人作品をランキング・新着・セールから探せるMVPです。",
  },
  {
    key: "dlsite_male_doujin",
    label: "DLsite 男性向け同人",
    shortLabel: "男性向け",
    platform: "dlsite",
    audience: "male",
    category: "doujin",
    path: "/dlsite/male/doujin",
    enabled: false,
    description: "将来追加予定のDLsite男性向け同人セグメントです。",
  },
  {
    key: "dlsite_general_game",
    label: "DLsite 全年齢・一般ゲーム",
    shortLabel: "一般ゲーム",
    platform: "dlsite",
    audience: "general",
    category: "game",
    path: "/dlsite/general/game",
    enabled: false,
    description: "将来追加予定のDLsite一般向けゲームセグメントです。",
  },
  {
    key: "fanza_adult_video",
    label: "FANZA動画",
    shortLabel: "FANZA動画",
    platform: "fanza",
    audience: "adult",
    category: "video",
    path: "/fanza/adult/video",
    enabled: false,
    description: "将来追加予定のFANZA動画セグメントです。",
  },
  {
    key: "fanza_adult_ebook",
    label: "FANZA電子書籍",
    shortLabel: "FANZA電子書籍",
    platform: "fanza",
    audience: "adult",
    category: "ebook",
    path: "/fanza/adult/ebook",
    enabled: false,
    description: "将来追加予定のFANZA電子書籍セグメントです。",
  },
  {
    key: "fanza_adult_doujin",
    label: "FANZA同人",
    shortLabel: "FANZA同人",
    platform: "fanza",
    audience: "adult",
    category: "doujin",
    path: "/fanza/adult/doujin",
    enabled: false,
    description: "将来追加予定のFANZA同人セグメントです。",
  },
];

export const DEFAULT_SEGMENT = SITE_SEGMENTS[0];

export function isPlatform(value: string): value is Platform {
  return value === "dlsite" || value === "fanza";
}

export function isAudience(value: string): value is Audience {
  return value === "female" || value === "male" || value === "general" || value === "adult";
}

export function isCategory(value: string): value is Category {
  return ["doujin", "voice", "comic", "game", "video", "ebook"].includes(value);
}

export function getSegment(platform: string, audience: string, category: string): SiteSegment | undefined {
  if (!isPlatform(platform) || !isAudience(audience) || !isCategory(category)) {
    return undefined;
  }

  return SITE_SEGMENTS.find(
    (segment) => segment.platform === platform && segment.audience === audience && segment.category === category,
  );
}

export function getEnabledSegments(): SiteSegment[] {
  return SITE_SEGMENTS.filter((segment) => segment.enabled);
}

export function getSegmentLabel(platform: Platform, audience: Audience, category: Category): string {
  return getSegment(platform, audience, category)?.label ?? `${platform}/${audience}/${category}`;
}

export function getSegmentPath(platform: Platform, audience: Audience, category: Category): string {
  return `/${platform}/${audience}/${category}`;
}
