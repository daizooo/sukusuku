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
  title: "かぞく手帳",
  description: "家族の予定・リスト・育児をまとめて管理するアプリ",
  appleWebApp: {
    title: "かぞく手帳",
  },
};

// viewport-fit: 'cover' でノッチ/ホームインジケーターのある端末でも画面いっぱいに
// 描画し、env(safe-area-inset-*) を使ってヘッダー・下部ナビが機種ごとの安全領域に
// ぴったり収まるようにする。
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
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
