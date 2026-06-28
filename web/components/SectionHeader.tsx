import Link from "next/link";

export function SectionHeader({
  title,
  description,
  href,
  icon,
  children,
}: {
  title: string;
  description?: string;
  href?: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="sectionHeader">
      <div>
        <h2>{icon ? <span className="sectionHeader__icon">{icon}</span> : null}{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="sectionHeader__aside">
        {children}
        {href ? <Link href={href}>もっと見る 〉</Link> : null}
      </div>
    </div>
  );
}
