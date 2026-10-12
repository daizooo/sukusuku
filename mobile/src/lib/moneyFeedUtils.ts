import type { MoneyFeedItem, MoneyFeedRule, MoneyRecord } from '@/types/app';
import { formatYen, recordTotal } from '@/lib/moneyUtils';

// Zaim 取り込みの画面で使う、数え方・言葉（docs/kakei.md §9.5）。PWA版の `src/lib/moneyFeedUtils.ts` と同じ中身。

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** YYYY-MM-DD → 「10/12（月）」。 */
export const feedDayLabel = (dateKey: string | null): string => {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${m}/${d}（${weekday}）`;
};

/** 日時（ISO）→ 「10/12 13:54」（日本時間）。 */
export const feedTimeLabel = (iso: string | null): string => {
  if (!iso) return 'まだありません';
  const jst = new Date(Date.parse(iso) + 9 * 3600_000);
  const hh = String(jst.getUTCHours()).padStart(2, '0');
  const mm = String(jst.getUTCMinutes()).padStart(2, '0');
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} ${hh}:${mm}`;
};

/** 入金は「+¥1,000」、出金は「−¥1,000」。 */
export const feedAmountLabel = (item: Pick<MoneyFeedItem, 'direction' | 'amount'>): string =>
  item.amount === null ? '' : `${item.direction === 'in' ? '+' : '−'}${formatYen(item.amount)}`;

/** 一覧の並び: 手入力との確認 → 口座が決まっていない → 未確認 → 読めない。同じ中は日付の新しい順。 */
const STATUS_ORDER = (item: MoneyFeedItem): number =>
  item.status === 'confirm' ? 0 : item.status === 'unreadable' ? 3 : item.walletId === null ? 1 : 2;

export const sortFeedInbox = (items: MoneyFeedItem[]): MoneyFeedItem[] =>
  [...items].sort(
    (a, b) =>
      STATUS_ORDER(a) - STATUS_ORDER(b) ||
      (b.occurredOn ?? '').localeCompare(a.occurredOn ?? '') ||
      b.receivedAt.localeCompare(a.receivedAt),
  );

/** 明細の状態の言葉。 */
export const feedStatusLabel = (item: MoneyFeedItem): string => {
  if (item.status === 'confirm') return '手入力と同じか確認';
  if (item.status === 'unreadable') return '読めないメール';
  if (item.walletId === null) return '口座を選ぶ';
  return '未確認';
};

const dayDiff = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

/**
 * 「既にある記録と結ぶ」の候補（§9.5.6.1）。同じ口座の（出金元か入金先が明細の口座）、前後7日の記録。
 * 額の近い順。明細と結んだ記録は除く（linkedRecordIds）。
 */
export const feedLinkCandidates = (
  item: MoneyFeedItem,
  records: MoneyRecord[],
  linkedRecordIds: ReadonlySet<string>,
  days = 7,
): MoneyRecord[] => {
  if (item.walletId === null || item.occurredOn === null || item.amount === null) return [];
  const amount = item.amount;
  return records
    .filter(
      (record) =>
        !linkedRecordIds.has(record.id) &&
        (record.walletId === item.walletId || record.toWalletId === item.walletId) &&
        dayDiff(record.occurredOn, item.occurredOn!) <= days,
    )
    .sort((a, b) => Math.abs(recordTotal(a) - amount) - Math.abs(recordTotal(b) - amount))
    .slice(0, 20);
};

export const FEED_ACTION_LABELS: Record<MoneyFeedRule['action'], string> = {
  record: '記録にする',
  transfer: '振替にする',
  link_recurring: '自動の記録と結ぶ',
  adjust_only: '補正のみ',
  ignore: '記録しない',
};

/** ルールの条件を1行で。 */
export const feedRuleCondition = (rule: MoneyFeedRule, walletName: (id: string) => string): string => {
  const parts: string[] = [];
  parts.push(rule.walletId ? walletName(rule.walletId) : 'どの口座でも');
  parts.push(rule.direction === 'in' ? '入金' : rule.direction === 'out' ? '出金' : '入金・出金');
  if (rule.pattern !== '') parts.push(rule.match === 'key' ? `「${rule.pattern}」` : `「${rule.pattern}」を含む`);
  if (rule.amountMin !== null || rule.amountMax !== null) {
    parts.push(
      `${rule.amountMin !== null ? formatYen(rule.amountMin) : ''}〜${rule.amountMax !== null ? formatYen(rule.amountMax) : ''}`,
    );
  }
  return parts.join('・');
};

/** ルールの動きを1行で。 */
export const feedRuleAction = (
  rule: MoneyFeedRule,
  names: { wallet: (id: string) => string; category: (id: string) => string; recurring: (id: string) => string },
): string => {
  switch (rule.action) {
    case 'record': {
      const kind = rule.recordKind === 'income' ? '収入' : '支出';
      const category = rule.categoryId ? names.category(rule.categoryId) : '種類なし';
      return `${kind}・${category}${rule.store !== '' ? `・${rule.store}` : ''}`;
    }
    case 'transfer':
      return `振替（相手: ${rule.toWalletId ? names.wallet(rule.toWalletId) : '—'}）`;
    case 'link_recurring':
      return `自動の記録と結ぶ（${rule.recurringId ? names.recurring(rule.recurringId) : '—'}）`;
    case 'adjust_only':
      return '補正のみ（カード代金の見込みを明細の額で確定）';
    case 'ignore':
      return '記録しない';
  }
};
