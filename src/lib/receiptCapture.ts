import type { ReceiptImage } from '@/lib/api/moneyReceipt';

// レシートの写真を、読み取りに送る形にする（docs/kakei.md §10.1）。PWA版はスキャナーが無いので、撮ったまま・選んだままの写真を送る
// （背景は読み取り側で無視させる）。mobile版は ML Kit ドキュメントスキャナーで切り抜く（`mobile/src/lib/receiptCapture.ts`）。
// 文字が読める範囲で縮めて JPEG にする（送る量と読み取りの費用を抑える）。写真はどこにも残さない。

const MAX_WIDTH = 1200;
const MAX_HEIGHT = 2400;
// 読み取りに送れる枚数（Edge Function と同じ）
export const MAX_RECEIPT_IMAGES = 4;

async function toJpeg(file: File): Promise<ReceiptImage> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_WIDTH / bitmap.width, MAX_HEIGHT / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  return { media_type: 'image/jpeg', data: dataUrl.replace(/^data:image\/\w+;base64,/, '') };
}

/** 選んだ写真（上から順。4枚まで）を、読み取りに送る形にする。 */
export async function receiptImagesFromFiles(files: FileList | File[]): Promise<ReceiptImage[]> {
  const images = Array.from(files)
    .filter((file) => file.type.startsWith('image/'))
    .slice(0, MAX_RECEIPT_IMAGES);
  return Promise.all(images.map(toJpeg));
}
