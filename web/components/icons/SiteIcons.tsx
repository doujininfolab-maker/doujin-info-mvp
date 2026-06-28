export type IconTone = "pink" | "purple" | "orange" | "blue" | "gold" | "muted";

const toneClass: Record<IconTone, string> = {
  pink: "iconTone--pink",
  purple: "iconTone--purple",
  orange: "iconTone--orange",
  blue: "iconTone--blue",
  gold: "iconTone--gold",
  muted: "iconTone--muted",
};

export function IconShell({
  children,
  tone = "pink",
  className = "",
}: {
  children: React.ReactNode;
  tone?: IconTone;
  className?: string;
}) {
  return <span className={`iconShell ${toneClass[tone]} ${className}`}>{children}</span>;
}

export function LogoIcon() {
  return (
    <span className="logoIcon" aria-hidden="true">
      <span className="logoIcon__page logoIcon__page--left" />
      <span className="logoIcon__page logoIcon__page--right" />
      <span className="logoIcon__heart">♥</span>
    </span>
  );
}

export function SearchIcon() {
  return <span aria-hidden="true">⌕</span>;
}

export function CrownIcon({ rank }: { rank?: number }) {
  const tone = rank === 1 ? "gold" : rank === 2 ? "muted" : rank === 3 ? "orange" : "purple";
  return (
    <span className={`rankIcon rankIcon--${tone}`} aria-hidden="true">
      {rank && rank <= 3 ? "♛" : rank ?? ""}
    </span>
  );
}

export function NavIcon({ children }: { children: React.ReactNode }) {
  return <span className="navIcon" aria-hidden="true">{children}</span>;
}

export function StatIcon({ tone = "pink", children }: { tone?: IconTone; children: React.ReactNode }) {
  return <IconShell tone={tone}>{children}</IconShell>;
}

export function GenreIcon({ tone = "purple", children }: { tone?: IconTone; children: React.ReactNode }) {
  return <IconShell tone={tone} className="genreIcon">{children}</IconShell>;
}
