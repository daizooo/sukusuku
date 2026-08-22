import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "すくすく手帳",
  description: "夫婦で育児タスク・記録・スケジュールを共有するWebアプリ",
  appleWebApp: {
    title: "すくすく手帳",
  },
};

// viewport-fit: 'cover' でノッチ/ホームインジケーターのある端末でも画面いっぱいに
// 描画し、env(safe-area-inset-*) を使ってヘッダー・下部ナビが機種ごとの安全領域に
// ぴったり収まるようにする。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#CE6B74",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // h-svh(小さい方のビューポート高さ)にしているのは、スマホのブラウザで
    // アドレスバーが出ている状態でもドキュメント全体が画面に収まるようにするため。
    // h-full(=100%)だとアドレスバーが隠れている前提の高さになるので、更新直後の
    // ようにアドレスバーが出ているときはその分だけページがはみ出し、
    // 下のタブバーを見るのに画面をスクロールしなければならなくなる。
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-svh antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
