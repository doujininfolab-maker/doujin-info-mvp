import type { Metadata } from "next";
import "./globals.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";

export const metadata: Metadata = {
  title: {
    default: "同人インフォMVP",
    template: "%s | 同人インフォMVP",
  },
  description: "DLsite・FANZAなど複数プラットフォームへ横展開できる同人情報サイトMVPです。",
  openGraph: {
    title: "同人インフォMVP",
    description: "ランキング・新着・セールから作品を探せる情報サイトMVPです。",
    type: "website",
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
