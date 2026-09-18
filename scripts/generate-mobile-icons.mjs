// mobile/assets/ のアイコンを、PWA版のアイコン(src/app/icon.svg)と同じ絵柄で作り直す。
//
// ネイティブ版の画面はPWA版に準拠する（ルートの CLAUDE.md）。アイコンも同じで、
// Expoのテンプレートに入っていた既定のアイコンのままにしない。
// 絵柄をここに持っているのは、src/app/icon.svg を読むためにSVGの描画系を足したくないため。
// icon.svg 側を直したときは、ここの FEET / SHAPES / 色も合わせて直す。
//
//   node scripts/generate-mobile-icons.mjs
//
// 出来上がるもの（すべて mobile/assets/）:
//   icon.png                     … アプリのアイコン（背景ごと。PWAのicon-512.pngと同じ絵）
//   android-icon-background.png  … アダプティブアイコンの背景（地の色だけ）
//   android-icon-foreground.png  … 同じく前景（足あとだけ。OSに切り抜かれる分を見込んで小さめ）
//   android-icon-monochrome.png  … テーマアイコン用の単色版
//   notification-icon.png        … お知らせの小さいアイコン（白抜き。色はOSが付ける）
//   splash-icon.png              … 起動画面用（地は透明）

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'mobile', 'assets');

// --- 絵柄（src/app/icon.svg の viewBox 0 0 200 200 に合わせてある） ---

/** 地の色。PWAのmanifestの theme_color と同じ。 */
const BRAND = [0xce, 0x6b, 0x74];
/** 足あとの色。 */
const FOOT = [0xff, 0xf6, 0xf1];

/** 足あと2つの置き方。icon.svg の <g transform> と同じ。 */
const FEET = [
  { x: 69, y: 98, rotation: -12, scale: 1.2 },
  { x: 119, y: 136, rotation: 10, scale: 1.2 },
];

/** 足あと1つ分の形。土踏まずの楕円と、指4つ。 */
const SHAPES = [
  { cx: 0, cy: 0, rx: 21, ry: 30 },
  { cx: -16, cy: -36, rx: 7, ry: 7 },
  { cx: -2, cy: -42, rx: 7.5, ry: 7.5 },
  { cx: 13, cy: -40, rx: 7, ry: 7 },
  { cx: 25, cy: -32, rx: 6, ry: 6 },
];

/** viewBox 内の点が足あとの上にあるか。 */
const isOnFoot = (x, y) =>
  FEET.some((foot) => {
    const theta = (foot.rotation * Math.PI) / 180;
    const dx = x - foot.x;
    const dy = y - foot.y;
    // 置いた向き・大きさを戻して、元の形の座標で見る。
    const u = (dx * Math.cos(theta) + dy * Math.sin(theta)) / foot.scale;
    const v = (-dx * Math.sin(theta) + dy * Math.cos(theta)) / foot.scale;
    return SHAPES.some(
      (s) => ((u - s.cx) / s.rx) ** 2 + ((v - s.cy) / s.ry) ** 2 <= 1,
    );
  });

/** 足あとが実際に占めている範囲。前景を安全域に収めるために要る。 */
const footBounds = () => {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let y = 0; y < 200; y += 0.25) {
    for (let x = 0; x < 200; x += 0.25) {
      if (!isOnFoot(x, y)) continue;
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return bounds;
};

// --- 描く ---

/** 1画素あたりの見本の数（縦横それぞれ）。縁のがたつきを消すため。 */
const SAMPLES = 4;

/**
 * 1枚描いてRGBAのバイト列を返す。
 *
 * @param size      出来上がりの一辺(px)
 * @param background 地の色。null なら透明
 * @param foot      足あとの色。null なら足あとを描かない
 * @param safe      足あとを画の中心に置き、その長辺を一辺の何割にするか。
 *                  渡さなければ viewBox ごと目一杯に描く（PWA版と同じ絵）。
 */
const render = ({ size, background, foot, safe }) => {
  const pixels = Buffer.alloc(size * size * 4);
  const bounds = safe ? footBounds() : null;
  // safe を渡したときは、足あとの長辺が safe の割合になるところまで縮める。
  const fit = bounds
    ? (safe * 200) / Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
    : 1;
  const scale = (size * fit) / 200;
  // viewBox のどの点を画の中心に置くか。
  const originX = bounds ? (bounds.minX + bounds.maxX) / 2 : 100;
  const originY = bounds ? (bounds.minY + bounds.maxY) / 2 : 100;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let covered = 0;
      let inside = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const cx = px + (sx + 0.5) / SAMPLES;
          const cy = py + (sy + 0.5) / SAMPLES;
          const x = (cx - size / 2) / scale + originX;
          const y = (cy - size / 2) / scale + originY;
          if (x >= 0 && x < 200 && y >= 0 && y < 200) inside++;
          if (foot && isOnFoot(x, y)) covered++;
        }
      }
      const total = SAMPLES * SAMPLES;
      const footAlpha = covered / total;
      const backgroundAlpha = background ? inside / total : 0;
      // 足あとを地の上に重ねる。
      const alpha = footAlpha + backgroundAlpha * (1 - footAlpha);
      const at = (py * size + px) * 4;
      if (alpha > 0) {
        for (let c = 0; c < 3; c++) {
          const over = foot ? foot[c] * footAlpha : 0;
          const under = background ? background[c] * backgroundAlpha * (1 - footAlpha) : 0;
          pixels[at + c] = Math.round((over + under) / alpha);
        }
      }
      pixels[at + 3] = Math.round(alpha * 255);
    }
  }
  return pixels;
};

// --- PNGにする ---

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

const crc32 = (buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

const toPng = (pixels, size) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // 1色8bit
  header[9] = 6; // RGBA
  // 行ごとに先頭へフィルタの種類(0 = なし)を足す。
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

// --- 書き出す ---

/**
 * アダプティブアイコンの前景で、足あとを一辺の何割にするか。
 * 108dpの下地のうち、どの形に切り抜かれても残るのは中央の66dpぶんなので、
 * そこ（0.61）に収まる大きさにしておく。
 */
const ADAPTIVE_SAFE = 0.6;

const OUTPUTS = [
  // アプリのアイコン。PWAの /icons/icon-512.png と同じ絵柄。
  { file: 'icon.png', size: 1024, background: BRAND, foot: FOOT },
  { file: 'android-icon-background.png', size: 512, background: BRAND, foot: null },
  {
    file: 'android-icon-foreground.png',
    size: 512,
    background: null,
    foot: FOOT,
    safe: ADAPTIVE_SAFE,
  },
  // テーマアイコン。OS側で塗り直されるので、形（透明でないところ）だけが要る。
  {
    file: 'android-icon-monochrome.png',
    size: 432,
    background: null,
    foot: [0xff, 0xff, 0xff],
    safe: ADAPTIVE_SAFE,
  },
  // お知らせの小さいアイコン。Androidは形だけを見て色を付け直すので、白抜きで渡す。
  // 渡さないとアプリのアイコンがそのまま潰れて、白い四角として出てしまう。
  {
    file: 'notification-icon.png',
    size: 96,
    background: null,
    foot: [0xff, 0xff, 0xff],
    safe: 0.75,
  },
  // 起動画面。地はapp.jsonの背景色に任せるので、足あとだけを透明の上に置く。
  { file: 'splash-icon.png', size: 1024, background: null, foot: BRAND, safe: 0.6 },
];

for (const { file, size, background, foot, safe } of OUTPUTS) {
  const pixels = render({ size, background, foot, safe });
  writeFileSync(join(ASSETS, file), toPng(pixels, size));
  console.log(`${file} (${size}x${size})`);
}
