export type IconTone = "pink" | "purple" | "orange" | "blue" | "gold" | "muted";

const toneClass: Record<IconTone, string> = {
  pink: "iconTone--pink",
  purple: "iconTone--purple",
  orange: "iconTone--orange",
  blue: "iconTone--blue",
  gold: "iconTone--gold",
  muted: "iconTone--muted",
};

function SvgIcon({ children, viewBox = "0 0 24 24" }: { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

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
  return (
    <SvgIcon>
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.9" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </SvgIcon>
  );
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

export function RankingNavIcon() {
  return (
    <NavIcon>
      <SvgIcon>
        <path d="M5 18h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M7 18V9m10 9V9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M5 6l3 2.4L12 4l4 4.4L19 6v3.2c0 3.3-2.7 5.9-6 5.9S7 12.5 7 9.2V6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </SvgIcon>
    </NavIcon>
  );
}

export function NewNavIcon() {
  return (
    <NavIcon>
      <SvgIcon>
        <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      </SvgIcon>
    </NavIcon>
  );
}

export function SaleNavIcon() {
  return (
    <NavIcon>
      <SvgIcon>
        <path d="M11 4.5H7.9c-.6 0-1.2.24-1.62.67L3.7 7.75a2.3 2.3 0 0 0 0 3.25l5.3 5.3a2.3 2.3 0 0 0 3.25 0l6.08-6.08a1.8 1.8 0 0 0 0-2.55l-5.3-5.3A2.28 2.28 0 0 0 11 4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
      </SvgIcon>
    </NavIcon>
  );
}

export function CircleNavIcon() {
  return (
    <NavIcon>
      <SvgIcon>
        <circle cx="9" cy="8.2" r="2.6" stroke="currentColor" strokeWidth="1.8" />
        <path d="M4.7 17.3c.55-2.55 2.4-4.1 4.3-4.1 1.9 0 3.75 1.55 4.3 4.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="16.9" cy="9.4" r="2.1" stroke="currentColor" strokeWidth="1.8" />
        <path d="M14.7 17.2c.32-1.66 1.58-2.75 2.98-2.75 1.4 0 2.66 1.1 2.98 2.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </SvgIcon>
    </NavIcon>
  );
}

export function GenreNavIcon() {
  return (
    <NavIcon>
      <SvgIcon>
        <rect x="4" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="14" y="4" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
        <rect x="14" y="14" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.8" />
      </SvgIcon>
    </NavIcon>
  );
}


export function NewSectionIcon() {
  return <span className="newLabelIcon">NEW</span>;
}

export function SaleSectionIcon() {
  return (
    <SvgIcon>
      <path d="M11 4.5H7.9c-.6 0-1.2.24-1.62.67L3.7 7.75a2.3 2.3 0 0 0 0 3.25l5.3 5.3a2.3 2.3 0 0 0 3.25 0l6.08-6.08a1.8 1.8 0 0 0 0-2.55l-5.3-5.3A2.28 2.28 0 0 0 11 4.5Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
    </SvgIcon>
  );
}

export function CircleHighlightSectionIcon() {
  return (
    <SvgIcon viewBox="0 0 24 24">
      <path d="M8.9 19.2c-.85-.68-1.8-1.75-2.2-2.95-.31-.93-.16-1.9.5-2.45.57-.48 1.35-.53 2.06-.23V8.9c0-.96.7-1.72 1.6-1.72.89 0 1.6.76 1.6 1.72v2.1c.26-.18.58-.28.92-.28.67 0 1.24.37 1.53.92.27-.13.57-.21.9-.21.86 0 1.56.57 1.78 1.37.2-.08.42-.12.65-.12 1 0 1.82.84 1.82 1.88v1.26c0 2.48-1.64 4.5-3.9 4.5h-4.17c-1.18 0-2.33-.41-3.09-1.12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"/>
      <path d="M12.4 11v3.05M14.86 11.5v2.55M17.16 12.2v2.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
    </SvgIcon>
  );
}

export function ProductCountStatIcon() {
  return (
    <SvgIcon>
      <rect x="5" y="5" width="11" height="14" rx="2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8.2 9h4.6M8.2 12h4.6M8.2 15h3.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 8h1.4c.9 0 1.6.7 1.6 1.6V18" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </SvgIcon>
  );
}

export function TodayUpdateStatIcon() {
  return (
    <SvgIcon>
      <rect x="4.8" y="6.2" width="14.4" height="12.4" rx="2.2" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8.2 4.5v3.2M15.8 4.5v3.2M5.4 10.2h13.2" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M12 12.2l.62 1.6 1.58.6-1.58.62L12 16.6l-.62-1.58-1.58-.62 1.58-.6L12 12.2Z" fill="currentColor" />
    </SvgIcon>
  );
}

export function SaleCountStatIcon() {
  return (
    <SvgIcon>
      <path d="M11 4.5H7.9c-.6 0-1.2.24-1.62.67L3.7 7.75a2.3 2.3 0 0 0 0 3.25l5.3 5.3a2.3 2.3 0 0 0 3.25 0l6.08-6.08a1.8 1.8 0 0 0 0-2.55l-5.3-5.3A2.28 2.28 0 0 0 11 4.5Z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <circle cx="8.5" cy="8.5" r="1" fill="currentColor" />
    </SvgIcon>
  );
}

export function FeaturedGenreStatIcon() {
  return (
    <SvgIcon>
      <rect x="4.5" y="4.5" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
      <rect x="13.2" y="4.5" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
      <rect x="4.5" y="13.2" width="6.3" height="6.3" rx="1.6" stroke="currentColor" strokeWidth="1.9" />
      <path d="M16.3 13l.72 1.85 1.83.7-1.83.72-.72 1.83-.72-1.83-1.83-.72 1.83-.7L16.3 13Z" fill="currentColor" />
    </SvgIcon>
  );
}


export function StatIcon({ tone = "pink", children }: { tone?: IconTone; children: React.ReactNode }) {
  return <IconShell tone={tone}>{children}</IconShell>;
}

export function GenreIcon({ tone = "purple", children }: { tone?: IconTone; children: React.ReactNode }) {
  return <IconShell tone={tone} className="genreIcon">{children}</IconShell>;
}

export function PeopleCategoryIcon() {
  return (
    <SvgIcon>
      <circle cx="9" cy="8.4" r="2.5" fill="currentColor" opacity="0.95" />
      <circle cx="15.4" cy="8.7" r="2.35" fill="currentColor" opacity="0.72" />
      <path d="M5.5 17.1c.5-2.32 2.2-3.75 3.96-3.75 1.74 0 3.45 1.43 3.95 3.75" fill="currentColor" opacity="0.95" />
      <path d="M12.3 17.1c.28-1.56 1.45-2.57 2.76-2.57 1.3 0 2.48 1 2.76 2.57" fill="currentColor" opacity="0.72" />
    </SvgIcon>
  );
}

export function FemaleCategoryIcon() {
  return (
    <SvgIcon>
      <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.9" />
      <path d="M12 12.1v6.6M9.2 15.9h5.6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </SvgIcon>
  );
}

export function MangaCategoryIcon() {
  return (
    <SvgIcon>
      <path d="M6.2 5.2h6.4c1.5 0 2.7.9 3.2 2V18c-.5-.5-1.3-.8-2.2-.8H7.6c-.52 0-1 .1-1.4.3V6.2c0-.55.45-1 1-1Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M15.8 7.2h1.5a1 1 0 0 1 1 1v9.5c-.4-.33-.98-.5-1.65-.5h-.8" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M8.8 9.2h4.4M8.8 12h4.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </SvgIcon>
  );
}

export function AudioCategoryIcon() {
  return (
    <SvgIcon>
      <path d="M7.3 12.7V11a4.7 4.7 0 0 1 9.4 0v1.7" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <rect x="5" y="11.8" width="3.1" height="6.2" rx="1.5" fill="currentColor" />
      <rect x="15.9" y="11.8" width="3.1" height="6.2" rx="1.5" fill="currentColor" />
      <path d="M12 17.8v1.2c0 .55-.45 1-1 1h-1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </SvgIcon>
  );
}

export function GameCategoryIcon() {
  return (
    <SvgIcon>
      <path d="M8.6 8.2h6.8c1.85 0 3.36 1.48 3.4 3.33l.13 1.86c.1 1.58-.92 3.01-2.45 3.42-1.1.3-2.26-.04-3.03-.88l-1.02-1.12a.65.65 0 0 0-.96 0l-1.02 1.12c-.77.84-1.93 1.18-3.03.88A2.84 2.84 0 0 1 5 13.41l.13-1.86A3.42 3.42 0 0 1 8.6 8.2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M9 11.7v3M7.5 13.2h3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="15.7" cy="12.2" r=".95" fill="currentColor" />
      <circle cx="17.4" cy="14" r=".95" fill="currentColor" />
    </SvgIcon>
  );
}

export function CgCategoryIcon() {
  return (
    <SvgIcon>
      <rect x="4.5" y="6" width="15" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="9" cy="10" r="1.2" fill="currentColor" />
      <path d="M6.8 16l3.6-3.7 2.6 2.4 2.2-1.8 2 3.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </SvgIcon>
  );
}

export function MovieCategoryIcon() {
  return (
    <SvgIcon>
      <rect x="4.7" y="6.2" width="14.6" height="11.6" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M10.5 10.1l4.2 2.05-4.2 2.05V10.1Z" fill="currentColor" />
    </SvgIcon>
  );
}

export function OtherCategoryIcon() {
  return (
    <SvgIcon>
      <rect x="5" y="5" width="5.5" height="5.5" rx="1.3" fill="currentColor" opacity="0.95" />
      <rect x="13.5" y="5" width="5.5" height="5.5" rx="1.3" fill="currentColor" opacity="0.75" />
      <rect x="5" y="13.5" width="5.5" height="5.5" rx="1.3" fill="currentColor" opacity="0.75" />
      <rect x="13.5" y="13.5" width="5.5" height="5.5" rx="1.3" fill="currentColor" opacity="0.95" />
    </SvgIcon>
  );
}
