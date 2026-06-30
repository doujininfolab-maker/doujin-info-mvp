import Link from "next/link";
import { LogoIcon } from "@/components/icons/SiteIcons";

type FooterLink = { label: string; href: string; external?: boolean };

type FooterGroup = { title: string; links: FooterLink[] };

const footerGroups: FooterGroup[] = [
  {
    title: "ご利用ガイド",
    links: [
      { label: "使い方", href: "/guide" },
      { label: "よくある質問", href: "/faq" },
      { label: "お問い合わせ", href: "/contact" },
    ],
  },
  {
    title: "サービスについて",
    links: [
      { label: "運営について", href: "/about" },
      { label: "プライバシーポリシー", href: "/privacy" },
      { label: "利用規約", href: "/terms" },
    ],
  },
  {
    title: "外部リンク",
    links: [
      { label: "DLsite", href: "https://www.dlsite.com/girls/", external: true },
      { label: "FANZA", href: "https://www.dmm.co.jp/dc/doujin/", external: true },
      { label: "Ci-en", href: "https://ci-en.dlsite.com/", external: true },
    ],
  },
];

export function Footer() {
  return (
    <footer className="siteFooter">
      <div className="siteFooter__inner">
        <div className="footerBrand">
          <Link className="brand" href="/">
            <LogoIcon />
            <span className="brand__text"><strong>Doujin Info</strong><small>同人インフォ</small></span>
          </Link>
          <p>女性向け同人作品の情報を、データで分かりやすく。あなたの“好き”をもっと見つけやすく。</p>
        </div>
        {footerGroups.map((group) => (
          <div className="footerLinks" key={group.title}>
            <h3>{group.title}</h3>
            {group.links.map((link) => (
              link.external ? (
                <a key={link.label} href={link.href} target="_blank" rel="noreferrer">{link.label}</a>
              ) : (
                <Link key={link.label} href={link.href}>{link.label}</Link>
              )
            ))}
          </div>
        ))}
        <div className="footerSocial">
          <h3>公式SNS</h3>
          <div aria-label="公式SNSは準備中です">
            <span className="footerSocial__placeholder">𝕏</span>
            <span className="footerSocial__placeholder">◎</span>
            <span className="footerSocial__placeholder">✉</span>
          </div>
          <small>準備中</small>
        </div>
      </div>
      <small className="copyright">© 2024 Doujin Info</small>
    </footer>
  );
}
