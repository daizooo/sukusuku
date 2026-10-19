import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';
import type { ReceiptImage } from '@/lib/api/moneyReceipt';

// レシートを撮る（docs/kakei.md §10.1）。ML Kit ドキュメントスキャナー（Android）が縁を見つけて傾きを直し、
// レシートの幅で切り抜く。長いレシートは上下に分けて撮れる（4枚まで。読み取りでまとめて1回にする）。
// 写真は端末にも残さない（base64 で受け取り、読み取りに送るだけ）。

/** 撮ったレシートの写真。やめたら null。 */
export async function captureReceipt(): Promise<ReceiptImage[] | null> {
  const result = await DocumentScanner.scanDocument({
    maxNumDocuments: 4,
    // 文字が読める範囲で軽くする（送る量と読み取りの費用を抑える）
    croppedImageQuality: 70,
    responseType: ResponseType.Base64,
  });
  if (result.status === ScanDocumentResponseStatus.Cancel || !result.scannedImages?.length) return null;
  return result.scannedImages.map((image) => ({
    media_type: 'image/jpeg',
    // スキャナーの base64 には改行が入ることがあり、そのまま送ると読み取りが invalid base64 で断られる（2026-10-19）
    data: image.replace(/^data:[^,]*,/, '').replace(/\s+/g, ''),
  }));
}
