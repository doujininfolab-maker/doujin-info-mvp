import Link from "next/link";
import { LogoIcon } from "@/components/icons/SiteIcons";

const footerGroups = [
  { title: "ご利用ガイド", links: ["使い方", "よくある質問", "お問い合わせ"] },
  { title: "サービスについて", links: ["運営について", "プライバシーポリシー", "利用規約"] },
  { title: "外部リンク", links: ["DLsite", "FANZA", "Ci-en"] },
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
            {group.links.map((link) => <a key={link} href="#">{link}</a>)}
          </div>
        ))}
        <div className="footerSocial">
          <h3>公式SNS</h3>
          <div><a href="#">𝕏</a><a href="#">◎</a><a href="#">✉</a></div>
        </div>
      </div>
      <small className="copyright">© 2024 Doujin Info</small>
    </footer>
  );
}
