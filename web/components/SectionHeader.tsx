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
  const titleContent = (
    <>
      {icon ? <span className="sectionHeader__icon">{icon}</span> : null}{title}
    </>
  );

  return (
    <div className="sectionHeader">
      <div>
        <h2>
          {href ? <Link className="sectionHeader__titleLink" href={href}>{titleContent}</Link> : titleContent}
        </h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="sectionHeader__aside">
        {children}
        {href ? <Link href={href}>もっと見る 〉</Link> : null}
      </div>
    </div>
  );
}
