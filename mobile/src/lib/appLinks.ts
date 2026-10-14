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
  /**
   * 開くタブ。備蓄の期限のお知らせは備蓄の画面（app/stock.tsx）、契約の更新日のお知らせは
   * 契約の画面（app/contracts.tsx）。どちらもタブではなく、その他タブから開く画面。
   */
  tab: TabId | 'stock' | 'contracts';
  openLog?: LogType;
}

/**
 * お知らせの種類ごとの飛び先。送る側（supabase/functions/_shared/deliver.ts）の種類と対にする。
 * PWA版は通知を受け取らない（public/sw.js は登録を外すだけ）ので、対応表は mobile だけが持つ。
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
    // 契約の更新日のお知らせは契約の画面（更新日の近い順の一覧）へ
    case 'contract':
      return { tab: 'contracts' };
    default:
      return { tab: 'schedule' };
  }
};

// ここから下はホーム画面のウィジェットからのリンク（docs/widgets.md）。
// 育児の入力画面は、お知らせと同じ `open`（OPEN_LOG_PARAM）で開く。

/** 家計タブで開く入力のパラメータ名（育児タブと同じ open）。 */
export const OPEN_MONEY_PARAM = OPEN_LOG_PARAM;

/** 家計タブで開く入力。支出・収入・振替は記録の入力画面、receipt はレシートの撮影から。 */
export type MoneyOpen = 'expense' | 'income' | 'transfer' | 'receipt';

const MONEY_OPENS: MoneyOpen[] = ['expense', 'income', 'transfer', 'receipt'];

/** 家計タブのパラメータの open を解釈する。知らない値なら null（何も開かない）。 */
export const parseMoneyOpen = (value: string | string[] | undefined): MoneyOpen | null => {
  const first = Array.isArray(value) ? value[0] : value;
  return MONEY_OPENS.find((open) => open === first) ?? null;
};

/** ToDoタブで開くリスト（リストのID）。開いたら消す（OPEN_LOG_PARAM と同じ）。 */
export const OPEN_LIST_PARAM = 'list';

/**
 * アプリの外からタブを開くリンク（`sukusuku://care?open=milk`）。
 * scheme は app.config.js の scheme。タブのパスはグループ名を含まない（app/index.tsx と同じ形）。
 */
export const appLink = (tab: TabId, params: Record<string, string> = {}): string => {
  const query = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return `sukusuku://${tab}${query ? `?${query}` : ''}`;
};
