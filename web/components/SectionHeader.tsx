import Link from "next/link";

export function SectionHeader({ title, description, href }: { title: string; description?: string; href?: string }) {
  return (
    <div className="sectionHeader">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {href ? <Link href={href}>もっと見る</Link> : null}
    </div>
  );
}
