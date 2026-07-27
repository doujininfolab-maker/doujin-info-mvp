import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { getSiteUrl } from "@/lib/siteUrl";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: getSiteUrl(),
  applicationName: "Doujin Info",
  title: {
    default: "Doujin Info｜DLsite女性向け同人情報",
    template: "%s | Doujin Info",
  },
  description: "DLsiteのTL・BL同人作品を、ランキング、新着、セール、ジャンル、サークルから探せる情報サイトです。",
  openGraph: {
    title: "Doujin Info｜DLsite女性向け同人情報",
    description: "DLsiteのTL・BL同人作品を、ランキング、新着、セール、ジャンル、サークルから探せる情報サイトです。",
    type: "website",
    siteName: "Doujin Info",
    locale: "ja_JP",
  },
  twitter: {
    card: "summary_large_image",
    title: "Doujin Info｜DLsite女性向け同人情報",
    description: "DLsiteのTL・BL同人作品を探せる情報サイトです。",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <Header />
        <main className="pageContainer">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
