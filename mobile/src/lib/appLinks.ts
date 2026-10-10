import type { LogType, TabId } from '@/types/app';

// お知らせをタップしたときに、どの画面を開くかの決まりごと。
//
// PWA版は同じことをURLで表している（`/?tab=log&open=temperature`。src/lib/appLinks.ts と
// public/sw.js）。ネイティブ版もExpo Routerのパスとパラメータでまったく同じ飛び先にする
// ——検温のお知らせなら体温の入力画面、というように（ルートの CLAUDE.md）。

/** 育児タブで開く入力画面の種類。開いたら消す（画面に戻るたびに開き直さないため）。 */
export const OPEN_LOG_PARAM = 'open';

const LOG_TYPES: LogType[] = ['milk', 'diaper', 'pumping', 'temperature'];

/** パラメータの open を解釈する。知らない値なら null（入力画面は開かない）。 */
export const parseLogType = (value: string | string[] | undefined): LogType | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return LOG_TYPES.find((type) => type === first) ?? null;
};

/** お知らせの飛び先。開くタブと、育児タブなら開く入力画面。 */
export interface NotificationTarget {
  /** 開くタブ。備蓄の期限のお知らせだけは、タブではなく備蓄の画面（app/stock.tsx）。 */
  tab: TabId | 'stock';
  openLog?: LogType;
}

/**
 * お知らせの種類ごとの飛び先。PWA版（public/sw.js の URL_BY_KIND）と同じ対応にする。
 *
 * 予定のリマインダーは種類を持たないので、予定タブを開く。
 */
export const notificationTarget = (kind: unknown): NotificationTarget => {
  switch (kind) {
    // 授乳の経過時間・次の授乳の目安は、どちらも授乳の入力画面へ
    case 'nursing':
    case 'feeding':
      return { tab: 'care', openLog: 'milk' };
    // 検温のお知らせは体温の入力画面へ
    case 'temperature':
      return { tab: 'care', openLog: 'temperature' };
    // 備蓄の期限のお知らせは備蓄の画面（備蓄の期限順の一覧）へ
    case 'stock':
      return { tab: 'stock' };
    default:
      return { tab: 'schedule' };
  }
};
