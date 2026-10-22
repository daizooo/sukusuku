import type { MoneyCardFeed, MoneyFeedItem, MoneyFeedRule, MoneyRecord, MoneyRecordDraft, ReceiptScanItem } from '@/types/app';
import { formatBalance, formatYen, recordTotal } from './moneyUtils.ts';

// Zaim 取り込みの画面で使う、数え方・言葉（docs/kakei.md §9.5）。mobile版の `mobile/src/lib/moneyFeedUtils.ts` と同じ中身。

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

/** 入金は「¥1,000」（色は緑）、出金は「¥−1,000」。 */
export const feedAmountLabel = (item: Pick<MoneyFeedItem, 'direction' | 'amount'>): string =>
  item.amount === null ? '' : item.direction === 'in' ? formatYen(item.amount) : formatBalance(-item.amount);

// 利用先に店名が載らない通知（デビットは「iDデビット」とだけ載る）。お店は空にして、人が入れる（2026-10-22）
const NO_STORE_DESCRIPTIONS = new Set(['iDデビット']);

/**
 * 未確認の「記録を作成する」で入れるお店。利用先に当てたお店（store_hint）、当たらなければ利用先そのまま（§9.5.6.1）。
 * 店名の載らない利用先（iDデビット）は空。
 */
export const feedStoreName = (item: Pick<MoneyFeedItem, 'storeHint' | 'description'>): string => {
  const description = item.description.trim();
  return item.storeHint || (NO_STORE_DESCRIPTIONS.has(description.normalize('NFKC')) ? '' : description);
};

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

/**
 * 記録の入力の重複の確認（§9.5.5 の最後）。新しく入れる記録と、同じ口座・同じ額・前後 days 日の「明細から来た記録」。
 * 口座は、入れる記録の出金元・入金先のどちらかが、明細から来た記録の出金元・入金先のどちらかと同じなら同じとみなす。
 */
export const feedDuplicates = (
  draft: Pick<MoneyRecordDraft, 'id' | 'occurredOn' | 'walletId' | 'toWalletId' | 'items'>,
  records: MoneyRecord[],
  linkedRecordIds: ReadonlySet<string>,
  days: number,
): MoneyRecord[] => {
  if (draft.id !== null) return [];
  const amount = draft.items.reduce((sum, item) => sum + item.amount, 0);
  const wallets = new Set([draft.walletId, draft.toWalletId].filter((id): id is string => id !== null));
  if (amount <= 0 || wallets.size === 0) return [];
  return records.filter(
    (record) =>
      linkedRecordIds.has(record.id) &&
      recordTotal(record) === amount &&
      dayDiff(record.occurredOn, draft.occurredOn) <= days &&
      ((record.walletId !== null && wallets.has(record.walletId)) || (record.toWalletId !== null && wallets.has(record.toWalletId))),
  );
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
      const category = rule.categoryId ? names.category(rule.categoryId) : 'カテゴリなし';
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

export interface CardMonthChecks {
  /** 利用通知と額の違う記録（レシートや明細で直したもの・通知のあとで額が変わったもの）。 */
  mismatched: { record: MoneyRecord; feedAmount: number }[];
  /** 通知の来ていないカードの記録（携帯電話・サブスクなど通知されない利用や、手で入れたもの）。 */
  unnotified: MoneyRecord[];
}

/**
 * 月の締めで、カードの記録をカードの明細と見比べるための一覧（docs/kakei.md §9.6.5 の C）。日付の古い順。
 * 「通知が来ていない」は、利用通知が届いたことのあるカードの、いちばん古い通知の利用日より後の支出だけ（自動で作った記録は除く）。
 */
export const cardMonthChecks = (records: readonly MoneyRecord[], cardFeed: MoneyCardFeed, monthKey: string): CardMonthChecks => {
  const wallets = new Set(cardFeed.walletIds);
  const inMonth = records
    .filter((record) => record.occurredOn.startsWith(`${monthKey}-`) && record.kind !== 'transfer')
    .sort((a, b) => (a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0));
  const mismatched: CardMonthChecks['mismatched'] = [];
  const unnotified: MoneyRecord[] = [];
  for (const record of inMonth) {
    const feedAmount = cardFeed.linkedAmounts[record.id];
    if (feedAmount !== undefined) {
      if (recordTotal(record) !== feedAmount) mismatched.push({ record, feedAmount });
      continue;
    }
    if (
      record.kind === 'expense' &&
      record.month === null &&
      record.walletId !== null &&
      wallets.has(record.walletId) &&
      cardFeed.since !== null &&
      record.occurredOn >= cardFeed.since
    ) {
      unnotified.push(record);
    }
  }
  return { mismatched, unnotified };
};

/**
 * お店でいちばん多く使ったカテゴリ（品目の数で数える。同じ数なら新しい記録のもの）。カードの利用通知を記録にするときの初めのカテゴリ（§9.6）。
 * そのお店の記録が無ければ null。
 */
export const storeCategoryGuess = (
  records: readonly MoneyRecord[],
  store: string,
  kind: 'expense' | 'income',
): string | null => {
  const name = store.trim();
  if (name === '') return null;
  const counts = new Map<string, { count: number; latest: string }>();
  for (const record of records) {
    if (record.kind !== kind || record.store.trim() !== name) continue;
    for (const item of record.items) {
      if (item.categoryId === null) continue;
      const entry = counts.get(item.categoryId) ?? { count: 0, latest: '' };
      entry.count += 1;
      if (record.occurredOn > entry.latest) entry.latest = record.occurredOn;
      counts.set(item.categoryId, entry);
    }
  }
  let best: { id: string; count: number; latest: string } | null = null;
  for (const [id, entry] of counts) {
    if (best === null || entry.count > best.count || (entry.count === best.count && entry.latest > best.latest)) {
      best = { id, ...entry };
    }
  }
  return best?.id ?? null;
};

/** Amazon の注文の品目（DB の money_feed_order_lines。値引き前の単価・個数と、同じ品名の前の記録から入れた品名・カテゴリ）。 */
export interface FeedOrderLine {
  receiptName: string;
  name: string;
  quantity: number;
  unitPrice: number;
  categoryId: string | null;
}

/**
 * Amazon の注文の品目を、支払額（注文メールの合計）に合わせて記録の入力の品目にする（docs/kakei.md §9.10）。
 * - 合計が品目の和より安いぶん（値引き・ポイント）は、品目の価格の比で配る（値引きの行は作らない）。**個数はそのまま**にするため、
 *   1個あたりの額を決めてから、端数は小数部の大きい品目から「個数ぶんの円」ずつ足す（個数1の品目は1円ずつ）
 * - それでも端数が残る（どの品目の個数も残りより多い）ときは、小数部のいちばん大きい品目を、1個あたりの額が1円違う2行に分ける
 *   （例: 2個で 11,499円 → 1個 5,750円 と 1個 5,749円。個数の合計は変わらない）
 * - 合計が品目の和より高いぶんは「送料など」の1行（カテゴリはいちばん金額の大きい品目と同じ）
 */
export function feedOrderItems(lines: readonly FeedOrderLine[], total: number): ReceiptScanItem[] {
  const base = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
  if (base <= 0 || total <= 0) return [];
  const fee = Math.max(total - base, 0);
  const paid = total - fee;

  // 1個あたりの額（切り捨て）と、切り捨てたぶん（base 倍した円。大きいほど先に足す）
  const rows = lines.map((line) => {
    const scaled = line.quantity * line.unitPrice * paid;
    const unit = Math.floor(scaled / (base * line.quantity));
    return { line, unit, rest: scaled - unit * line.quantity * base };
  });
  let left = paid - rows.reduce((sum, row) => sum + row.unit * row.line.quantity, 0);
  const byRest = () =>
    rows.map((row, index) => ({ row, index })).sort((a, b) => b.row.rest - a.row.rest || a.index - b.index);
  while (left > 0) {
    const next = byRest().find(({ row }) => row.line.quantity <= left);
    if (!next) break;
    next.row.unit += 1;
    next.row.rest -= next.row.line.quantity * base;
    left -= next.row.line.quantity;
  }
  const split = left > 0 ? byRest()[0].row : null;

  const item = (line: FeedOrderLine, quantity: number, unitPrice: number): ReceiptScanItem => ({
    receiptName: line.receiptName,
    name: line.name,
    quantity,
    unitPrice,
    amount: quantity * unitPrice,
    categoryId: line.categoryId,
    categorySource: line.categoryId ? 'history' : 'none',
  });
  const items = rows.flatMap((row) =>
    row === split
      ? [item(row.line, left, row.unit + 1), item(row.line, row.line.quantity - left, row.unit)]
      : [item(row.line, row.line.quantity, row.unit)],
  );
  if (fee > 0) {
    const top = [...lines].sort((a, b) => b.quantity * b.unitPrice - a.quantity * a.unitPrice)[0];
    items.push(item({ ...top, receiptName: '', name: '送料など' }, 1, fee));
  }
  return items;
}
