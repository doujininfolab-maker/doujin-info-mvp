export function RankingBadge({ rank }: { rank?: number }) {
  if (!rank) return null;
  return <span className="rankingBadge">#{rank}</span>;
}
