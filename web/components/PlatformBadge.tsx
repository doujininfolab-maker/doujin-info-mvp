import type { Audience, Category, Platform } from "@/lib/types";

const platformLabels: Record<Platform, string> = {
  dlsite: "DLsite",
  fanza: "FANZA",
};

const audienceLabels: Record<Audience, string> = {
  female: "女性向け",
  male: "男性向け",
  general: "全年齢・一般",
  adult: "成人向け",
};

const categoryLabels: Record<Category, string> = {
  doujin: "同人",
  voice: "音声",
  comic: "コミック",
  game: "ゲーム",
  video: "動画",
  ebook: "電子書籍",
};

export function PlatformBadge({ platform, audience, category }: { platform: Platform; audience: Audience; category: Category }) {
  return (
    <div className="badgeRow">
      <span className="softBadge">{platformLabels[platform]}</span>
      <span className="softBadge">{audienceLabels[audience]}</span>
      <span className="softBadge">{categoryLabels[category]}</span>
    </div>
  );
}
