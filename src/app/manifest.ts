import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "すくすく手帳",
    short_name: "すくすく手帳",
    description: "夫婦で育児タスク・記録・スケジュールを共有するWebアプリ",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#CE6B74",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
      },
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Android/ChromeはmaskableアイコンをOS側のアダプティブアイコン形状(円・角丸四角など)で
        // 直接切り抜いて表示する。maskable指定がないと「安全領域」に収まるよう縮小した上で
        // 白背景を敷いた状態で表示されてしまう(ホーム画面追加時に背景色が消え、アイコンだけが
        // 小さく浮いて見える不具合の原因だった)。デザイン自体は/icons/icon-*.pngと同じ
        // フルブリードの絵柄なのでそのまま流用する。
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
