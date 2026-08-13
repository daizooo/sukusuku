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
};

// viewport-fit: 'cover' でノッチ/ホームインジケーターのある端末でも画面いっぱいに
// 描画し、env(safe-area-inset-*) を使ってヘッダー・下部ナビが機種ごとの安全領域に
// ぴったり収まるようにする。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ja"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
