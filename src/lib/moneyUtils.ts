// 家計タブの数え方（月の集計・予算との差・カテゴリの並び・電卓）。docs/kakei.md §3〜§5。
// mobile版の `mobile/src/lib/moneyUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 年はすべて暦年（1月〜12月。2026-10-09に、4月始まりの年度から変えた）。予算は大分類・年ごとの月額で、
// その年の予算が無ければ前の年の額を使う（毎年入れ直さなくてよいように）。
//
// 収支＝収入 − 支出（生活費）。
// 振替は集計に入れない。貯金は記録なので、収支の式にも表示にも入れない。

import type {
  MoneyBudget,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyHolding,
  MoneyHoldingAccount,
  MoneyHoldingValue,
  MoneyItem,
  ReceiptScanItem,
  MoneyItemDraft,
  MoneyHolidayRule,
  MoneyMonth,
  MoneyRecord,
  MoneyRecordKind,
  MoneyRecurring,
  MoneyBudgetLine,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityKind,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletType,
} from '@/types/app';
import { isHoliday } from './japaneseHolidays.ts';

const pad2 = (value: number) => String(value).padStart(2, '0');

// ---- 月・年 ----

/** YYYY-MM-DD の月（YYYY-MM）。 */
export const monthKeyOf = (dateKey: string): string => dateKey.slice(0, 7);

/** Date の月（YYYY-MM）。 */
export const monthKeyOfDate = (date: Date): string => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;

/** 月をずらす。 */
export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number);
  const index = year * 12 + (month - 1) + delta;
  return `${Math.floor(index / 12)}-${pad2((index % 12) + 1)}`;
}

/** 「2026年9月」。 */
export function formatMonthKey(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}年${month}月`;
}

/** 「9/14」。 */
export function formatShortDate(dateKey: string): string {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
}

// ---- 金額の表示 ----

/** ¥1,234。 */
/** ¥と数字のあいだの細いすき間（U+2009。詰まって見えないように）。 */
const YEN_MARK = '¥\u2009';

export const formatYen = (value: number) => `${YEN_MARK}${Math.abs(value).toLocaleString('ja-JP')}`;

/** マイナスだけ符号つき（¥1,234 / ¥−1,234 / ¥0）。プラスに符号は付けない（色で見せる）。¥は先頭。 */
export function formatSignedYen(value: number): string {
  if (value === 0) return formatYen(0);
  return `${YEN_MARK}${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('ja-JP')}`;
}

// ---- カテゴリ・出金元の決まりごと ----

export const RECORD_KIND_LABEL: Record<MoneyRecordKind, string> = {
  expense: '支出',
  income: '収入',
  transfer: '振替',
};

/** 出金元の種類（Zaim の「出金元の選択」と同じ並び）。 */
/** 出金元を削除するときの確認文（記録は残り、出金元は「なし」になる）。 */
export const WALLET_DELETE_NOTE = '記録は残りますが、出金元はなしになります。確定した残高や取り込みのルールは消えます。';

export const WALLET_TYPES: { id: MoneyWalletType; label: string }[] = [
  { id: 'cash', label: '財布' },
  { id: 'card', label: 'カード' },
  { id: 'bank', label: '口座' },
  { id: 'prepaid', label: 'プリペイド' },
  { id: 'qr', label: 'QR決済' },
  { id: 'securities', label: '証券' },
];

/**
 * 家計「口座」の種類ごとの区画を、表示のまとまりに分ける。項目が1つだけの区画が隣り合うときは2つを1まとまり（横に並べて1行）にして、高さを縮める。
 * 2つ以上ある区画は単独のまま（そちらは2列のタイル）。並び順は変えない。
 */
export function groupWalletSections<T extends { rows: readonly unknown[] }>(sections: readonly T[]): T[][] {
  const blocks: T[][] = [];
  for (const section of sections) {
    const last = blocks[blocks.length - 1];
    if (section.rows.length === 1 && last && last.length === 1 && last[0].rows.length === 1) last.push(section);
    else blocks.push([section]);
  }
  return blocks;
}

/**
 * 出金元のアイコンの色の候補（docs/kakei.md §3.2）。「標準」（null）は種類ごとの色。
 * 保存するのは #rrggbb（money_wallets.icon_color）。
 */
export const WALLET_ICON_COLORS: { color: string; label: string }[] = [
  { color: '#e53935', label: '赤' },
  { color: '#f57c00', label: 'オレンジ' },
  { color: '#f9a825', label: '黄' },
  { color: '#4caf50', label: '緑' },
  { color: '#1b6b4a', label: '深緑' },
  { color: '#00a3a3', label: '水色' },
  { color: '#1e78c2', label: '青' },
  { color: '#5e35b1', label: '紫' },
  { color: '#d81b60', label: 'ピンク' },
  { color: '#6d4c41', label: '茶' },
  { color: '#757575', label: '灰' },
];

export const walletTypeLabel = (type: MoneyWalletType) =>
  WALLET_TYPES.find((entry) => entry.id === type)?.label ?? '';

// ---- 毎月の記録（固定費・給料・カード代金。docs/kakei.md §3.3・§3.4） ----

/** 毎月◯日（31 は末日）。 */
export const formatDayOfMonth = (day: number) => (day >= 31 ? '末日' : `${day}日`);

export const HOLIDAY_RULE_LABEL: Record<MoneyHolidayRule, string> = {
  next: '翌営業日',
  prev: '前営業日',
  none: 'そのまま',
};

/** 第何週かの選択肢（5 は最終）。毎月の記録のルールの「第◯◯曜日」に使う。 */
export const WEEK_OF_MONTH_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: '第1' },
  { value: 2, label: '第2' },
  { value: 3, label: '第3' },
  { value: 4, label: '第4' },
  { value: 5, label: '最終' },
];

const RULE_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 毎月の記録のルールの日取り。「27日」「末日」「第2金曜日」「最終金曜日」。 */
export function recurringDayLabel(rule: Pick<MoneyRecurring, 'day'> & Partial<Pick<MoneyRecurring, 'weekOfMonth' | 'weekday'>>): string {
  if (rule.weekOfMonth != null && rule.weekday != null) {
    const week = WEEK_OF_MONTH_OPTIONS.find((option) => option.value === rule.weekOfMonth)?.label ?? `第${rule.weekOfMonth}`;
    return `${week}${RULE_WEEKDAYS[rule.weekday] ?? ''}曜日`;
  }
  return formatDayOfMonth(rule.day);
}

/**
 * 記録する月の言い方。12か月は「毎月」、1・3・5…月は「奇数月」、2・4・6…月は「偶数月」、同じ間隔で1年を回るものは「3か月ごと」、
 * それ以外は「6・12月」（2026-10-18。月をすべて並べると読みにくいため）。
 */
export function monthsLabel(months: readonly number[]): string {
  const sorted = [...new Set(months)].sort((a, b) => a - b);
  if (sorted.length === 12) return '毎月';
  if (sorted.length === 6 && sorted.every((month) => month % 2 === 1)) return '奇数月';
  if (sorted.length === 6 && sorted.every((month) => month % 2 === 0)) return '偶数月';
  if (sorted.length >= 3) {
    const step = 12 / sorted.length;
    const even = Number.isInteger(step) && sorted.every((month, index) => index === 0 || month - sorted[index - 1] === step);
    if (even) return `${step}か月ごと`;
  }
  return `${sorted.join('・')}月`;
}

/** 記録する月の言い方に、◯年ごとを付ける。「毎月」「6・12月」「2年ごとの9月」。 */
export function recurringMonthsLabel(rule: Pick<MoneyRecurring, 'months'> & Partial<Pick<MoneyRecurring, 'intervalYears'>>): string {
  const months = rule.months === null ? '毎月' : monthsLabel(rule.months);
  return rule.intervalYears != null ? `${rule.intervalYears}年ごとの${months}` : months;
}

/** 「毎月27日（休日は翌営業日）」「6・12月の10日（休日は前営業日）」「12月の第2金曜日（休日は前営業日）」。 */
export function recurringScheduleLabel(
  rule: Pick<MoneyRecurring, 'day' | 'months' | 'holiday'> & Partial<Pick<MoneyRecurring, 'weekOfMonth' | 'weekday' | 'intervalYears'>>,
): string {
  const when =
    rule.months === null && rule.intervalYears == null
      ? `毎月${recurringDayLabel(rule)}`
      : `${recurringMonthsLabel(rule)}の${recurringDayLabel(rule)}`;
  return `${when}（${rule.holiday === 'none' ? '休日もそのまま' : `休日は${HOLIDAY_RULE_LABEL[rule.holiday]}`}）`;
}

/**
 * ルールの期間（docs/kakei.md §3.3）。monthKey（YYYY-MM。どの月の分か＝入金・引き落としのある月）が期間の中か。
 * 開始月・終了月の null は無期限。
 */
export function inRecurringPeriod(
  rule: Partial<Pick<MoneyRecurring, 'startMonth' | 'endMonth' | 'intervalYears'>>,
  monthKey: string,
): boolean {
  if (rule.startMonth != null && monthKey < rule.startMonth) return false;
  if (rule.endMonth != null && monthKey > rule.endMonth) return false;
  // ◯年ごと（車検など）は、開始月の年から数えて間隔の年だけ（DBの make_money_recurring_records と同じ。2026-10-21）。
  if (rule.intervalYears != null && rule.startMonth != null) {
    if ((yearOfMonth(monthKey) - yearOfMonth(rule.startMonth)) % rule.intervalYears !== 0) return false;
  }
  return true;
}

/** ルールの期間が、monthKey（YYYY-MM）より前に終わっているか。 */
export const recurringEnded = (rule: Pick<MoneyRecurring, 'endMonth'>, monthKey: string): boolean =>
  rule.endMonth !== null && rule.endMonth < monthKey;

const periodMonthLabel = (monthKey: string) => `${monthKey.slice(0, 4)}/${Number(monthKey.slice(5, 7))}`;

/** 「2027/9〜」「〜2027/8」「2026/10〜2027/8」。期間が無ければ空。 */
export function recurringPeriodLabel(rule: Pick<MoneyRecurring, 'startMonth' | 'endMonth'>): string {
  if (rule.startMonth === null && rule.endMonth === null) return '';
  return `${rule.startMonth === null ? '' : periodMonthLabel(rule.startMonth)}〜${rule.endMonth === null ? '' : periodMonthLabel(rule.endMonth)}`;
}

/**
 * 期間の入力（「2027/9」「2027-09」「2027年9月」）を YYYY-MM にする。空は null（無期限）。読めなければ undefined。
 */
export function parsePeriodMonth(text: string): string | null | undefined {
  const value = text.trim().replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  if (value === '') return null;
  const match = /^(\d{4})\s*(?:[/／\-.年])\s*(\d{1,2})\s*月?$/.exec(value);
  if (!match) return undefined;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return undefined;
  return `${match[1]}-${pad2(month)}`;
}

/** YYYY-MM を期間の入力の形（2027/9）にする。null は空。 */
export const periodMonthInput = (monthKey: string | null): string => (monthKey === null ? '' : periodMonthLabel(monthKey));

/** 引き落とし月の選択肢（締め日の月から数える）。null は締め日のあとに来る最初の引き落とし日。 */
export const PAY_MONTH_OPTIONS: { offset: number | null; label: string }[] = [
  { offset: null, label: '自動' },
  { offset: 1, label: '翌月' },
  { offset: 2, label: '翌々月' },
];

const payMonthLabel = (offset: number) => (offset === 1 ? '翌' : offset === 2 ? '翌々月' : `${offset}か月後の`);

/** カードの「15日締め・翌10日払い」「末日締め・翌々月2日払い」。設定がそろっていなければ空。 */
export function cardScheduleLabel(wallet: Pick<MoneyWallet, 'closeDay' | 'payDay' | 'payMonthOffset'>): string {
  if (wallet.closeDay === null || wallet.payDay === null) return '';
  if (wallet.payMonthOffset !== null) {
    return `${formatDayOfMonth(wallet.closeDay)}締め・${payMonthLabel(wallet.payMonthOffset)}${formatDayOfMonth(wallet.payDay)}払い`;
  }
  // 締め日のあとの最初の引き落とし日なので、引き落とし日が締め日より後なら同じ月、そうでなければ翌月。
  const sameMonth = wallet.payDay > wallet.closeDay && wallet.closeDay < 31;
  return `${formatDayOfMonth(wallet.closeDay)}締め・${sameMonth ? '' : '翌'}${formatDayOfMonth(wallet.payDay)}払い`;
}

/**
 * 期間の始まりより前の記録か（見込みに使わない。時短後の給与の見込みが、出産前の給与の記録から出ないように）。
 * そのルールが作った記録は期間に関係なく使う（DBの money_recurring_estimate と同じ）。
 */
const beforePeriod = (
  rule: Partial<Pick<MoneyRecurring, 'id' | 'startMonth'>>,
  record: Pick<MoneyRecord, 'occurredOn' | 'recurringId'>,
): boolean =>
  rule.startMonth != null &&
  record.occurredOn < `${rule.startMonth}-01` &&
  (rule.id === undefined || record.recurringId !== rule.id);

/**
 * ルールの過去1年の記録（カテゴリ・出金元・お店が同じで、見込みでないもの。新しい順）。見込みの額のもとになる
 * （DBの money_recurring_estimate と同じ選び方。額の出し方は estimateRecurringAmount）。設定画面で、ルールが過去の記録と
 * 結びついているかを確かめるのに使う。1件の記録に同じカテゴリの品目が複数あれば合計する。
 */
export function recurringHistory(
  rule: Pick<MoneyRecurring, 'kind' | 'walletId' | 'toWalletId' | 'store' | 'categoryId'> &
    Partial<Pick<MoneyRecurring, 'id' | 'startMonth'>>,
  records: readonly MoneyRecord[],
  today: string,
): { occurredOn: string; amount: number }[] {
  if (rule.walletId === null) return [];
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const matches = (item: MoneyItem) => rule.categoryId === null || item.categoryId === rule.categoryId;
  const history: { occurredOn: string; amount: number }[] = [];
  for (const record of records) {
    if (record.kind !== rule.kind || record.isEstimate || record.walletId !== rule.walletId) continue;
    if (rule.kind === 'transfer' && record.toWalletId !== rule.toWalletId) continue;
    if (record.store.trim() !== rule.store.trim()) continue;
    if (record.occurredOn < since || record.occurredOn >= today) continue;
    if (beforePeriod(rule, record)) continue;
    const items = record.items.filter(matches);
    if (items.length === 0) continue;
    history.push({ occurredOn: record.occurredOn, amount: items.reduce((sum, item) => sum + item.amount, 0) });
  }
  return history.sort((x, y) => (x.occurredOn < y.occurredOn ? 1 : x.occurredOn > y.occurredOn ? -1 : 0));
}

/**
 * その年の収入の記録（振替・支出を除く）。新しい日から。固定収入の画面の履歴に使う（見込みか確定かは isEstimate）。
 * docs/kakei.md §0.3。
 */
export function incomeRecordsInYear(records: readonly MoneyRecord[], year: number): MoneyRecord[] {
  const prefix = `${year}-`;
  return records
    .filter((record) => record.kind === 'income' && record.occurredOn.startsWith(prefix))
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0));
}

/**
 * 「見込み」の記録か。**固定収入・固定支出の見込みの額で自動で作ったまま、まだ確定していないものだけ**（2026-10-16）。
 * 財布・デビットの記録は入れた時点で確定、カードも Gmail から取り込んで確かめてから記録に入るので、見込みは無い。
 * 振替（カード代金の引き落とし）は見込みとして扱わない。
 */
export const isFixedEstimate = (record: Pick<MoneyRecord, 'isEstimate' | 'recurringId' | 'kind'>): boolean =>
  record.isEstimate && record.recurringId !== null && record.kind !== 'transfer';

/** その月の、見込みの額のままの記録（固定収入・固定支出のものだけ。isFixedEstimate）。 */
export const estimatesInMonth = (records: readonly MoneyRecord[], monthKey: string): MoneyRecord[] =>
  recordsInMonth(records, monthKey).filter(isFixedEstimate);

/**
 * 標準のカテゴリ（Zaim のカテゴリをもとにした、どの家族でも使える並び）。docs/kakei.md §3.1。
 * カテゴリがまだ1つも無い家族に「標準のカテゴリで始める」で入れる。名前・並びはあとで家族が変える。
 */
export const DEFAULT_CATEGORIES: { kind: MoneyCategoryKind; name: string; children: string[] }[] = [
  { kind: 'living', name: '住居費', children: ['家賃・ローン', '管理費', '修繕'] },
  { kind: 'living', name: '食費', children: ['食料品', '外食', '嗜好品'] },
  { kind: 'living', name: '光熱費', children: ['電気', 'ガス', '水道'] },
  { kind: 'living', name: '日用品・雑貨費', children: ['日用品', '雑貨', 'ドラッグストア'] },
  { kind: 'living', name: '交通費', children: ['電車・バス', 'ガソリン', '駐車場'] },
  { kind: 'living', name: '通信費', children: ['携帯電話', 'インターネット'] },
  { kind: 'living', name: '医療費', children: ['病院', '薬'] },
  { kind: 'living', name: 'おしゃれ費', children: ['服', '美容院', '化粧品'] },
  { kind: 'living', name: '娯楽', children: ['レジャー', '本・趣味', '交際費'] },
  { kind: 'living', name: '子ども費', children: ['日用品', '洋服・おもちゃ', '習い事'] },
  { kind: 'living', name: 'その他', children: ['お小遣い', '仕送り', '保険', '使途不明金'] },
  { kind: 'income', name: '給料', children: [] },
  { kind: 'income', name: 'その他の収入', children: [] },
];

// ---- カテゴリのアイコン（docs/kakei.md §3.1。Zaim と同じくカテゴリごとに絵と色） ----

/** 選べるアイコン。key を money_categories.icon に入れる。色はアイコンごとに決まっている（家族は絵だけ選ぶ）。 */
export const MONEY_ICONS: { key: string; label: string; color: string; surface: string }[] = [
  { key: 'home', label: '住まい', color: '#b45309', surface: '#fffbeb' },
  { key: 'sofa', label: '家具', color: '#b45309', surface: '#fffbeb' },
  { key: 'food', label: '食事', color: '#7cb342', surface: '#fff7ed' },
  { key: 'grocery', label: '買い物', color: '#7cb342', surface: '#fff7ed' },
  { key: 'cafe', label: 'カフェ', color: '#7cb342', surface: '#fff7ed' },
  { key: 'drink', label: 'お酒', color: '#7cb342', surface: '#fff7ed' },
  { key: 'power', label: '電気', color: '#ca8a04', surface: '#fefce8' },
  { key: 'gas', label: 'ガス', color: '#ca8a04', surface: '#fefce8' },
  { key: 'water', label: '水道', color: '#ca8a04', surface: '#fefce8' },
  { key: 'daily', label: '日用品', color: '#1e88e5', surface: '#ecfdf5' },
  { key: 'beauty', label: '美容', color: '#db2777', surface: '#fdf2f8' },
  { key: 'clothes', label: '服', color: '#db2777', surface: '#fdf2f8' },
  { key: 'hair', label: '美容院', color: '#db2777', surface: '#fdf2f8' },
  { key: 'train', label: '電車', color: '#0284c7', surface: '#f0f9ff' },
  { key: 'car', label: '車', color: '#0284c7', surface: '#f0f9ff' },
  { key: 'fuel', label: 'ガソリン', color: '#0284c7', surface: '#f0f9ff' },
  { key: 'plane', label: '旅行', color: '#0284c7', surface: '#f0f9ff' },
  { key: 'phone', label: '携帯', color: '#4f46e5', surface: '#eef2ff' },
  { key: 'wifi', label: 'ネット', color: '#4f46e5', surface: '#eef2ff' },
  { key: 'medical', label: '病院', color: '#e53935', surface: '#fff1f2' },
  { key: 'pill', label: '薬', color: '#e53935', surface: '#fff1f2' },
  { key: 'heart', label: '健康', color: '#e53935', surface: '#fff1f2' },
  { key: 'ticket', label: 'レジャー', color: '#7c3aed', surface: '#f5f3ff' },
  { key: 'game', label: '遊び', color: '#7c3aed', surface: '#f5f3ff' },
  { key: 'book', label: '本・趣味', color: '#7c3aed', surface: '#f5f3ff' },
  { key: 'sports', label: '運動', color: '#7c3aed', surface: '#f5f3ff' },
  { key: 'baby', label: '子ども', color: '#5c6bc0', surface: '#f0fdfa' },
  { key: 'school', label: '学び', color: '#0d9488', surface: '#f0fdfa' },
  { key: 'gift', label: '贈り物', color: '#0d9488', surface: '#f0fdfa' },
  { key: 'pet', label: 'ペット', color: '#65a30d', surface: '#f7fee7' },
  { key: 'wallet', label: 'お小遣い', color: '#2563eb', surface: '#eff6ff' },
  { key: 'insurance', label: '保険', color: '#2563eb', surface: '#eff6ff' },
  { key: 'receipt', label: '支払い', color: '#2563eb', surface: '#eff6ff' },
  { key: 'salary', label: '給料', color: '#2563eb', surface: '#eff6ff' },
  { key: 'savings', label: '貯金', color: '#2563eb', surface: '#eff6ff' },
  { key: 'star', label: '特別', color: '#f5b301', surface: '#fffbeb' },
  { key: 'other', label: 'その他', color: '#6b7280', surface: '#f3f4f6' },
];

const ICON_RULES: [RegExp, string][] = [
  [/特別/, 'star'],
  [/住|家賃|ローン|管理費|修繕/, 'home'],
  [/家具|家電/, 'sofa'],
  [/食料|スーパー/, 'grocery'],
  [/嗜好|カフェ|お菓子/, 'cafe'],
  [/酒/, 'drink'],
  [/外食|食/, 'food'],
  [/電気|光熱/, 'power'],
  [/ガス/, 'gas'],
  [/水道/, 'water'],
  [/化粧|コスメ/, 'beauty'],
  [/美容/, 'hair'],
  [/おしゃれ|服|衣/, 'clothes'],
  [/ガソリン/, 'fuel'],
  [/車|駐車/, 'car'],
  [/交通|電車|バス/, 'train'],
  [/旅行/, 'plane'],
  [/ネット|インターネット/, 'wifi'],
  [/携帯|通信|電話/, 'phone'],
  [/薬|ドラッグ/, 'pill'],
  [/医療|病院|歯科/, 'medical'],
  [/保険/, 'insurance'],
  [/娯楽|レジャー/, 'ticket'],
  [/本|趣味/, 'book'],
  [/運動|ジム|スポーツ/, 'sports'],
  [/保育|習い|学|教育/, 'school'],
  [/子ども|子供|おもちゃ|ベビー/, 'baby'],
  [/交際|お祝い|仕送り|プレゼント/, 'gift'],
  [/ペット/, 'pet'],
  [/小遣い/, 'wallet'],
  [/給料|給与|賞与|収入/, 'salary'],
  [/貯金|積立/, 'savings'],
  [/日用|雑貨/, 'daily'],
];

/** 名前から近いアイコンを選ぶ（アイコンを決めていないカテゴリに使う）。当たらなければ「その他」。 */
export function guessIconKey(name: string): string {
  return ICON_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? 'other';
}

/**
 * カテゴリのアイコンの key（決めたもの、無ければ名前から）。色を選んでいるカテゴリは "food|#e53935" の形で色まで持ち回る
 * （iconTone が色まで読む。key だけを見たいときは baseIconKey）。
 */
export const iconKeyOf = (
  category: Pick<MoneyCategory, 'icon' | 'name'> & { iconColor?: string | null } | null | undefined,
): string => {
  if (!category) return 'other';
  const key = category.icon ?? guessIconKey(category.name);
  return category.iconColor ? `${key}|${category.iconColor}` : key;
};

/** iconKeyOf の色を除いた、アイコンの key だけ。 */
export const baseIconKey = (key: string): string => key.split('|')[0];

/** アイコンの色（知らない key は「その他」の色）。key に色が付いていれば、その色。 */
export function iconTone(key: string): { key: string; label: string; color: string; surface: string } {
  const [base, color] = key.split('|');
  const found = MONEY_ICONS.find((icon) => icon.key === base) ?? MONEY_ICONS[MONEY_ICONS.length - 1];
  return color ? { ...found, color } : found;
}

/** アイコンの色の候補（出金元と同じ色）。標準（null）はアイコンごとに決まっている色。 */
export const CATEGORY_ICON_COLORS = WALLET_ICON_COLORS;

const byPosition = <T extends { position: number; name: string }>(a: T, b: T) =>
  a.position !== b.position ? a.position - b.position : a.name.localeCompare(b.name, 'ja');

/** 大分類（kind のもの）。使わなくしたものは includeArchived のときだけ。 */
export function topCategories(
  categories: readonly MoneyCategory[],
  kind: MoneyCategoryKind,
  includeArchived = false,
): MoneyCategory[] {
  return categories
    .filter((category) => category.parentId === null && category.kind === kind && (includeArchived || !category.archived))
    .sort(byPosition);
}

/** 大分類の下の小分類。 */
export function childCategories(
  categories: readonly MoneyCategory[],
  parentId: string,
  includeArchived = false,
): MoneyCategory[] {
  return categories
    .filter((category) => category.parentId === parentId && (includeArchived || !category.archived))
    .sort(byPosition);
}

/** カテゴリの大分類の id（大分類ならそれ自身）。知らない id は null。 */
export function topCategoryIdOf(categories: readonly MoneyCategory[], categoryId: string): string | null {
  const category = categories.find((entry) => entry.id === categoryId);
  if (!category) return null;
  return category.parentId ?? category.id;
}

/** 「食費 › 食料品」（大分類なら名前だけ）。 */
export function categoryPath(categories: readonly MoneyCategory[], categoryId: string | null): string {
  if (categoryId === null) return '';
  const category = categories.find((entry) => entry.id === categoryId);
  if (!category) return '';
  if (category.parentId === null) return category.name;
  const parent = categories.find((entry) => entry.id === category.parentId);
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

// ---- 固定費を予算に足す（docs/kakei.md §3.1・§3.3） ----
// 足す額は、記録を作る側（DBの make_money_recurring_records・money_recurring_estimate）と同じ決め方にして、予算と記録をつなぐ。
// 日取り・休日・見込みの出し方を DB と同じに写してある（片方を直したらもう片方も直す。日取りの休日は japaneseHolidays と DB の jp_holiday_name が一致）。

const lastDayOfMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const weekdayOfDate = (year: number, month: number, day: number): number => new Date(Date.UTC(year, month - 1, day)).getUTCDay();

/** 銀行の営業日か（土日・祝日・12月31日〜1月3日を除く。DBの money_is_business_day）。 */
function isBusinessDay(dateKey: string): boolean {
  const [year, month, day] = dateKey.split('-').map(Number);
  const weekday = weekdayOfDate(year, month, day);
  if (weekday === 0 || weekday === 6) return false;
  if (['12-31', '01-01', '01-02', '01-03'].includes(dateKey.slice(5))) return false;
  return !isHoliday(new Date(year, month - 1, day));
}

/**
 * ルールのその月（month は 1〜12）の日付。「毎月◯日（31 は末日）」か「第n◯曜日／最終◯曜日」を決め、
 * 休日なら翌営業日／前営業日にずらす（DBの money_rule_date と money_shift_business_day）。
 */
export function recurringDateOf(
  year: number,
  month: number,
  rule: Pick<MoneyRecurring, 'day' | 'weekOfMonth' | 'weekday' | 'holiday'>,
): string {
  const last = lastDayOfMonth(year, month);
  let day: number;
  if (rule.weekOfMonth == null || rule.weekday == null) {
    day = Math.min(rule.day, last);
  } else if (rule.weekOfMonth >= 5) {
    day = last - ((weekdayOfDate(year, month, last) - rule.weekday + 7) % 7);
  } else {
    day = 1 + ((rule.weekday - weekdayOfDate(year, month, 1) + 7) % 7) + (rule.weekOfMonth - 1) * 7;
  }
  let dateKey = `${year}-${pad2(month)}-${pad2(day)}`;
  if (rule.holiday === 'none') return dateKey;
  while (!isBusinessDay(dateKey)) dateKey = addDays(dateKey, rule.holiday === 'next' ? 1 : -1);
  return dateKey;
}

/** 1年前の同じ日（2月29日は2月28日。DBの `- interval '1 year'` と同じ）。 */
const yearBefore = (dateKey: string): string =>
  `${Number(dateKey.slice(0, 4)) - 1}-${dateKey.slice(5) === '02-29' ? '02-28' : dateKey.slice(5)}`;

/**
 * 見込みのルールの、その月（YYYY-MM）の額。DBの money_recurring_estimate と同じ:
 * 前年同月の記録（前年のその月の引き落とし日の前後10日。いちばん近いもの）があればその額、無ければ直近3回（過去1年）の平均、
 * 記録が1件も無ければルールに入れた額。同じカテゴリ・出金元・お店の、見込みでない記録だけを使う。期間の始まりより前の記録は使わない。
 */
export function estimateRecurringAmount(rule: MoneyRecurring, monthKey: string, records: readonly MoneyRecord[]): number {
  if (rule.walletId === null) return rule.amount;
  const year = yearOfMonth(monthKey);
  const month = Number(monthKey.slice(5, 7));
  const on = recurringDateOf(year, month, rule);
  const lastYear = recurringDateOf(year - 1, month, rule);
  const oneYearAgo = yearBefore(on);
  const from = addDays(lastYear, -10) < oneYearAgo ? addDays(lastYear, -10) : oneYearAgo;
  const store = rule.store.trim();
  const matched: { occurredOn: string; amount: number }[] = [];
  for (const record of records) {
    if (record.kind !== rule.kind || record.isEstimate || record.walletId !== rule.walletId) continue;
    if (rule.kind === 'transfer' && record.toWalletId !== rule.toWalletId) continue;
    if (record.store.trim() !== store) continue;
    if (record.occurredOn < from || record.occurredOn >= on) continue;
    if (beforePeriod(rule, record)) continue;
    // その月のためにこのルールが作った記録は、作った時点では無かったので数えない。
    if (record.recurringId === rule.id && record.month === monthKey) continue;
    const items = rule.categoryId === null ? record.items : record.items.filter((item) => item.categoryId === rule.categoryId);
    if (items.length === 0) continue;
    matched.push({ occurredOn: record.occurredOn, amount: items.reduce((sum, item) => sum + item.amount, 0) });
  }
  const apart = (dateKey: string) => Math.abs(Math.round((parseDateKey(dateKey) - parseDateKey(lastYear)) / DAY_MS));
  const near = matched
    .filter((entry) => apart(entry.occurredOn) <= 10)
    .sort((a, b) => apart(a.occurredOn) - apart(b.occurredOn) || (a.occurredOn < b.occurredOn ? 1 : -1))[0];
  if (near) return near.amount;
  const recent = matched
    .filter((entry) => entry.occurredOn >= oneYearAgo)
    .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : a.occurredOn > b.occurredOn ? -1 : 0))
    .slice(0, 3);
  if (recent.length > 0) return Math.round(recent.reduce((sum, entry) => sum + entry.amount, 0) / recent.length);
  return rule.amount;
}

export interface PendingRecurring {
  rule: MoneyRecurring;
  /** その月の記録する日（YYYY-MM-DD）。 */
  date: string;
  /** 記録される額（見込みのルールは見込みの額）。 */
  amount: number;
}

/**
 * その月（YYYY-MM）に、固定収入・固定費のルールでこれから自動で作られる記録（today〔YYYY-MM-DD〕より後の日のもの）。
 * 作る条件は DBの make_money_recurring_records と同じ（使っていて、出金元とカテゴリが決まっていて、記録する月・期間の中で、
 * ルールを作ったあとの日で、まだ作っていないもの）。収支に入らない振替は除く。
 * 自動の記録より前に月を締めるときに知らせる（docs/kakei.md §4.5）。日の早い順。
 */
export function pendingRecurringInMonth(
  recurring: readonly MoneyRecurring[],
  records: readonly MoneyRecord[],
  monthKey: string,
  today: string,
): PendingRecurring[] {
  const year = yearOfMonth(monthKey);
  const month = Number(monthKey.slice(5, 7));
  const made = new Set(
    records.filter((record) => record.recurringId !== null && record.month === monthKey).map((record) => record.recurringId),
  );
  const pending: PendingRecurring[] = [];
  for (const rule of recurring) {
    if (rule.archived || rule.kind === 'transfer' || rule.walletId === null || rule.makesRecord === false || rule.categoryId === null) continue;
    if (rule.months !== null && !rule.months.includes(month)) continue;
    if (!inRecurringPeriod(rule, monthKey) || made.has(rule.id)) continue;
    const date = recurringDateOf(year, month, rule);
    if (date <= today || date < rule.createdAt) continue;
    const amount = rule.amountMode === 'fixed' ? rule.amount : estimateRecurringAmount(rule, monthKey, records);
    pending.push({ rule, date, amount });
  }
  return pending.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 固定費のルールのその月（YYYY-MM）の額＝記録と同じ額。
 * そのルールが作った記録が見込みのまま（固定額なら確定していても）あれば、その記録の額。額を見込むルールで確定したあとは、
 * 作った時点と同じ計算（estimateRecurringAmount）で出す（確定した実際の額と比べられるように）。記録がまだ無い月も同じ計算。
 */
function recurringMonthAmount(
  rule: MoneyRecurring,
  monthKey: string,
  records: readonly MoneyRecord[],
  made: ReadonlyMap<string, MoneyRecord>,
): number {
  const record = made.get(`${rule.id}|${monthKey}`);
  if (record && (rule.amountMode === 'fixed' || record.isEstimate)) {
    return record.items.reduce((sum, item) => sum + item.amount, 0);
  }
  return rule.amountMode === 'fixed' ? rule.amount : estimateRecurringAmount(rule, monthKey, records);
}

/** その年に効く固定の支出・収入のルール1件（月ごとの額と年の合計つき）。 */
export interface RecurringYearRow {
  rule: MoneyRecurring;
  /** 1月〜12月の額（記録する月・期間の外は 0）。 */
  amounts: number[];
  total: number;
}

/**
 * 固定の支出・収入のルールのうち、その年に効くもの（2026-10-15）。年をまたぐルール（期間・記録する月つき）も、その年の月だけを数える。
 * 作る条件・額は予算に足す額と同じ（使っていて、出金元とカテゴリが決まっているもの。額は recurringMonthAmount）。振替は除く。
 * 予算の画面で、年の収入の見込み（固定収入）と、予算に含まれる固定費を出すのに使う。
 */
export function recurringInYear(
  recurring: readonly MoneyRecurring[],
  records: readonly MoneyRecord[],
  year: number,
): RecurringYearRow[] {
  const made = new Map<string, MoneyRecord>();
  for (const record of records) {
    if (record.recurringId !== null && record.month !== null && record.kind !== 'transfer') {
      made.set(`${record.recurringId}|${record.month}`, record);
    }
  }
  const rows: RecurringYearRow[] = [];
  for (const rule of recurring) {
    if (rule.archived || rule.kind === 'transfer' || rule.walletId === null || rule.makesRecord === false || rule.categoryId === null) continue;
    if (year < yearOfMonth(rule.createdAt.slice(0, 7))) continue;
    const amounts = Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const monthKey = `${year}-${pad2(month)}`;
      if (rule.months !== null && !rule.months.includes(month)) return 0;
      if (!inRecurringPeriod(rule, monthKey)) return 0;
      return Math.max(recurringMonthAmount(rule, monthKey, records, made), 0);
    });
    const total = amounts.reduce((sum, value) => sum + value, 0);
    if (total > 0) rows.push({ rule, amounts, total });
  }
  return rows.sort((a, b) => a.rule.position - b.rule.position);
}

// ---- 月の締めの「今月記録予定の固定費」（docs/kakei.md §0.8。2026-10-23） ----
// 自動記録オフの固定費（確定・見込み）は、日が決まらず、いつ払うか分からないもの（自動車税・スマホ・車検など）。
// 発生月にその小分類の記録が無ければ、月の締めで知らせる（設定は持たない。いつもそうする）。発生月なし（自治会費など）は知らせない。

/** 締めの「今月記録予定の固定費」の1回。 */
export interface PendingEstimate {
  rule: MoneyRecurring;
  /** 予定の月（YYYY-MM）。「今月はなし」はこの月を skippedMonths に足す。「翌月へ」で送られてきた回は前の月。 */
  plannedMonth: string;
  /** 記録するときの日（YYYY-MM-DD）。締める月の末日（今月なら今日）。 */
  date: string;
  /** 予算の額（1回の額）。 */
  amount: number;
}

/**
 * 締める月（YYYY-MM）の「今月記録予定の固定費」（カテゴリの並び → 予算の並び）。today は YYYY-MM-DD。
 * 自動記録オフで発生月のある固定費（確定・見込み）のうち、その月が発生月（期間・◯年ごとを含む）で、その月に同じ小分類の
 * 記録が無いもの。予算を作った月より前の回と、「今月はなし」にした回は出さない。「翌月へ」にした回（deferredUntil がその月）も出す。
 */
export function scheduledFixedInMonth(
  recurring: readonly MoneyRecurring[],
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  monthKey: string,
  today: string,
): PendingEstimate[] {
  const year = yearOfMonth(monthKey);
  const month = Number(monthKey.slice(5, 7));
  const lastDay = `${monthKey}-${pad2(lastDayOfMonth(year, month))}`;
  const date = lastDay < today ? lastDay : today;
  const recorded = new Set<string>();
  for (const record of recordsInMonth(records, monthKey)) {
    if (record.kind !== 'expense') continue;
    for (const item of record.items) if (item.categoryId !== null) recorded.add(item.categoryId);
  }
  const list: PendingEstimate[] = [];
  for (const rule of recurring) {
    if (!isBudgetRow(rule) || rule.kind !== 'expense' || rule.makesRecord || rule.noMonth) continue;
    const categoryId = rule.categoryId as string;
    const group = spendGroupOf(categoryId, categories);
    if ((group !== 'confirmed' && group !== 'estimate') || recorded.has(categoryId)) continue;
    const planned =
      (rule.months === null || rule.months.includes(month)) &&
      inRecurringPeriod(rule, monthKey) &&
      monthKey >= monthKeyOf(rule.createdAt) &&
      !rule.skippedMonths.includes(monthKey);
    if (planned) list.push({ rule, plannedMonth: monthKey, date, amount: rule.amount });
    if (rule.deferredUntil !== null && monthKeyOf(rule.deferredUntil) === monthKey) {
      list.push({ rule, plannedMonth: shiftMonth(monthKey, -1), date, amount: rule.amount });
    }
  }
  const order = (rule: MoneyRecurring) => {
    const category = categories.find((entry) => entry.id === rule.categoryId);
    const top = categories.find((entry) => entry.id === topCategoryIdOf(categories, rule.categoryId as string));
    return (top?.position ?? 0) * 10000 + (category?.parentId !== null ? (category?.position ?? 0) : 0);
  };
  return list.sort((a, b) => order(a.rule) - order(b.rule) || a.rule.position - b.rule.position || (a.plannedMonth < b.plannedMonth ? -1 : 1));
}

// ---- 予算（docs/kakei.md §0.8。2026-10-23） ----
// 予算が本体。予算1件＝money_recurring の1行（MoneyRecurring）で、「単価 × その年に発生する回数」。回数は発生月（毎月・月を選ぶ）・
// ◯年ごと・期間で決まる（毎月なら ×12、偶数月なら ×6、年に1回なら ×1）。発生月なし（noMonth）は、その年に1回ぶんを、
// 月には置かずに見込み支出（収入なら見込みの収入）として数える。自動記録はその行のオン／オフ（makesRecord）。
// 支出をどこで数えるか（変動費・予備費・固定費の確定・見込み）は、大分類の予算の分け方（budgetGroup）だけで決める。
// 数えるときは、収入・予備費・固定費は予算の明細（MoneyBudgetLine。budgetLinesOf）、変動費は大分類の月の予算
// （MoneyBudget。variableBudgetsOf。大分類の行 ＋ その小分類の行）の形に直して使う。

/** 予算の行か（振替でなく、カテゴリが決まっていて、使っているもの）。 */
export const isBudgetRow = (rule: MoneyRecurring): boolean => !rule.archived && rule.kind !== 'transfer' && rule.categoryId !== null;

/** 予算の行を、予算の明細の形にする（年の回数・額を数えるため）。 */
export const budgetLineOf = (rule: MoneyRecurring): MoneyBudgetLine => ({
  id: rule.id,
  categoryId: rule.categoryId as string,
  name: rule.name,
  amount: rule.amount,
  months: rule.noMonth ? null : rule.months,
  noMonth: rule.noMonth,
  intervalYears: rule.intervalYears,
  startMonth: rule.startMonth,
  endMonth: rule.endMonth,
  position: rule.position,
});

/** 収入・予備費・固定費の予算（予算の明細の形）。変動費の行は入れない（variableBudgetsOf で月の予算にする）。 */
export function budgetLinesOf(recurring: readonly MoneyRecurring[], categories: readonly MoneyCategory[]): MoneyBudgetLine[] {
  return recurring
    .filter(isBudgetRow)
    .map(budgetLineOf)
    .filter((line) => budgetLineGroup(line, categories) !== 'variable');
}

/**
 * 支出の予算の、自動記録の額の決まり方（docs/kakei.md §0.8）。種類で決まる: 固定費（見込み）・変動費は見込み
 * （過去の記録から見込んだ見込みの記録を作る）、固定費（確定）・予備費は確定。収入は行ごとに決める。
 */
export const amountModeOfGroup = (group: SpendGroup): MoneyRecurring['amountMode'] =>
  group === 'estimate' || group === 'variable' ? 'estimate' : 'fixed';

/** 変動費の月の予算を出す年の終わり（期間・◯年ごとのある行も、この年まで月ごとに出す）。 */
const VARIABLE_BUDGET_LAST_YEAR = 2100;

/**
 * 変動費の大分類ごとの、年ごとの月の予算（大分類の行 ＋ その小分類の行のうち、その月に発生するもの）。発生する行の無い月は null。
 * 最初の年は、行の期間の始まりのいちばん早い年（始まりの無い行があれば 2000年）。
 */
export function variableBudgetsOf(recurring: readonly MoneyRecurring[], categories: readonly MoneyCategory[]): MoneyBudget[] {
  const byTop = new Map<string, MoneyBudgetLine[]>();
  for (const rule of recurring) {
    if (!isBudgetRow(rule) || rule.kind !== 'expense' || rule.noMonth) continue;
    const line = budgetLineOf(rule);
    if (budgetLineGroup(line, categories) !== 'variable') continue;
    const topId = topCategoryIdOf(categories, line.categoryId);
    if (topId === null) continue;
    byTop.set(topId, [...(byTop.get(topId) ?? []), line]);
  }
  const budgets: MoneyBudget[] = [];
  for (const [topId, lines] of byTop) {
    const first = Math.min(...lines.map((line) => (line.startMonth === null ? 2000 : yearOfMonth(line.startMonth))));
    for (let year = first; year <= VARIABLE_BUDGET_LAST_YEAR; year += 1) {
      const monthAmounts: (number | null)[] = Array.from({ length: 12 }, () => null);
      for (const line of lines) {
        for (const month of budgetLineMonths(line, year)) monthAmounts[month - 1] = (monthAmounts[month - 1] ?? 0) + line.amount;
      }
      if (monthAmounts.some((value) => value !== null)) budgets.push({ id: `${topId}|${year}`, categoryId: topId, year, monthAmounts });
    }
  }
  return budgets;
}

/** 予算の行の短い説明（「毎月 · 自動 27日」「2年ごと 3月」「発生月なし」）。一覧の名前の下に出す。 */
export function budgetRowNote(rule: MoneyRecurring): string {
  const when = rule.noMonth ? '発生月なし' : rule.months === null ? '毎月' : monthsLabel(rule.months);
  const schedule = rule.intervalYears === null ? when : `${rule.intervalYears}年ごと ${when}`;
  return rule.makesRecord ? `${schedule} · 自動 ${recurringDayLabel(rule)}` : schedule;
}


/** 明細が、その年に発生する月（1〜12。月の順）。発生月なしは空。 */
export function budgetLineMonths(line: MoneyBudgetLine, year: number): number[] {
  if (line.noMonth) return [];
  const months = line.months ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  return months.filter((month) => inRecurringPeriod(line, `${year}-${pad2(month)}`)).sort((a, b) => a - b);
}

/** 発生月なしの明細が、その年にかかるか（期間がその年にかかり、◯年ごとならその年に当たる）。 */
export function budgetLineInYear(line: MoneyBudgetLine, year: number): boolean {
  if (line.startMonth !== null && line.startMonth > `${year}-12`) return false;
  if (line.endMonth !== null && line.endMonth < `${year}-01`) return false;
  if (line.intervalYears !== null && line.startMonth !== null) {
    if ((year - yearOfMonth(line.startMonth)) % line.intervalYears !== 0) return false;
  }
  return true;
}

/** 明細が、その年に発生する回数（発生月なしは、かかる年なら1）。 */
export const budgetLineCount = (line: MoneyBudgetLine, year: number): number =>
  line.noMonth ? (budgetLineInYear(line, year) ? 1 : 0) : budgetLineMonths(line, year).length;

/** 明細の、その年の額（単価 × 回数）。 */
export const budgetLineYearAmount = (line: MoneyBudgetLine, year: number): number => line.amount * budgetLineCount(line, year);

/** 明細の短い説明（「¥3,520 × 奇数月」「¥47,500 × 2月・2年ごと」「¥100,000 × 発生月なし」）。 */
export function budgetLineShortLabel(line: MoneyBudgetLine): string {
  const when = line.noMonth ? '発生月なし' : line.months === null ? '毎月' : monthsLabel(line.months);
  return `${formatYen(line.amount)} × ${when}${line.intervalYears === null ? '' : `・${line.intervalYears}年ごと`}`;
}

/** 予算の分け方（収入の明細は 'income'）。 */
export type BudgetLineGroup = 'income' | SpendGroup;

/** 明細の分け方。収入のカテゴリなら収入、ほかは大分類の予算の分け方。 */
export function budgetLineGroup(line: MoneyBudgetLine, categories: readonly MoneyCategory[]): BudgetLineGroup {
  const category = categories.find((entry) => entry.id === line.categoryId);
  if (category?.kind === 'income') return 'income';
  return spendGroupOf(line.categoryId, categories);
}

export interface BudgetPlan {
  /** 分け方ごとの、発生月のある回の1月〜12月。 */
  months: Record<BudgetLineGroup, number[]>;
  /** 分け方ごとの、発生月なしの額。 */
  noMonth: Record<BudgetLineGroup, number>;
  /** 分け方ごとの、その年の合計（発生月のある回 ＋ 発生月なし）。 */
  totals: Record<BudgetLineGroup, number>;
}

const BUDGET_LINE_GROUPS: BudgetLineGroup[] = ['income', 'variable', 'reserve', 'confirmed', 'estimate'];

/** その年の予算の明細を、分け方ごとに月へ置く（発生月なしは月に置かない。額は noMonthYearAmount。集計を始めた年は減らす）。 */
export function budgetPlanInYear(
  lines: readonly MoneyBudgetLine[],
  categories: readonly MoneyCategory[],
  year: number,
): BudgetPlan {
  const months = Object.fromEntries(BUDGET_LINE_GROUPS.map((group) => [group, Array.from({ length: 12 }, () => 0)])) as Record<BudgetLineGroup, number[]>;
  const noMonth = Object.fromEntries(BUDGET_LINE_GROUPS.map((group) => [group, 0])) as Record<BudgetLineGroup, number>;
  for (const line of lines) {
    const group = budgetLineGroup(line, categories);
    if (line.noMonth) {
      noMonth[group] += noMonthYearAmount(line, group, year);
      continue;
    }
    for (const month of budgetLineMonths(line, year)) months[group][month - 1] += line.amount;
  }
  const totals = Object.fromEntries(
    BUDGET_LINE_GROUPS.map((group) => [group, months[group].reduce((sum, value) => sum + value, 0) + noMonth[group]]),
  ) as Record<BudgetLineGroup, number>;
  return { months, noMonth, totals };
}

/** 小分類ごとの、その年の予算（明細の合計）。 */
export function budgetLineTotalsByCategory(lines: readonly MoneyBudgetLine[], year: number): Map<string, number> {
  const totals = new Map<string, number>();
  for (const line of lines) totals.set(line.categoryId, (totals.get(line.categoryId) ?? 0) + budgetLineYearAmount(line, year));
  return totals;
}

export interface ReserveRow {
  categoryId: string;
  /** その年の予算（明細の合計）。 */
  amount: number;
  /** その年にその小分類で使った額。 */
  spent: number;
}

/** 予備費の小分類（大分類の分け方が予備費）ごとの、その年の予算と使った額（カテゴリの並び）。使っていない小分類で予算も無いものは出さない。 */
export function reserveYearRows(
  lines: readonly MoneyBudgetLine[],
  categories: readonly MoneyCategory[],
  records: readonly MoneyRecord[],
  year: number,
): ReserveRow[] {
  const totals = budgetLineTotalsByCategory(lines, year);
  const keys = yearMonthKeys(year);
  const rows: ReserveRow[] = [];
  for (const top of topCategories(categories, 'living', true)) {
    if (top.budgetGroup !== 'reserve') continue;
    for (const child of childCategories(categories, top.id, true)) {
      const amount = totals.get(child.id) ?? 0;
      const spent = categorySpentIn(records, child.id, keys);
      if (amount === 0 && spent === 0 && child.archived) continue;
      rows.push({ categoryId: child.id, amount, spent });
    }
  }
  return rows;
}

/**
 * その月（YYYY-MM）の大分類の、手入力の月の予算（変動費）。予算は年ごとに12か月ぶんを持つので、
 * 年の途中で直しても、直した月より前の月は変わらない。
 * その年の行が無ければ、前の年のいちばん近い行の12月の額（毎年入れ直さなくてよいように）。どこにも無い月は null。
 */
export function manualBudgetFor(budgets: readonly MoneyBudget[], categoryId: string, monthKey: string): number | null {
  const year = yearOfMonth(monthKey);
  const month = Number(monthKey.slice(5, 7));
  let found: MoneyBudget | null = null;
  for (const budget of budgets) {
    if (budget.categoryId !== categoryId || budget.year > year) continue;
    if (found === null || budget.year > found.year) found = budget;
  }
  if (found === null) return null;
  return found.monthAmounts[found.year === year ? month - 1 : 11] ?? null;
}

/**
 * その月（YYYY-MM）の大分類の月の予算。予算を充てるのは変動費（手入力）だけ（2026-10-21。固定費〔確定・見込み〕は足さない。
 * 予備費は小分類ごとの年の額で、別に数える。docs/kakei.md §0.7）。無い月は null（予算なし）。
 */
export const budgetFor = (budgets: readonly MoneyBudget[], categoryId: string, monthKey: string): number | null =>
  manualBudgetFor(budgets, categoryId, monthKey);

/** その年の1月〜12月の、手入力の予算（長さ12）。編集の初期値。 */
export const budgetMonths = (budgets: readonly MoneyBudget[], categoryId: string, year: number): (number | null)[] =>
  Array.from({ length: 12 }, (_, index) => manualBudgetFor(budgets, categoryId, `${year}-${pad2(index + 1)}`));

/**
 * 「その年の予算」として一覧に出す代表の月。今年なら今月、これからの年なら1月、過ぎた年なら12月
 * （年の途中で変えた年は、いま効いている額を見せるため）。today は YYYY-MM-DD。
 */
export function budgetMonthKey(year: number, today: string): string {
  const thisYear = yearOfMonth(today);
  const month = year === thisYear ? Number(today.slice(5, 7)) : year > thisYear ? 1 : 12;
  return `${year}-${pad2(month)}`;
}

// ---- 記録 ----

/** 記録の合計（品目の合計）。 */
export const recordTotal = (record: Pick<MoneyRecord, 'items'>): number =>
  record.items.reduce((sum, item) => sum + item.amount, 0);

/**
 * 既にある記録にレシートを当てる前に確かめること（docs/kakei.md §10.8）。無ければ空で、そのまま品目を入れ替えてよい。
 * 合計が違う・手で入れた品目（2つ以上か、品名のある品目）があれば、置き換えるかスキップするかを選んでもらう。
 */
export function receiptReplaceNotices(record: Pick<MoneyRecord, 'items'>, receiptTotal: number): string[] {
  const notices: string[] = [];
  const total = recordTotal(record);
  if (total !== receiptTotal) notices.push(`記録の ${formatYen(total)} とレシートの ${formatYen(receiptTotal)} で合計が違います`);
  if (record.items.length > 1 || record.items.some((item) => item.name.trim() !== '')) notices.push('手で入れた品目があります');
  return notices;
}

/** 新しい順（日付が同じなら入った順の逆）。 */
export function sortRecordsDesc<T extends { occurredOn: string }>(records: readonly T[]): T[] {
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) =>
      a.record.occurredOn !== b.record.occurredOn
        ? b.record.occurredOn.localeCompare(a.record.occurredOn)
        : b.index - a.index,
    )
    .map((entry) => entry.record);
}

export const recordsInMonth = (records: readonly MoneyRecord[], monthKey: string) =>
  records.filter((record) => monthKeyOf(record.occurredOn) === monthKey);

/** その月（YYYY-MM）を締めたか（docs/kakei.md §4.5）。 */
export const isMonthClosed = (months: readonly MoneyMonth[], monthKey: string): boolean =>
  months.some((entry) => entry.month === monthKey && entry.closedAt !== null);

/**
 * 締めていない過ぎた月（古い順）。記録のある月（振替だけの月は数えない。年の数え方と同じ）のうち、今月より前で締めていないもの
 * （集計を始めた月〔MONEY_COUNT_START〕より前の月は出さない）。
 * 振り返りの上に「◯月が締まっていません」と出す（docs/kakei.md §4.5）。today は YYYY-MM-DD。
 */
export function unclosedMonths(records: readonly MoneyRecord[], months: readonly MoneyMonth[], today: string): string[] {
  const current = today.slice(0, 7);
  const recorded = new Set<string>();
  for (const record of records) {
    if (record.kind === 'transfer') continue;
    const monthKey = monthKeyOf(record.occurredOn);
    // 集計を始める前の月（2026年9月。カードの引き落とし額を合わせるためだけの記録）は締めない（docs/kakei.md §0.9）
    if (monthKey < current && monthKey >= MONEY_COUNT_START) recorded.add(monthKey);
  }
  return [...recorded].filter((monthKey) => !isMonthClosed(months, monthKey)).sort();
}

/** 日ごとにまとめる（新しい日から）。 */
export function groupRecordsByDay(records: readonly MoneyRecord[]): { date: string; records: MoneyRecord[] }[] {
  const groups: { date: string; records: MoneyRecord[] }[] = [];
  for (const record of sortRecordsDesc(records)) {
    const last = groups[groups.length - 1];
    if (last && last.date === record.occurredOn) last.records.push(record);
    else groups.push({ date: record.occurredOn, records: [record] });
  }
  return groups;
}

/** 品目のカテゴリのまとまり（記録の詳細で、同じカテゴリの品目を1行に見せる）。 */
export interface ItemGroup<T extends Omit<MoneyItem, 'id'>> {
  key: string;
  categoryId: string | null;
  /** 削除したカテゴリの名前（categoryId が null のとき）。 */
  categoryName: string;
  items: T[];
  total: number;
}

export const itemGroupKey = (item: Pick<MoneyItem, 'categoryId' | 'categoryName'>) =>
  item.categoryId !== null ? `category:${item.categoryId}` : item.categoryName !== '' ? `deleted:${item.categoryName}` : 'none';

/** 品目をカテゴリごとにまとめる。最初に出てきた順。 */
export function groupItems<T extends Omit<MoneyItem, 'id'>>(items: readonly T[]): ItemGroup<T>[] {
  const groups: ItemGroup<T>[] = [];
  for (const item of items) {
    const key = itemGroupKey(item);
    const group = groups.find((entry) => entry.key === key);
    if (group) {
      group.items.push(item);
      group.total += item.amount;
    } else {
      groups.push({
        key,
        categoryId: item.categoryId,
        categoryName: item.categoryName,
        items: [item],
        total: item.amount,
      });
    }
  }
  return groups;
}

/** 品名の並び（「牛乳 ×2・食パン」）。名前の無い行は数えない。 */
export function itemNamesLabel(items: readonly Pick<MoneyItem, 'name' | 'quantity'>[]): string {
  return items
    .filter((item) => item.name.trim() !== '')
    .map((item) => (item.quantity > 1 ? `${item.name.trim()} ×${item.quantity}` : item.name.trim()))
    .join('・');
}

// 記録の一覧の2行目（docs/kakei.md §2.1。Zaim の履歴と同じ並び）。
/** 品名の要約（「牛乳、卵」「牛乳、卵ほか」）。品名が1つも無ければ空。 */
export function itemSummary(items: readonly Pick<MoneyItem, 'name'>[]): string {
  const names = [...new Set(items.map((item) => item.name.trim()).filter((name) => name !== ''))];
  if (names.length === 0) return '';
  return `${names.slice(0, 2).join('、')}${names.length > 2 ? 'ほか' : ''}`;
}

/** 品目の金額（単価があれば 個数 × 単価）。 */
export const lineAmount = (line: { quantity: number; unitPrice: number | null; amount: number }) =>
  line.unitPrice === null ? line.amount : line.unitPrice * line.quantity;

// ---- 入力の手助け ----

/** よく使う小分類（直近の記録で多い順）。使わなくしたカテゴリは出さない。 */
export function frequentCategoryIds(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  kind: MoneyCategoryKind,
  limit = 6,
  recent = 200,
): string[] {
  const usable = new Set(
    categories.filter((category) => category.kind === kind && !category.archived).map((category) => category.id),
  );
  const counts = new Map<string, number>();
  for (const record of sortRecordsDesc(records).slice(0, recent)) {
    for (const item of record.items) {
      if (item.categoryId === null || !usable.has(item.categoryId)) continue;
      counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([id]) => id);
}

/** お店を使った記録（お店の候補を出すのに要る分だけ）。 */
export type StoreUse = Pick<MoneyRecord, 'store' | 'occurredOn'>;

/** 最近使ったお店（新しい順・重複なし）。 */
export function recentStores(records: readonly StoreUse[], limit = 12): string[] {
  const seen = new Set<string>();
  const stores: string[] = [];
  for (const record of sortRecordsDesc(records)) {
    const store = record.store.trim();
    if (store === '' || seen.has(store)) continue;
    seen.add(store);
    stores.push(store);
    if (stores.length >= limit) break;
  }
  return stores;
}

/**
 * お店の名前を比べるための形（docs/kakei.md §3.5）。全角半角・大文字小文字・ひらがなとカタカナ・
 * 空白と記号の違いをそろえる（「よかもんね!城南店」と「よかもんね 城南店」を同じに見る）。
 */
export function storeKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u3041-\u3096]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 0x60))
    .replace(/[\s!-\/:-@\[-`{-~、。・「」『』【】〜]/g, '');
}

/**
 * お店の名前が、打った名前に当たるか。どちらかがもう片方を含めば当たり
 * （「コスモス」で「ドラッグストアコスモス」を、「ロッキー城南店」で「ロッキー」を出す。似たお店の警告に使う）。
 */
export function matchesStore(name: string, query: string): boolean {
  const key = storeKey(name);
  const typed = storeKey(query);
  if (typed === '') return true;
  return key.includes(typed) || (key.length >= 2 && typed.includes(key));
}

/**
 * お店の選択肢（docs/kakei.md §3.5）。登録したお店を、直近1年に使った回数の多い順に（同じ回数なら名前順）。
 * 登録していない前に使ったお店（others。名前順。「この記録だけに使う」で入れたものなど）は、名前で探したときだけ出す。
 * 使わなくしたお店は、記録で使っていても候補に出さない。
 * 以前は先頭に「最近使ったお店」を出していたが、その記録だけのお店がふだんの候補に混ざって邪魔なのでやめた（2026-10-20）。
 */
export function storeChoices(
  stores: readonly MoneyStore[],
  records: readonly StoreUse[],
  today: string,
): { registered: string[]; others: string[] } {
  const archived = new Set(stores.filter((store) => store.archived).map((store) => store.name));
  // 直近1年（1年前の同じ日より後）に使った回数。
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const uses = new Map<string, number>();
  for (const record of records) {
    const store = record.store.trim();
    if (store !== '' && record.occurredOn > since) uses.set(store, (uses.get(store) ?? 0) + 1);
  }
  const registered = stores
    .filter((store) => !store.archived)
    .map((store) => store.name)
    .sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || a.localeCompare(b, 'ja'));
  const registeredNames = new Set(stores.map((store) => store.name));
  const others = recentStores(records, Number.MAX_SAFE_INTEGER)
    .filter((name) => !archived.has(name) && !registeredNames.has(name))
    .sort((a, b) => a.localeCompare(b, 'ja'));
  return { registered, others };
}

/**
 * 並べ替えのあとの position（設定の固定支出・固定収入・お店。docs/kakei.md §3.3・§3.5）。
 * orderedIds が新しい並び。その行がもともと持っていた position を小さい順に取り、新しい並びの順に割り当て直す
 * （並べ替えに出ていない行の position は動かさない）。変わった行だけ返す。
 */
export function reorderedPositions(
  rows: readonly { id: string; position: number }[],
  orderedIds: readonly string[],
): { id: string; position: number }[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ids = orderedIds.filter((id) => byId.has(id));
  const slots = ids.map((id) => byId.get(id)!.position).sort((a, b) => a - b);
  // 同じ position が重なっていても、並びが決まるように 1 ずつずらす。
  for (let index = 1; index < slots.length; index++) {
    if (slots[index] <= slots[index - 1]) slots[index] = slots[index - 1] + 1;
  }
  return ids
    .map((id, index) => ({ id, position: slots[index] }))
    .filter((change) => change.position !== byId.get(change.id)!.position);
}

/** 前回の出金元（そのカテゴリの記録でいちばん新しいもの）。使わなくした出金元は使わない。 */
export function lastWalletId(
  records: readonly MoneyRecord[],
  wallets: readonly MoneyWallet[],
  kind: MoneyRecordKind,
): string | null {
  const usable = new Set(wallets.filter((wallet) => !wallet.archived).map((wallet) => wallet.id));
  for (const record of sortRecordsDesc(records)) {
    if (record.kind === kind && record.walletId !== null && usable.has(record.walletId)) return record.walletId;
  }
  return null;
}

// ---- 月の集計（docs/kakei.md §4.1） ----

export interface BudgetTile {
  category: MoneyCategory;
  /** 月の予算。未設定は null。 */
  budget: number | null;
  actual: number;
  /** 予算 − 実績（マイナスは超えた額）。予算が無ければ −実績。 */
  diff: number;
  /** 使った割合（%）。予算0・未設定は null。 */
  percent: number | null;
}

/** その月の生活費を、大分類ごとに足す（振替は入れない）。 */
export function livingSpendByTop(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  monthKey: string,
): Map<string, number> {
  const spend = new Map<string, number>();
  for (const record of recordsInMonth(records, monthKey)) {
    if (record.kind !== 'expense') continue;
    for (const item of record.items) {
      if (item.categoryId === null) continue;
      const topId = topCategoryIdOf(categories, item.categoryId);
      if (topId === null) continue;
      spend.set(topId, (spend.get(topId) ?? 0) + item.amount);
    }
  }
  return spend;
}

/**
 * 生活費のタイル。カテゴリの並び（大分類の並び順）のまま（2026-10-08に、予算を超えた順から変えた）。
 * 使わなくした大分類は、その月に使っていれば出す。
 * 予算は、変動費の大分類は月の予算、予備費・固定費の大分類は予算の明細（その月に発生する回。年〔2か月以上〕は発生月なしも1回ぶん。
 * docs/kakei.md §0.7）。
 */
export function buildBudgetTiles(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  monthKeys: string | readonly string[],
  lines: readonly MoneyBudgetLine[] = [],
): BudgetTile[] {
  // 月の振り返りは1か月、年の振り返りは記録のある月ぜんぶ。実績も予算も月ごとに足す。
  const keys = typeof monthKeys === 'string' ? [monthKeys] : monthKeys;
  const spend = new Map<string, number>();
  for (const key of keys) {
    for (const [topId, amount] of livingSpendByTop(records, categories, key)) {
      spend.set(topId, (spend.get(topId) ?? 0) + amount);
    }
  }
  return topCategories(categories, 'living', true)
    .filter((category) => !category.archived || (spend.get(category.id) ?? 0) > 0)
    .map((category) => {
      const budget = category.budgetGroup === 'variable' ? manualBudgetIn(budgets, category.id, keys) : lineBudgetIn(lines, categories, category.id, keys);
      const actual = spend.get(category.id) ?? 0;
      return {
        category,
        budget,
        actual,
        diff: (budget ?? 0) - actual,
        percent: budget !== null && budget > 0 ? Math.round((actual / budget) * 100) : null,
      };
    });
}

/** 大分類の、月の並びの月の予算の合計（どの月にも無ければ null）。 */
function manualBudgetIn(budgets: readonly MoneyBudget[], topId: string, keys: readonly string[]): number | null {
  const monthly = keys.map((key) => budgetFor(budgets, topId, key)).filter((value): value is number => value !== null);
  return monthly.length === 0 ? null : monthly.reduce((sum, value) => sum + value, 0);
}

/** 大分類（の小分類）の予算の明細の、月の並びに発生する回の合計。2か月以上なら発生月なしも年に1回ぶん。明細が無ければ null。 */
function lineBudgetIn(
  lines: readonly MoneyBudgetLine[],
  categories: readonly MoneyCategory[],
  topId: string,
  keys: readonly string[],
): number | null {
  const own = lines.filter((line) => topCategoryIdOf(categories, line.categoryId) === topId);
  if (own.length === 0) return null;
  let total = 0;
  for (const line of own) {
    if (line.noMonth) {
      if (keys.length < 2) continue;
      for (const year of new Set(keys.map(yearOfMonth))) total += noMonthYearAmount(line, budgetLineGroup(line, categories), year);
      continue;
    }
    for (const key of keys) if (budgetLineMonths(line, yearOfMonth(key)).includes(Number(key.slice(5, 7)))) total += line.amount;
  }
  return total;
}

export interface MonthSummary {
  /** 収入。 */
  income: number;
  /** 支出の実績（生活費。振替は入れない）。 */
  living: number;
  /** 予算の合計（予算を置いた大分類だけ）。 */
  livingBudget: number;
  /** 収支＝収入 − 支出。貯金は記録なので式に入れない。 */
  balance: number;
  /** 予算どおりなら残る予定だった額＝収入 − 予算の合計。 */
  plannedBalance: number;
}

export function buildMonthSummary(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  monthKey: string,
): MonthSummary {
  let income = 0;
  let living = 0;
  for (const record of recordsInMonth(records, monthKey)) {
    // 振替（貯金への振替を含む）は集計に入れない。
    if (record.kind === 'transfer') continue;
    for (const item of record.items) {
      if (record.kind === 'income') income += item.amount;
      // 削除したカテゴリの品目（名前だけ残っている）も合計には数える。
      else if (item.categoryId !== null || item.categoryName !== '') living += item.amount;
    }
  }
  const livingBudget = topCategories(categories, 'living').reduce(
    (sum, category) => sum + (budgetFor(budgets, category.id, monthKey) ?? 0),
    0,
  );
  return {
    income,
    living,
    livingBudget,
    balance: income - living,
    plannedBalance: income - livingBudget,
  };
}

/** 年の月の並び（1月→12月）の YYYY-MM。 */
export function yearMonthKeys(year: number): string[] {
  return Array.from({ length: 12 }, (_, index) => `${year}-${pad2(index + 1)}`);
}

/** 月（YYYY-MM）が属する年（暦年）。 */
export const yearOfMonth = (monthKey: string): number => Number(monthKey.slice(0, 4));

/** 年の表示（振り返りの年）。 */
export const formatYear = (year: number) => `${year}年`;

/** 金額の入力を読む。「30,500」「¥30500」「３０５００円」を受け付ける。空・負・小数・読めないものは null。 */
export function parseAmountInput(text: string): number | null {
  const normalized = text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[¥￥,，円\s]/g, '');
  if (!/^\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) ? value : null;
}

export interface YearMonthRow {
  monthKey: string;
  /** その月を数えるか。記録（振替だけは除く）があり、まだ来ていない月でないこと。 */
  recorded: boolean;
  income: number;
  living: number;
  /** 収支（収入 − 支出）。 */
  balance: number;
  /** 予算 − 実績。 */
  livingDiff: number;
  /** 年初からこの月までの収支の累計（数える月だけを足す。数えない月は、その前までの累計のまま）。 */
  cumulative: number;
}

export interface YearSummary {
  months: YearMonthRow[];
  /** 記録のある月だけの合計。 */
  total: Omit<YearMonthRow, 'monthKey' | 'recorded' | 'cumulative'>;
  /** 数える月の数。 */
  recordedMonths: number;
  /** 数える月の平均（円に丸める）。数える月が無ければ null。 */
  average: { income: number; living: number; balance: number } | null;
}

/**
 * 年の収支（docs/kakei.md §4.2・§0.4）。月ごとの 収入・支出・収支・年初からの累計 と、年間の合計・月平均。
 * 数えるのは記録のある月だけ（記録の無い月・振替だけの月は数えない。使い始める前の月まで予算が残ったように見えないように）。
 * 記録は2026年10月から（それより前の記録は切り替えで削除した）なので、年は自然に10月から数える。
 * upTo（YYYY-MM）より後の月は、まだ来ていないので数えない。
 */
export function buildYearSummary(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  year: number,
  upTo: string,
): YearSummary {
  const total = { income: 0, living: 0, balance: 0, livingDiff: 0 };
  let recordedMonths = 0;
  let cumulative = 0;
  const months = yearMonthKeys(year).map((monthKey) => {
    const recorded =
      monthKey <= upTo &&
      recordsInMonth(records, monthKey).some((record) => record.kind !== 'transfer');
    if (!recorded) return { monthKey, recorded, income: 0, living: 0, balance: 0, livingDiff: 0, cumulative };
    const summary = buildMonthSummary(records, categories, budgets, monthKey);
    cumulative += summary.balance;
    const row = {
      monthKey,
      recorded,
      income: summary.income,
      living: summary.living,
      balance: summary.balance,
      livingDiff: summary.livingBudget - summary.living,
      cumulative,
    };
    recordedMonths += 1;
    total.income += row.income;
    total.living += row.living;
    total.balance += row.balance;
    total.livingDiff += row.livingDiff;
    return row;
  });
  const average =
    recordedMonths === 0
      ? null
      : {
          income: Math.round(total.income / recordedMonths),
          living: Math.round(total.living / recordedMonths),
          balance: Math.round(total.balance / recordedMonths),
        };
  return { months, total, recordedMonths, average };
}

/** その月の年初からの収支の累計。その月を数えない（記録なし・振替だけ）ときは null。 */
export function yearToDateBalance(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  monthKey: string,
): number | null {
  const summary = buildYearSummary(records, categories, budgets, yearOfMonth(monthKey), monthKey);
  const row = summary.months.find((entry) => entry.monthKey === monthKey);
  return row && row.recorded ? row.cumulative : null;
}

// ---- 振り返り・年間予算の支出の分け方（docs/kakei.md §0.7。2026-10-22） ----
// 支出の品目を、変動費・予備費・固定費（確定・見込み）に分ける。大分類の予算の分け方（budgetGroup）だけで決める
// （自動記録ルール・予算の有無は関係しない）。カテゴリの無い品目・削除したカテゴリの品目は変動費。

export type SpendGroup = 'variable' | 'reserve' | 'confirmed' | 'estimate';

/** 支出の品目（小分類）が、どの分け方に入るか。 */
export function spendGroupOf(categoryId: string | null, categories: readonly MoneyCategory[]): SpendGroup {
  if (categoryId === null) return 'variable';
  const topId = topCategoryIdOf(categories, categoryId);
  const group = categories.find((category) => category.id === topId)?.budgetGroup ?? 'variable';
  return group === 'fixed' ? 'confirmed' : group;
}

export interface IncomePart {
  /** 収入の大分類（無ければ null）。 */
  categoryId: string | null;
  name: string;
  amount: number;
}

export interface PeriodSummary {
  /** 収入の大分類ごと（カテゴリの並び。額のあるものだけ）。 */
  income: IncomePart[];
  incomeTotal: number;
  variable: number;
  reserve: number;
  confirmed: number;
  estimate: number;
  expenseTotal: number;
}

/** 期間（月の並び）の収入（大分類ごと）と、支出の分け方ごとの額。振替は数えない。 */
export function periodSummary(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  monthKeys: readonly string[],
): PeriodSummary {
  const incomeByTop = new Map<string | null, number>();
  const groups = { variable: 0, reserve: 0, confirmed: 0, estimate: 0 };
  for (const monthKey of monthKeys) {
    for (const record of recordsInMonth(records, monthKey)) {
      if (record.kind === 'transfer') continue;
      for (const item of record.items) {
        if (record.kind === 'income') {
          const topId = item.categoryId === null ? null : topCategoryIdOf(categories, item.categoryId);
          incomeByTop.set(topId, (incomeByTop.get(topId) ?? 0) + item.amount);
        } else if (item.categoryId !== null || item.categoryName !== '') {
          groups[spendGroupOf(item.categoryId, categories)] += item.amount;
        }
      }
    }
  }
  const income: IncomePart[] = topCategories(categories, 'income', true)
    .map((category) => ({ categoryId: category.id as string | null, name: category.name, amount: incomeByTop.get(category.id) ?? 0 }))
    .filter((part) => part.amount > 0);
  const other = [...incomeByTop].filter(([id]) => id === null || !income.some((part) => part.categoryId === id));
  const otherAmount = other.reduce((sum, [, amount]) => sum + amount, 0);
  if (otherAmount > 0) income.push({ categoryId: null, name: 'その他', amount: otherAmount });
  return {
    income,
    incomeTotal: income.reduce((sum, part) => sum + part.amount, 0),
    ...groups,
    expenseTotal: groups.variable + groups.reserve + groups.confirmed + groups.estimate,
  };
}

/**
 * 変動費の大分類（予算の分け方が変動費）ごとの予算と実績（カテゴリの並び）。
 * 予算のある大分類と、予算は無いが実績がある大分類を出す。
 */
export function variableTiles(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  monthKeys: readonly string[],
): BudgetTile[] {
  const spend = new Map<string, number>();
  for (const monthKey of monthKeys) {
    for (const record of recordsInMonth(records, monthKey)) {
      if (record.kind !== 'expense') continue;
      for (const item of record.items) {
        if (item.categoryId === null) continue;
        if (spendGroupOf(item.categoryId, categories) !== 'variable') continue;
        const topId = topCategoryIdOf(categories, item.categoryId);
        if (topId !== null) spend.set(topId, (spend.get(topId) ?? 0) + item.amount);
      }
    }
  }
  return topCategories(categories, 'living', true)
    .filter((category) => category.budgetGroup === 'variable')
    .map((category) => {
      const monthly = monthKeys.map((key) => budgetFor(budgets, category.id, key)).filter((value): value is number => value !== null);
      const budget = monthly.length === 0 ? null : monthly.reduce((sum, value) => sum + value, 0);
      const actual = spend.get(category.id) ?? 0;
      return {
        category,
        budget,
        actual,
        diff: (budget ?? 0) - actual,
        percent: budget !== null && budget > 0 ? Math.round((actual / budget) * 100) : null,
      };
    })
    .filter((tile) => tile.budget !== null || tile.actual > 0);
}

/** 期間（月の並び）に、その小分類で使った額（支出の品目）。 */
export function categorySpentIn(records: readonly MoneyRecord[], categoryId: string, monthKeys: readonly string[]): number {
  let total = 0;
  for (const monthKey of monthKeys) {
    for (const record of recordsInMonth(records, monthKey)) {
      if (record.kind !== 'expense') continue;
      for (const item of record.items) if (item.categoryId === categoryId) total += item.amount;
    }
  }
  return total;
}

export interface FixedSpend {
  record: MoneyRecord;
  categoryId: string;
  mode: 'confirmed' | 'estimate';
  amount: number;
}

/** その月に記録があった固定費（品目を小分類ごとにまとめた1行。日付の順）。 */
export function fixedSpendInMonth(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  monthKey: string,
): FixedSpend[] {
  const list: FixedSpend[] = [];
  for (const record of recordsInMonth(records, monthKey)) {
    if (record.kind !== 'expense') continue;
    const byCategory = new Map<string, FixedSpend>();
    for (const item of record.items) {
      if (item.categoryId === null) continue;
      const group = spendGroupOf(item.categoryId, categories);
      if (group !== 'confirmed' && group !== 'estimate') continue;
      const entry = byCategory.get(item.categoryId) ?? { record, categoryId: item.categoryId, mode: group, amount: 0 };
      entry.amount += item.amount;
      byCategory.set(item.categoryId, entry);
    }
    list.push(...byCategory.values());
  }
  return list.sort((a, b) => (a.record.occurredOn < b.record.occurredOn ? -1 : a.record.occurredOn > b.record.occurredOn ? 1 : 0));
}

export interface FixedBudgetRow {
  categoryId: string;
  mode: 'confirmed' | 'estimate';
  /** その年の予算（明細の合計）。 */
  budget: number;
  /** upTo の月までに発生する回の予算（発生月なしは入れない）。 */
  budgetToDate: number;
  /** upTo の月までの実績。 */
  actual: number;
}

/**
 * 固定費（確定・見込み）の小分類ごとの、その年の予算・upTo（YYYY-MM）までに発生する回の予算・upTo までの実績（カテゴリの並び）。
 * 予算も実績も無い小分類は出さない。年の振り返りで、予算と違ったもの（実績と、その月までの予算の差）を出すのに使う。
 */
export function fixedBudgetRows(
  lines: readonly MoneyBudgetLine[],
  categories: readonly MoneyCategory[],
  records: readonly MoneyRecord[],
  year: number,
  upTo: string,
): FixedBudgetRow[] {
  const keys = yearMonthKeys(year).filter((key) => key <= upTo);
  const rows: FixedBudgetRow[] = [];
  for (const top of topCategories(categories, 'living', true)) {
    if (top.budgetGroup !== 'fixed' && top.budgetGroup !== 'estimate') continue;
    for (const child of childCategories(categories, top.id, true)) {
      const own = lines.filter((line) => line.categoryId === child.id);
      const budget = own.reduce((sum, line) => sum + budgetLineYearAmount(line, year), 0);
      const budgetToDate = own.reduce(
        (sum, line) => sum + line.amount * budgetLineMonths(line, year).filter((month) => `${year}-${pad2(month)}` <= upTo).length,
        0,
      );
      const actual = categorySpentIn(records, child.id, keys);
      if (budget === 0 && actual === 0) continue;
      rows.push({ categoryId: child.id, mode: top.budgetGroup === 'fixed' ? 'confirmed' : 'estimate', budget, budgetToDate, actual });
    }
  }
  return rows;
}

export interface LandingMonth {
  monthKey: string;
  /** 着地見込みに数えるか（使い始めた月から）。 */
  counted: boolean;
  /** 締めた月（収支は実額）。締めていない月は見込み。 */
  closed: boolean;
  /** 収入（締めた月は実額、ほかは予算）。 */
  income: number;
  /** 支出（締めた月は実額。締めていない今月まで〔締め忘れた月も〕は予算と実績の大きいほう、翌月からは予算）。 */
  expense: number;
  /** 収支（収入 − 支出）。 */
  balance: number;
  /** 年初からこの月までの累計（数えない月は、その前までの累計のまま）。 */
  cumulative: number;
}

export interface YearLanding {
  months: LandingMonth[];
  /** 年末の収支見込み（12月の累計。発生月なしの見込みを含む）。 */
  total: number;
  /** 年の収入の見込み（締めた月は実額、ほかは予算）。 */
  income: number;
  /** 年の支出の見込み（発生月なしの見込みを含む）。 */
  expense: number;
  /** 締めた月の数。 */
  closedMonths: number;
  /** 発生月なしの予算の見込み（収入 − 支出。まだ記録が無い分。12月の収支に入れてある）。 */
  unscheduled: number;
}

/**
 * 年末の収支見込み（docs/kakei.md §0.9・§4.6。2026-10-24）。
 * - 締めた月は実績（収入も支出も）
 * - 締めていない月のうち、今月まで（current。締め忘れた過去の月も）は記録があるので、支出は予算と実績の大きいほう
 *   （変動費は大分類ごと、予備費・固定費は小分類ごと。予算の無いもの・カテゴリの無い品目は実績）。収入は予算
 * - 翌月からは記録が無いので予算だけ（収入 − 変動費の月の予算 − 予備費・固定費の明細のうち、その月に発生する回）
 * - 発生月なしの予算は、小分類ごとに「その年の額（noMonthYearAmount）− 今月までの実績」（0 未満は 0）を見込み支出として12月に入れる（12月を締めた年は入れない）
 * 数えるのは使い始めた月（usageStartMonth。2026年は10月から）から。記録が1件も無ければ null。先の年は全部の月を予算で出す。自動記録ルールは使わない。
 */
export function buildYearLanding(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  lines: readonly MoneyBudgetLine[],
  closings: readonly MoneyMonth[],
  year: number,
  current: string = monthKeyOfDate(new Date()),
): YearLanding | null {
  const start = usageStartMonth(records);
  if (start === null || start > `${year}-12`) return null;
  const plan = budgetPlanInYear(lines, categories, year);
  const variableTops = topCategories(categories, 'living').filter((category) => category.budgetGroup === 'variable');
  const recordedKeys = yearMonthKeys(year).filter((monthKey) => monthKey >= start && monthKey <= current);
  const unscheduled = isMonthClosed(closings, `${year}-12`) ? 0 : unscheduledForecast(lines, categories, records, year, recordedKeys);
  let cumulative = 0;
  let closedMonths = 0;
  let incomeTotal = 0;
  let expenseTotal = 0;
  const months = yearMonthKeys(year).map((monthKey, index): LandingMonth => {
    if (monthKey < start) return { monthKey, counted: false, closed: false, income: 0, expense: 0, balance: 0, cumulative };
    const closed = isMonthClosed(closings, monthKey);
    let income: number;
    let expense: number;
    if (closed) {
      const summary = buildMonthSummary(records, categories, budgets, monthKey);
      income = summary.income;
      expense = summary.living;
      closedMonths += 1;
    } else {
      income = plan.months.income[index];
      expense =
        monthKey <= current
          ? expenseWithActuals(records, categories, budgets, lines, monthKey)
          : variableTops.reduce((sum, category) => sum + (manualBudgetFor(budgets, category.id, monthKey) ?? 0), 0) +
            plan.months.variable[index] +
            plan.months.reserve[index] +
            plan.months.confirmed[index] +
            plan.months.estimate[index];
      if (index === 11) expense -= unscheduled;
    }
    incomeTotal += income;
    expenseTotal += expense;
    cumulative += income - expense;
    return { monthKey, counted: true, closed, income, expense, balance: income - expense, cumulative };
  });
  return { months, total: cumulative, income: incomeTotal, expense: expenseTotal, closedMonths, unscheduled };
}

/**
 * 締めていない今月まで（締め忘れた月も）の、その月の支出の見込み＝予算と実績の大きいほうの合計。
 * 変動費は大分類ごと（月の予算）、予備費・固定費は小分類ごと（その月に発生する明細）。発生月なしの小分類・予算の無いもの・
 * カテゴリの無い品目は実績（発生月なしの残りは12月に入れる）。
 */
function expenseWithActuals(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  lines: readonly MoneyBudgetLine[],
  monthKey: string,
): number {
  const year = yearOfMonth(monthKey);
  const month = Number(monthKey.slice(5, 7));
  const budget = new Map<string, number>();
  for (const top of topCategories(categories, 'living')) {
    if (top.budgetGroup !== 'variable') continue;
    const amount = manualBudgetFor(budgets, top.id, monthKey);
    if (amount !== null) budget.set(`top:${top.id}`, amount);
  }
  for (const line of lines) {
    if (line.noMonth || budgetLineGroup(line, categories) === 'income') continue;
    if (!budgetLineMonths(line, year).includes(month)) continue;
    budget.set(`sub:${line.categoryId}`, (budget.get(`sub:${line.categoryId}`) ?? 0) + line.amount);
  }
  const actual = new Map<string, number>();
  let other = 0;
  for (const record of recordsInMonth(records, monthKey)) {
    if (record.kind !== 'expense') continue;
    for (const item of record.items) {
      const topId = item.categoryId === null ? null : topCategoryIdOf(categories, item.categoryId);
      const top = topId === null ? undefined : categories.find((category) => category.id === topId);
      if (top === undefined) {
        // 削除したカテゴリの品目（名前だけ残っている）も支出に数える（buildMonthSummary と同じ）。
        if (item.categoryId !== null || item.categoryName !== '') other += item.amount;
        continue;
      }
      const key = top.budgetGroup === 'variable' ? `top:${top.id}` : `sub:${item.categoryId}`;
      actual.set(key, (actual.get(key) ?? 0) + item.amount);
    }
  }
  let total = other;
  for (const key of new Set([...budget.keys(), ...actual.keys()])) total += Math.max(budget.get(key) ?? 0, actual.get(key) ?? 0);
  return total;
}

/** 発生月なしの予算の見込み（収入 − 支出）。小分類ごとに、その年の額（noMonthYearAmount）− monthKeys の実績（0 未満は 0）。 */
function unscheduledForecast(
  lines: readonly MoneyBudgetLine[],
  categories: readonly MoneyCategory[],
  records: readonly MoneyRecord[],
  year: number,
  monthKeys: readonly string[],
): number {
  const byCategory = new Map<string, number>();
  for (const line of lines) {
    if (!line.noMonth) continue;
    const amount = noMonthYearAmount(line, budgetLineGroup(line, categories), year);
    if (amount === 0) continue;
    byCategory.set(line.categoryId, (byCategory.get(line.categoryId) ?? 0) + amount);
  }
  let total = 0;
  for (const [categoryId, amount] of byCategory) {
    const income = categories.find((category) => category.id === categoryId)?.kind === 'income';
    let actual = 0;
    for (const monthKey of monthKeys) {
      for (const record of recordsInMonth(records, monthKey)) {
        if (record.kind !== (income ? 'income' : 'expense')) continue;
        for (const item of record.items) if (item.categoryId === categoryId) actual += item.amount;
      }
    }
    const left = Math.max(0, amount - actual);
    total += income ? left : -left;
  }
  return total;
}

export interface YearComparison {
  /** 比べた月の数（今年の数える月のうち、前の年の同じ月も数えられるもの）。 */
  months: number;
  /** 今年のその月ぶんの収支の合計。 */
  balance: number;
  /** 前の年の同じ月ぶんの収支の合計。 */
  previousBalance: number;
  /** balance − previousBalance。 */
  diff: number;
}

/**
 * 前の年の同じ月ぶんとの比べ（docs/kakei.md §0.4）。今年の数える月のうち、前の年の同じ月も数えられるものだけを比べる
 * （使い始めの年は12か月ぶんそろわないので、月数をそろえて比べる）。比べられる月が無ければ null。
 */
export function compareWithPreviousYear(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  year: number,
  upTo: string,
): YearComparison | null {
  const current = buildYearSummary(records, categories, budgets, year, upTo);
  const previous = buildYearSummary(records, categories, budgets, year - 1, `${year - 1}-12`);
  let months = 0;
  let balance = 0;
  let previousBalance = 0;
  current.months.forEach((row, index) => {
    const before = previous.months[index];
    if (!row.recorded || !before.recorded) return;
    months += 1;
    balance += row.balance;
    previousBalance += before.balance;
  });
  return months === 0 ? null : { months, balance, previousBalance, diff: balance - previousBalance };
}

// ---- 内訳の分析（振り返りの内訳をタップしたとき。docs/kakei.md §4.4） ----

export interface CategoryAnalysis {
  /** 見ている期間の実績。 */
  actual: number;
  /** 期間の予算（月の予算を足したもの）。未設定は null。 */
  budget: number | null;
  /** 予算 − 実績（マイナスは超えた額）。予算が無ければ −実績。 */
  diff: number;
  /** 使った割合（%）。 */
  percent: number | null;
  /** 前の期間（月なら前の月、年なら前の年）の実績。 */
  previous: number | null;
  /** 小分類ごとの実績（多い順）。大分類そのものに付けた品目は「その他」。 */
  children: { id: string; name: string; amount: number }[];
  /** 見ている期間の月ごとの実績と、その月の予算（1月→12月、見ている期間に含まれる月だけ）。 */
  months: { monthKey: string; amount: number; budget: number | null }[];
  /** この大分類の記録（品目をこの大分類のものだけに絞った）。新しい順は RecordDayList が並べる。 */
  records: MoneyRecord[];
}

/** 月の集まり（monthKeys）に含まれる記録のうち、keep が true の品目だけを残した記録。品目が残らない記録は落とす。 */
function narrowRecords(
  records: readonly MoneyRecord[],
  monthKeys: readonly string[],
  keep: (item: MoneyItem, record: MoneyRecord) => boolean,
): MoneyRecord[] {
  const months = new Set(monthKeys);
  const narrowed: MoneyRecord[] = [];
  for (const record of records) {
    if (record.kind !== 'expense' || !months.has(monthKeyOf(record.occurredOn))) continue;
    const items = record.items.filter((item) => keep(item, record));
    if (items.length > 0) narrowed.push({ ...record, items });
  }
  return narrowed;
}

/**
 * 内訳の1つの大分類を、見ている期間（monthKeys。月なら1つ、年なら記録のある月）で分析する。
 * previousKeys は前の期間の月（無ければ null）。
 */
export function buildCategoryAnalysis(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  topId: string,
  monthKeys: readonly string[],
  previousKeys: readonly string[] | null,
): CategoryAnalysis {
  const inTop = (item: MoneyItem) =>
    item.categoryId !== null && topCategoryIdOf(categories, item.categoryId) === topId;
  const narrowed = narrowRecords(records, monthKeys, (item) => inTop(item));
  const sum = (list: readonly MoneyRecord[]) =>
    list.reduce((total, record) => total + record.items.reduce((inner, item) => inner + item.amount, 0), 0);
  const actual = sum(narrowed);

  const monthly = monthKeys
    .map((key) => budgetFor(budgets, topId, key))
    .filter((value): value is number => value !== null);
  const budget = monthly.length === 0 ? null : monthly.reduce((total, value) => total + value, 0);

  const byChild = new Map<string, number>();
  for (const record of narrowed) {
    for (const item of record.items) {
      const key = item.categoryId === topId || item.categoryId === null ? '' : item.categoryId;
      byChild.set(key, (byChild.get(key) ?? 0) + item.amount);
    }
  }
  const children = [...byChild.entries()]
    .map(([id, amount]) => ({
      id: id === '' ? topId : id,
      name: id === '' ? 'その他' : (categories.find((category) => category.id === id)?.name ?? 'その他'),
      amount,
    }))
    .sort((a, b) => b.amount - a.amount);

  const months = monthKeys.map((key) => ({
    monthKey: key,
    amount: sum(narrowed.filter((record) => monthKeyOf(record.occurredOn) === key)),
    budget: budgetFor(budgets, topId, key),
  }));
  const previous = previousKeys === null ? null : sum(narrowRecords(records, previousKeys, (item) => inTop(item)));

  return {
    actual,
    budget,
    diff: (budget ?? 0) - actual,
    percent: budget !== null && budget > 0 ? Math.round((actual / budget) * 100) : null,
    previous,
    children,
    months,
    records: narrowed,
  };
}

// ---- 振り返りの種類ごとの一覧（docs/kakei.md §0.9。2026-10-24） ----
// 振り返り（月・年）は、予算に対して見る。並びは 変動費 → 予備費 → 固定費（中に確定・見込み）→ カテゴリなし。
// - 変動費: 大分類ごと。予算 − 実績・使った割合の帯（buildBudgetTiles と同じ）
// - 予備費: 記録のあった小分類だけ。年は年の予算（発生月なしは noMonthYearAmount）と比べ、月は額だけ（予算が月に割り当たらない）
// - 固定費: 記録のあった小分類だけ。額は記録の合計で、確定は額だけ、見込みは記録のあった月の予算との差を添える
// - カテゴリなし: カテゴリの無い品目（削除したカテゴリの品目を含む）

export interface ReviewSubRow {
  /** 小分類（大分類そのものに付けた品目は大分類）。 */
  category: MoneyCategory;
  /** 期間の実績。 */
  actual: number;
  /** 比べる予算（無ければ null）。予備費は年だけ、見込みは記録のあった月の分（年は発生月なしも）、確定は null。 */
  budget: number | null;
}

export interface ReviewSections {
  variable: BudgetTile[];
  reserve: ReviewSubRow[];
  confirmed: ReviewSubRow[];
  estimate: ReviewSubRow[];
  /** カテゴリの無い品目（削除したカテゴリの品目を含む）。 */
  uncategorized: { count: number; amount: number };
  /** 種類ごとの実績（目安の割合に使う。固定費は確定＋見込み。カテゴリの無い品目は入れない）。 */
  spend: { variable: number; reserve: number; fixed: number };
}

/** 振り返りの「カテゴリなし」の行を開いたときの、仮のカテゴリ。 */
export const UNCATEGORIZED: MoneyCategory = {
  id: 'uncategorized',
  kind: 'living',
  parentId: null,
  name: 'カテゴリなし',
  icon: null,
  iconColor: null,
  position: 0,
  archived: false,
  budgetGroup: 'variable',
};

/** 品目のカテゴリが、今あるカテゴリか（無い・削除したものは false）。 */
const knownCategory = (categories: readonly MoneyCategory[], categoryId: string | null): MoneyCategory | undefined =>
  categoryId === null ? undefined : categories.find((category) => category.id === categoryId);

/** 見ている期間（monthKeys。月なら1つ、年なら数える月）の、振り返りの種類ごとの一覧。year は年の振り返りか。 */
export function buildReviewSections(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  lines: readonly MoneyBudgetLine[],
  monthKeys: readonly string[],
  year: boolean,
): ReviewSections {
  const keys = new Set(monthKeys);
  // 小分類ごと・月ごとの実績（予備費・固定費）
  const subActual = new Map<string, Map<string, number>>();
  const spend = { variable: 0, reserve: 0, fixed: 0 };
  const uncategorized = { count: 0, amount: 0 };
  for (const record of records) {
    if (record.kind !== 'expense') continue;
    const monthKey = monthKeyOf(record.occurredOn);
    if (!keys.has(monthKey)) continue;
    for (const item of record.items) {
      if (knownCategory(categories, item.categoryId) === undefined) {
        // カテゴリも名前も無い品目は、支出にも数えない（buildMonthSummary と同じ）
        if (item.categoryId === null && item.categoryName === '') continue;
        uncategorized.count += 1;
        uncategorized.amount += item.amount;
        continue;
      }
      const group = spendGroupOf(item.categoryId, categories);
      if (group === 'variable') {
        spend.variable += item.amount;
        continue;
      }
      if (group === 'reserve') spend.reserve += item.amount;
      else spend.fixed += item.amount;
      const byMonth = subActual.get(item.categoryId as string) ?? new Map<string, number>();
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + item.amount);
      subActual.set(item.categoryId as string, byMonth);
    }
  }
  const subBudget = (categoryId: string, group: SpendGroup, byMonth: Map<string, number>): number | null => {
    if (group === 'confirmed' || (group === 'reserve' && !year)) return null;
    const own = lines.filter((line) => line.categoryId === categoryId);
    // 月は発生月なしの予算を比べない（どの月に出るか決めていない）。発生月のある予算が無ければ額だけ
    if (own.length === 0 || (!year && own.every((line) => line.noMonth))) return null;
    // 予備費は見ている期間の月すべて、見込みは記録のあった月だけ
    const months = group === 'reserve' ? monthKeys : [...byMonth.keys()];
    let total = 0;
    for (const line of own) {
      if (line.noMonth) {
        if (year) for (const y of new Set(monthKeys.map(yearOfMonth))) total += noMonthYearAmount(line, group, y);
        continue;
      }
      for (const monthKey of months) {
        if (budgetLineMonths(line, yearOfMonth(monthKey)).includes(Number(monthKey.slice(5, 7)))) total += line.amount;
      }
    }
    return total;
  };
  // 小分類の行（カテゴリの並び。大分類の並び → その中の並び。大分類に直接付けた品目は大分類の名前で先頭に）
  const rowsOf = (group: SpendGroup): ReviewSubRow[] => {
    const rows: ReviewSubRow[] = [];
    for (const top of topCategories(categories, 'living', true)) {
      if (spendGroupOf(top.id, categories) !== group) continue;
      for (const category of [top, ...childCategories(categories, top.id, true)]) {
        const byMonth = subActual.get(category.id);
        if (byMonth === undefined) continue;
        const actual = [...byMonth.values()].reduce((sum, value) => sum + value, 0);
        rows.push({ category, actual, budget: subBudget(category.id, group, byMonth) });
      }
    }
    return rows;
  };
  return {
    variable: buildBudgetTiles(records, categories, budgets, monthKeys, lines).filter(
      (tile) => tile.category.budgetGroup === 'variable' && (tile.budget !== null || tile.actual > 0),
    ),
    reserve: rowsOf('reserve'),
    confirmed: rowsOf('confirmed'),
    estimate: rowsOf('estimate'),
    uncategorized,
    spend,
  };
}

/** 目安の割合の、実績の割合（%。整数に丸める）。収入が0以下なら null。 */
export const spendRatio = (spend: number, income: number): number | null => (income > 0 ? Math.round((spend / income) * 100) : null);

/**
 * 予備費・固定費の小分類（categoryId）、またはカテゴリの無い品目（UNCATEGORIZED.id）の、見ている期間の記録と実績。
 * 振り返りの小分類の行を押したときの画面（記録の一覧）に使う。budget は行と同じ比べる予算。
 */
export function buildSubcategoryAnalysis(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  categoryId: string,
  monthKeys: readonly string[],
  budget: number | null,
): CategoryAnalysis {
  const keep = (item: MoneyItem) =>
    categoryId === UNCATEGORIZED.id ? knownCategory(categories, item.categoryId) === undefined : item.categoryId === categoryId;
  const narrowed = narrowRecords(records, monthKeys, keep);
  const sum = (list: readonly MoneyRecord[]) =>
    list.reduce((total, record) => total + record.items.reduce((inner, item) => inner + item.amount, 0), 0);
  const actual = sum(narrowed);
  return {
    actual,
    budget,
    diff: (budget ?? 0) - actual,
    percent: budget !== null && budget > 0 ? Math.round((actual / budget) * 100) : null,
    previous: null,
    children: [],
    months: monthKeys.map((key) => ({ monthKey: key, amount: sum(narrowed.filter((record) => monthKeyOf(record.occurredOn) === key)), budget: null })),
    records: narrowed,
  };
}

/**
 * 集計を始めた月（2026-10-24。docs/kakei.md §0.9）。家計は2026年の途中から始めたので、2026年は10〜12月の3か月だけを数える。
 * 9月の記録はカードの引き落とし額を合わせるためだけに入れたもので、振り返り・収支見込みに入れず、締めの確認も出さない。
 * 2026年だけの特例で、2027年からはその年すべて（1〜12月）。
 */
export const MONEY_COUNT_START = '2026-10';

/**
 * 使い始めた月（振替でない記録がいちばん古い月。ただし集計を始めた月〔MONEY_COUNT_START〕より前にはしない。YYYY-MM）。
 * 記録が1件も無ければ null。
 */
export function usageStartMonth(records: readonly MoneyRecord[]): string | null {
  let start: string | null = null;
  for (const record of records) {
    if (record.kind === 'transfer') continue;
    const monthKey = monthKeyOf(record.occurredOn);
    if (start === null || monthKey < start) start = monthKey;
  }
  return start === null ? null : start < MONEY_COUNT_START ? MONEY_COUNT_START : start;
}

/**
 * 発生月なしの予算の、その年に数える額（かからない年は0）。集計を始めた年（2026年）だけは、数える月が3か月なので、
 * 予備費は年の額 × 数える月 / 12（円に丸める）、固定費（確定・見込み。ふるさと納税・自治会費・祭礼費）はその年はもう済んでいたので0
 * （2026-10-24。docs/kakei.md §0.9）。年間予算の画面（年の予算そのもの）には使わない。
 */
export function noMonthYearAmount(line: MoneyBudgetLine, group: BudgetLineGroup, year: number): number {
  if (!budgetLineInYear(line, year)) return 0;
  if (year !== yearOfMonth(MONEY_COUNT_START)) return line.amount;
  if (group === 'confirmed' || group === 'estimate') return 0;
  if (group === 'reserve') return Math.round((line.amount * (13 - Number(MONEY_COUNT_START.slice(5, 7)))) / 12);
  return line.amount;
}

/**
 * その年の予算がかかる月。**その年すべて（1〜12月）**で数えるが、使い始めた年だけは、使い始めた月から12月まで
 * （使い始める前の月まで予算が残ったように見えないように。2026年は10月から使い始めたので10〜12月の3か月ぶん。2027年からは12か月）。
 * 年の振り返りの予算・実績は、この月の分で比べる。記録が1件も無ければ空。
 */
export function yearActiveMonthKeys(records: readonly MoneyRecord[], year: number): string[] {
  const start = usageStartMonth(records);
  return start === null ? [] : yearMonthKeys(year).filter((monthKey) => monthKey >= start);
}

/**
 * 年の振り返りの、1つの大分類の年末の着地見込み（2026-10-16）＝**締めた月は実績、ほかの月は月の予算**（予算が無い月は、締めた月の平均。それも無ければ 0）。
 * 年全体の着地見込み（buildYearLanding）と同じく、締めていない月は実績を使わない。months は buildCategoryAnalysis の月ごと。
 */
export function categoryYearLanding(
  months: readonly { monthKey: string; amount: number; budget: number | null }[],
  closedKeys: ReadonlySet<string>,
): number {
  const closed = months.filter((entry) => closedKeys.has(entry.monthKey));
  const average = closed.length === 0 ? null : Math.round(closed.reduce((sum, entry) => sum + entry.amount, 0) / closed.length);
  return months.reduce((sum, entry) => sum + (closedKeys.has(entry.monthKey) ? entry.amount : (entry.budget ?? average ?? 0)), 0);
}

// ---- 記録の入力（記録の詳細・品目の画面）の形 ----

/** 品目の画面の1行。金額は 個数 × 単価。 */
export interface EditorLine {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  memo: string;
  /** レシートに印字された品名そのまま（読み取りで入れた行だけ。docs/kakei.md §10.3）。 */
  receiptName?: string | null;
}

/** 品目のカテゴリのまとまり（記録の詳細の1行、品目の画面1枚）。 */
export interface EditorGroup {
  key: string;
  categoryId: string | null;
  /** 削除したカテゴリの名前（categoryId が null のとき）。 */
  categoryName: string;
  lines: EditorLine[];
}

export const editorLineAmount = (line: Pick<EditorLine, 'quantity' | 'unitPrice'>) => line.unitPrice * line.quantity;

export const editorGroupTotal = (group: Pick<EditorGroup, 'lines'>) =>
  group.lines.reduce((sum, line) => sum + editorLineAmount(line), 0);

/** 品名も金額も無い行（空の行を押しただけ）。保存しない。 */
export const isBlankLine = (line: EditorLine) => line.name.trim() === '' && line.unitPrice === 0;

/** 保存してある品目を、入力の形にする（カテゴリごとにまとめる）。 */
export function groupsFromItems(items: readonly MoneyItem[], nextKey: () => string): EditorGroup[] {
  return groupItems(items).map((group) => ({
    key: nextKey(),
    categoryId: group.categoryId,
    categoryName: group.categoryName,
    lines: group.items.map((item) => {
      // 金額だけの品目（単価なし）は、1個あたりに直す。割り切れなければ1個として扱う。
      const divisible = item.amount % item.quantity === 0;
      return {
        key: nextKey(),
        name: item.name,
        quantity: item.unitPrice === null && !divisible ? 1 : item.quantity,
        unitPrice: item.unitPrice ?? (divisible ? item.amount / item.quantity : item.amount),
        memo: item.memo,
        receiptName: item.receiptName ?? null,
      };
    }),
  }));
}

/** 入力の形を、保存する品目にする（空の行は落とす）。 */
export function itemsFromGroups(groups: readonly EditorGroup[]): MoneyItemDraft[] {
  return groups.flatMap((group) =>
    group.lines
      .filter((line) => !isBlankLine(line))
      .map((line) => ({
        amount: editorLineAmount(line),
        categoryId: group.categoryId,
        categoryName: group.categoryId === null ? group.categoryName : '',
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        name: line.name.trim(),
        memo: line.memo.trim(),
        receiptName: line.receiptName ?? null,
      })),
  );
}

/**
 * レシートの読み取りの品目を、入力の形にする（カテゴリごとにまとめる。読んだ順）。
 * カテゴリが決まらなかった品目は、カテゴリなしの1つのまとまりにする（「カテゴリを選んでください」。docs/kakei.md §10.4）。
 */
export function groupsFromScan(items: readonly ReceiptScanItem[], nextKey: () => string): EditorGroup[] {
  const groups: EditorGroup[] = [];
  for (const item of items) {
    let group = groups.find((entry) => entry.categoryId === item.categoryId);
    if (!group) {
      group = { key: nextKey(), categoryId: item.categoryId, categoryName: '', lines: [] };
      groups.push(group);
    }
    group.lines.push({
      key: nextKey(),
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      memo: '',
      receiptName: item.receiptName || null,
    });
  }
  return groups;
}

/** 同じカテゴリのまとまりか。 */
export const sameGroupTarget = (
  a: Pick<EditorGroup, 'categoryId' | 'categoryName'>,
  b: Pick<EditorGroup, 'categoryId' | 'categoryName'>,
) => a.categoryId === b.categoryId && (a.categoryId !== null || a.categoryName === b.categoryName);

// ---- 電卓（品目の金額。＋−×÷） ----

export type CalcOperator = '+' | '-' | '*' | '/';

/**
 * 電卓の式を計算する（× ÷ を先に）。結果は円に丸める。
 * 式が途中（演算子で終わる）なら、最後の演算子を無視して計算する。読めない・負・0で割るときは null。
 */
export function evaluateCalc(expression: string): number | null {
  const tokens = expression.match(/\d+|[+\-*/]/g);
  if (!tokens || tokens.join('') !== expression) return null;
  while (tokens.length > 0 && /[+\-*/]/.test(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length === 0 || !/^\d+$/.test(tokens[0])) return null;
  const terms: number[] = [Number(tokens[0])];
  const ops: string[] = [];
  for (let index = 1; index < tokens.length; index += 2) {
    const op = tokens[index];
    const value = Number(tokens[index + 1]);
    if (!/^\d+$/.test(tokens[index + 1] ?? '')) return null;
    if (op === '*' || op === '/') {
      const left = terms.pop()!;
      if (op === '/' && value === 0) return null;
      terms.push(op === '*' ? left * value : left / value);
    } else {
      terms.push(value);
      ops.push(op);
    }
  }
  let result = terms[0];
  ops.forEach((op, index) => {
    result = op === '+' ? result + terms[index + 1] : result - terms[index + 1];
  });
  const rounded = Math.round(result);
  return Number.isSafeInteger(rounded) && rounded >= 0 ? rounded : null;
}

/** 電卓の式の表示（* / を × ÷ に）。 */
export const formatCalc = (expression: string) => expression.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');

/** 電卓のキーを押したあとの式。key は数字・'00'・演算子・'back'。 */
export function pressCalcKey(expression: string, key: string): string {
  if (key === 'back') return expression.slice(0, -1);
  if (/^[+\-*/]$/.test(key)) {
    if (expression === '') return expression;
    return /[+\-*/]$/.test(expression) ? expression.slice(0, -1) + key : expression + key;
  }
  if (!/^\d+$/.test(key)) return expression;
  // 先頭の0は重ねない（「00」を最初に押しても0のまま）。
  const lastNumber = /\d+$/.exec(expression)?.[0] ?? '';
  if (lastNumber === '0') return expression.slice(0, -1) + (key === '00' ? '0' : key);
  if (lastNumber === '' && key === '00') return expression + '0';
  // 桁が増えすぎないように（1億円まで）。
  if (lastNumber.length + key.length > 9) return expression;
  return expression + key;
}

// ---- 口座の残高（docs/kakei.md §9.3） ----
// 残高 = 今日までの記録（支出・収入・振替）の合計 + 補正の増減の合計。
// 補正は日付と結ばない「ただの増減」なので、あとからどの日付の記録を足しても残高に入る（2026-10-24）。

/** 今日の日付（YYYY-MM-DD。端末のローカル）。 */
export const dateKeyOfDate = (date: Date): string => `${monthKeyOfDate(date)}-${pad2(date.getDate())}`;

/** マイナスは「¥−1,234」（¥が先頭）。残高の表示に使う（formatYen は符号を付けない）。 */
export const formatBalance = (value: number): string => `${YEN_MARK}${value < 0 ? '−' : ''}${Math.abs(value).toLocaleString('ja-JP')}`;

/**
 * 1件の記録が、出金元 walletId の残高に与える増減（円）。
 * 支出は出金元から減り、収入は入金先に増え、振替は出金元から減って入金先に増える。
 */
export function walletDelta(record: Pick<MoneyRecord, 'kind' | 'walletId' | 'toWalletId' | 'items'>, walletId: string): number {
  const total = recordTotal(record);
  if (record.kind === 'income') return record.walletId === walletId ? total : 0;
  const out = record.walletId === walletId ? -total : 0;
  const into = record.kind === 'transfer' && record.toWalletId === walletId ? total : 0;
  return out + into;
}

export interface WalletBalanceResult {
  /** 残高（円）。記録の合計 + 補正の増減の合計。 */
  amount: number;
  /** 記録の増減の合計。 */
  movement: number;
  /** 補正の増減の合計。 */
  adjustment: number;
  /** 数えた記録の件数。 */
  count: number;
}

/** 出金元 walletId の、date の終わりの残高。date までの記録と補正を数える（先の日付の記録は入れない）。 */
export function walletBalanceOn(
  walletId: string,
  date: string,
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
): WalletBalanceResult {
  let adjustment = 0;
  for (const balance of balances) {
    if (balance.walletId === walletId && balance.balanceOn <= date) adjustment += balance.adjustment;
  }
  let movement = 0;
  let count = 0;
  for (const record of records) {
    if (record.walletId !== walletId && record.toWalletId !== walletId) continue;
    if (record.occurredOn > date) continue;
    movement += walletDelta(record, walletId);
    count += 1;
  }
  return { amount: movement + adjustment, movement, adjustment, count };
}

export interface WalletBalanceRow extends WalletBalanceResult {
  wallet: MoneyWallet;
}

export interface WalletBalances {
  /** 出金元ごと（渡された順）。 */
  rows: WalletBalanceRow[];
  /** 総残高。使わなくした出金元は入れない。 */
  total: number;
}

/**
 * 出金元ごとの今の残高と総残高。asOf は今日（YYYY-MM-DD）。
 * 証券口座は記録からではなく、保有銘柄の評価額で数える（securitiesValueOn。docs/kakei.md §9.2.3）。
 */
export function buildWalletBalances(
  wallets: readonly MoneyWallet[],
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
  asOf: string,
  securities?: Pick<MoneySecuritiesData, 'holdings' | 'values'>,
): WalletBalances {
  const rows = wallets.map((wallet) =>
    wallet.type === 'securities'
      ? {
          wallet,
          amount: securities ? securitiesValueOn([wallet.id], securities.holdings, securities.values, asOf) : 0,
          movement: 0,
          adjustment: 0,
          count: 0,
        }
      : { wallet, ...walletBalanceOn(wallet.id, asOf, records, balances) },
  );
  const counted = rows.filter((row) => !row.wallet.archived);
  return {
    rows,
    total: counted.reduce((sum, row) => sum + row.amount, 0),
  };
}

export interface BalanceCheck {
  balance: MoneyWalletBalance;
  /** 補正の増減（円）。 */
  diff: number;
}

/** 出金元の補正の履歴（新しい順）。 */
export function balanceChecks(walletId: string, balances: readonly MoneyWalletBalance[]): BalanceCheck[] {
  return balances
    .filter((balance) => balance.walletId === walletId)
    .sort((a, b) => b.balanceOn.localeCompare(a.balanceOn) || b.id.localeCompare(a.id))
    .map((balance) => ({ balance, diff: balance.adjustment }));
}

// ---- 口座の推移・カードの請求（docs/kakei.md §9.3） ----

const DAY_MS = 24 * 60 * 60 * 1000;
const parseDateKey = (dateKey: string): number => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
};
const formatDateKey = (ms: number): string => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
};

/** YYYY-MM-DD の days 日後（前なら負）。 */
export const addDays = (dateKey: string, days: number): string => formatDateKey(parseDateKey(dateKey) + days * DAY_MS);

export interface BalancePoint {
  /** YYYY-MM-DD。その日の終わりの残高。 */
  date: string;
  amount: number;
}

/**
 * 出金元（複数ならその合計）の、日ごとの残高。いちばん古い記録・補正の日から asOf（今日）まで、1日1点。
 * 数え方は walletBalanceOn と同じ（前の日の残高 + その日の記録 + その日の補正の増減）。
 * 記録も補正も無ければ空。今日より先の記録は入れない。
 */
export function dailyBalances(
  walletIds: readonly string[],
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
  asOf: string,
): BalancePoint[] {
  const ids = new Set(walletIds);
  const perWallet = new Map<string, { deltas: Map<string, number> }>();
  let start: string | null = null;
  const see = (date: string) => {
    if (date <= asOf && (start === null || date < start)) start = date;
  };
  const slot = (walletId: string) => {
    let entry = perWallet.get(walletId);
    if (!entry) {
      entry = { deltas: new Map() };
      perWallet.set(walletId, entry);
    }
    return entry;
  };
  for (const record of records) {
    if (record.occurredOn > asOf) continue;
    for (const walletId of new Set([record.walletId, record.toWalletId])) {
      if (walletId === null || !ids.has(walletId)) continue;
      const entry = slot(walletId);
      entry.deltas.set(record.occurredOn, (entry.deltas.get(record.occurredOn) ?? 0) + walletDelta(record, walletId));
      see(record.occurredOn);
    }
  }
  for (const balance of balances) {
    if (balance.balanceOn > asOf || !ids.has(balance.walletId)) continue;
    const { deltas } = slot(balance.walletId);
    deltas.set(balance.balanceOn, (deltas.get(balance.balanceOn) ?? 0) + balance.adjustment);
    see(balance.balanceOn);
  }
  if (start === null) return [];

  const days = Math.round((parseDateKey(asOf) - parseDateKey(start)) / DAY_MS) + 1;
  const totals = new Array<number>(days).fill(0);
  for (const { deltas } of perWallet.values()) {
    let amount = 0;
    for (let index = 0; index < days; index += 1) {
      amount += deltas.get(addDays(start, index)) ?? 0;
      totals[index] += amount;
    }
  }
  return totals.map((amount, index) => ({ date: addDays(start as string, index), amount }));
}

export type TrendPeriod = 'month' | 'half' | 'year' | 'all';

export const TREND_PERIODS: { id: TrendPeriod; label: string }[] = [
  { id: 'month', label: '1ヶ月' },
  { id: 'half', label: '半年' },
  { id: 'year', label: '1年' },
  { id: 'all', label: '全期間' },
];

/** 表示する期間だけに絞る（asOf から数えて、1ヶ月＝30日・半年＝183日・1年＝365日）。全期間はそのまま。 */
export function filterTrend(points: readonly BalancePoint[], period: TrendPeriod, asOf: string): BalancePoint[] {
  const days = { month: 30, half: 183, year: 365, all: 0 }[period];
  if (days === 0) return [...points];
  const from = addDays(asOf, -days);
  return points.filter((point) => point.date >= from);
}

/** 残高が変わった日（新しい順）。いちばん古い日も入れる。履歴の一覧に使う。 */
export function balanceChanges(points: readonly BalancePoint[]): BalancePoint[] {
  return points.filter((point, index) => index === 0 || point.amount !== points[index - 1].amount).reverse();
}

/** グラフの目盛り（min〜max を含む、きりのよい間隔。2〜6本）。 */
export function niceTicks(min: number, max: number): number[] {
  if (min === max) return [min];
  const raw = (max - min) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((unit) => unit * magnitude).find((candidate) => candidate >= raw) ?? magnitude * 10;
  const ticks: number[] = [];
  // max を超えるところまで（グラフの上端が最大値を含むように）。
  for (let value = Math.floor(min / step) * step; ; value += step) {
    ticks.push(Math.round(value));
    if (value >= max) break;
  }
  return ticks;
}

/** 目盛りの文字（2,000万・500万・8,000）。 */
export function formatAxisYen(value: number): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  if (abs >= 10000) return `${sign}${(abs / 10000).toLocaleString('ja-JP')}万`;
  return `${sign}${abs.toLocaleString('ja-JP')}`;
}

export interface CardBilling {
  /** 請求済み（締め日を過ぎて、引き落とし待ちの額。円）。 */
  billed: number;
  /** 未請求（直近の締め日のあとに使った額。円）。 */
  unbilled: number;
  /** 直近の締め日（YYYY-MM-DD）。 */
  closedOn: string;
  /** 次の引き落とし日（YYYY-MM-DD。休日のずれは入れない）。引き落とし日が未設定なら null。 */
  payOn: string | null;
}

const monthDay = (year: number, month: number, day: number): string => {
  // 月末を超える日（31 や 30 など）は、その月の末日にする。
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad2(month)}-${pad2(Math.min(day, last))}`;
};

/** 「カードの引き落としを翌月分に回す」を選べる記録か（出金元がカードで、日付が25日以降。振替は除く）。docs/kakei.md §3.4。 */
export const canCardNextPeriod = (
  kind: MoneyRecordKind,
  wallet: Pick<MoneyWallet, 'type'> | null | undefined,
  occurredOn: string,
): boolean => kind !== 'transfer' && wallet?.type === 'card' && Number(occurredOn.slice(8, 10)) >= 25;

/**
 * カードの請求の内訳。残高（マイナス＝未払い）が「請求済み」と「未請求」に分かれる。
 * 引き落としは締め日ごとにまとめて口座から落ちるので、残高には先月の請求と今月の利用が両方入っている。
 * 締め日が未設定のカードは null。未請求 ＝ 締め日のあとの利用（支出 − 返品。振替は入れない）、請求済み ＝ 未払い − 未請求。
 * 「翌月分に回す」記録（cardNextPeriod）は、日付の期間の次の期間の利用として数える（締め日の前の1期間ぶんも未請求に入る）。
 */
export function cardBilling(
  wallet: Pick<MoneyWallet, 'id' | 'closeDay' | 'payDay' | 'payMonthOffset'>,
  amount: number,
  records: readonly MoneyRecord[],
  asOf: string,
): CardBilling | null {
  if (wallet.closeDay === null) return null;
  const [year, month] = asOf.split('-').map(Number);
  const thisClose = monthDay(year, month, wallet.closeDay);
  const closedOn =
    thisClose <= asOf
      ? thisClose
      : month === 1
        ? monthDay(year - 1, 12, wallet.closeDay)
        : monthDay(year, month - 1, wallet.closeDay);
  const [closedYear, closedMonth] = shiftMonth(monthKeyOf(closedOn), -1).split('-').map(Number);
  const closedBefore = monthDay(closedYear, closedMonth, wallet.closeDay);
  const unbilled = records
    .filter((record) => record.kind !== 'transfer' && record.walletId === wallet.id)
    .filter(
      (record) =>
        record.occurredOn <= asOf &&
        (record.occurredOn > closedOn || (record.cardNextPeriod && record.occurredOn > closedBefore)),
    )
    .reduce((sum, record) => sum - walletDelta(record, wallet.id), 0);
  const owed = Math.max(0, -amount);
  const unbilledOwed = Math.min(Math.max(0, unbilled), owed);

  let payOn: string | null = null;
  if (wallet.payDay !== null) {
    // 締め日のあとの最初の引き落とし日（cardScheduleLabel と同じ。引き落とし日が締め日より後なら同じ月、そうでなければ翌月）。
    // 引き落とし月を「締め日の月 + n か月」と決めているカード（翌々月払いなど）は、その月の引き落とし日。
    const closeMonthKey = monthKeyOf(closedOn);
    const sameMonth = wallet.payDay > wallet.closeDay && wallet.closeDay < 31;
    const payMonthKey = shiftMonth(closeMonthKey, wallet.payMonthOffset ?? (sameMonth ? 0 : 1));
    const [payYear, payMonth] = payMonthKey.split('-').map(Number);
    payOn = monthDay(payYear, payMonth, wallet.payDay);
  }
  return { billed: owed - unbilledOwed, unbilled: unbilledOwed, closedOn, payOn };
}

/**
 * カードの引き落とし月に対する利用期間（前回の締め日の翌日〜今回の締め日。DBの make_money_recurring_records と同じ数え方）。
 * 締め日が未設定、または引き落とし月の決め方が「自動」で引き落とし日が未設定のカードは null。
 */
export function cardUsagePeriod(
  wallet: Pick<MoneyWallet, 'closeDay' | 'payDay' | 'payMonthOffset'>,
  payMonthKey: string,
): { from: string; to: string } | null {
  if (wallet.closeDay === null) return null;
  const closeOn = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    return monthDay(year, month, wallet.closeDay!);
  };
  let to: string;
  if (wallet.payMonthOffset !== null) {
    to = closeOn(shiftMonth(payMonthKey, -wallet.payMonthOffset));
  } else {
    if (wallet.payDay === null) return null;
    const [year, month] = payMonthKey.split('-').map(Number);
    to = closeOn(payMonthKey);
    if (to >= monthDay(year, month, wallet.payDay)) to = closeOn(shiftMonth(payMonthKey, -1));
  }
  const before = closeOn(shiftMonth(monthKeyOf(to), -1));
  return { from: addDays(before, 1), to };
}

/**
 * 引き落とし月の利用に、前の期間から「翌月分に回す」で回ってきた額（支出 − 返品）と、その期間の締め日の月（YYYY-MM）。
 * カードの引き落としの内訳に「9月分」と添える。回ってきた記録が無ければ null。docs/kakei.md §3.4。
 */
export function cardCarriedIn(
  wallet: Pick<MoneyWallet, 'id' | 'closeDay' | 'payDay' | 'payMonthOffset'>,
  payMonthKey: string,
  records: readonly MoneyRecord[],
): { monthKey: string; amount: number } | null {
  const period = cardUsagePeriod(wallet, payMonthKey);
  if (period === null || wallet.closeDay === null) return null;
  const to = addDays(period.from, -1);
  const [year, month] = shiftMonth(monthKeyOf(to), -1).split('-').map(Number);
  const after = monthDay(year, month, wallet.closeDay);
  const carried = records.filter(
    (record) =>
      record.cardNextPeriod &&
      record.kind !== 'transfer' &&
      record.walletId === wallet.id &&
      record.occurredOn > after &&
      record.occurredOn <= to,
  );
  if (carried.length === 0) return null;
  return { monthKey: monthKeyOf(to), amount: carried.reduce((sum, record) => sum - walletDelta(record, wallet.id), 0) };
}

export interface CardPaymentMonth {
  /** 引き落とし月（YYYY-MM）。 */
  monthKey: string;
  /** その月に引き落とされた額（円）。口座 → カードの振替の合計。 */
  amount: number;
  /** 見込みの額のままの振替を含む。 */
  estimate: boolean;
  /** その月の最後の引き落とし日。 */
  lastOn: string;
}

/**
 * カードのこれまでの引き落とし額（月ごと。新しい月から）。引き落とし＝カードへの振替（口座 → カード）の合計で、
 * 自動で作った振替も人が入れた振替も数える。asOf より先の日付は入れない。
 */
export function cardPaymentHistory(
  walletId: string,
  records: readonly MoneyRecord[],
  asOf: string,
): CardPaymentMonth[] {
  const byMonth = new Map<string, CardPaymentMonth>();
  for (const record of records) {
    if (record.kind !== 'transfer' || record.toWalletId !== walletId || record.occurredOn > asOf) continue;
    const monthKey = monthKeyOf(record.occurredOn);
    const entry = byMonth.get(monthKey) ?? { monthKey, amount: 0, estimate: false, lastOn: record.occurredOn };
    entry.amount += record.items.reduce((sum, item) => sum + item.amount, 0);
    entry.estimate = entry.estimate || record.isEstimate;
    if (record.occurredOn > entry.lastOn) entry.lastOn = record.occurredOn;
    byMonth.set(monthKey, entry);
  }
  return [...byMonth.values()].sort((a, b) => (a.monthKey < b.monthKey ? 1 : a.monthKey > b.monthKey ? -1 : 0));
}

/** その出金元に関わる記録（支出・収入・振替の出金元か入金先）。新しい順。 */
export const recordsOfWallet = (records: readonly MoneyRecord[], walletId: string): MoneyRecord[] =>
  sortRecordsDesc(records.filter((record) => record.walletId === walletId || record.toWalletId === walletId));

// ---- 証券の評価額（銘柄ごと。docs/kakei.md §9.2） ----

/** 銘柄の種類（追加・編集の選択肢の並び）。 */
export const SECURITY_KINDS: { id: MoneySecurityKind; label: string }[] = [
  { id: 'us_stock', label: '米国株' },
  { id: 'jp_fund', label: '投資信託' },
  { id: 'cash', label: '預り金' },
];

/** 預り区分（Zaim・証券のアプリの並び）。 */
export const HOLDING_ACCOUNTS: { id: MoneyHoldingAccount; label: string }[] = [
  { id: 'tokutei', label: '特定' },
  { id: 'nisa', label: 'NISA成長投資枠' },
  { id: 'nisa_tsumitate', label: 'NISAつみたて投資枠' },
  { id: 'ippan', label: '一般' },
];

export const holdingAccountLabel = (account: MoneyHoldingAccount) =>
  HOLDING_ACCOUNTS.find((entry) => entry.id === account)?.label ?? '';

/** 価格の単位（国内投信は1万口あたり。ほかは1）。 */
export const securityUnit = (kind: MoneySecurityKind): number => (kind === 'jp_fund' ? 10000 : 1);

/** 保有の、date 以前で最新の評価額の行。まだ無ければ null。 */
function latestValue(holdingId: string, values: readonly MoneyHoldingValue[], date: string): MoneyHoldingValue | null {
  let latest: MoneyHoldingValue | null = null;
  for (const value of values) {
    if (value.holdingId !== holdingId || value.valueOn > date) continue;
    if (latest === null || value.valueOn > latest.valueOn) latest = value;
  }
  return latest;
}

/**
 * 証券口座（複数ならその合計）の、date の評価額（円）。保有ごとに date 以前で最新の行を足す
 * （その日の行が無い日＝取れなかった日は、前の日の行）。使わなくした保有も、その日の行（0）で数える。
 */
export function securitiesValueOn(
  walletIds: readonly string[],
  holdings: readonly MoneyHolding[],
  values: readonly MoneyHoldingValue[],
  date: string,
): number {
  const ids = new Set(walletIds);
  return holdings
    .filter((holding) => ids.has(holding.walletId))
    .reduce((sum, holding) => sum + (latestValue(holding.id, values, date)?.value ?? 0), 0);
}

/**
 * 保有（複数ならその合計）の、日ごとの評価額。いちばん古い行の日から asOf（今日）まで、1日1点。
 * 行の無い日は前の日の行を使う。行が無ければ空。
 */
export function holdingDailyValues(
  holdingIds: readonly string[],
  values: readonly MoneyHoldingValue[],
  asOf: string,
): BalancePoint[] {
  const ids = new Set(holdingIds);
  const perHolding = new Map<string, Map<string, number>>();
  let start: string | null = null;
  for (const value of values) {
    if (!ids.has(value.holdingId) || value.valueOn > asOf) continue;
    let byDate = perHolding.get(value.holdingId);
    if (!byDate) {
      byDate = new Map();
      perHolding.set(value.holdingId, byDate);
    }
    byDate.set(value.valueOn, value.value);
    if (start === null || value.valueOn < start) start = value.valueOn;
  }
  if (start === null) return [];
  const days = Math.round((parseDateKey(asOf) - parseDateKey(start)) / DAY_MS) + 1;
  const totals = new Array<number>(days).fill(0);
  for (const byDate of perHolding.values()) {
    let amount = 0;
    for (let index = 0; index < days; index += 1) {
      amount = byDate.get(addDays(start, index)) ?? amount;
      totals[index] += amount;
    }
  }
  return totals.map((amount, index) => ({ date: addDays(start as string, index), amount }));
}

/** 日ごとの残高を足し合わせる（どれかの始まりの日から。始まる前の日は 0、途中の抜けは前の日の額）。 */
export function sumDailyPoints(...lists: readonly (readonly BalancePoint[])[]): BalancePoint[] {
  const filled = lists.filter((list) => list.length > 0);
  if (filled.length === 0) return [];
  if (filled.length === 1) return [...filled[0]];
  const start = filled.map((list) => list[0].date).sort()[0];
  const end = filled.map((list) => list[list.length - 1].date).sort().reverse()[0];
  const days = Math.round((parseDateKey(end) - parseDateKey(start)) / DAY_MS) + 1;
  const totals = new Array<number>(days).fill(0);
  for (const list of filled) {
    const byDate = new Map(list.map((point) => [point.date, point.amount]));
    let amount = 0;
    for (let index = 0; index < days; index += 1) {
      amount = byDate.get(addDays(start, index)) ?? amount;
      totals[index] += amount;
    }
  }
  return totals.map((amount, index) => ({ date: addDays(start, index), amount }));
}

/**
 * 総残高の日ごとの推移。使っている出金元の残高（記録と補正から）に、使っている証券口座の評価額を足す。
 */
export function totalDailyBalances(
  wallets: readonly MoneyWallet[],
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
  securities: Pick<MoneySecuritiesData, 'holdings' | 'values'>,
  asOf: string,
): BalancePoint[] {
  const usable = wallets.filter((wallet) => !wallet.archived);
  const plain = usable.filter((wallet) => wallet.type !== 'securities').map((wallet) => wallet.id);
  const securityWalletIds = new Set(usable.filter((wallet) => wallet.type === 'securities').map((wallet) => wallet.id));
  const holdingIds = securities.holdings.filter((holding) => securityWalletIds.has(holding.walletId)).map((holding) => holding.id);
  return sumDailyPoints(dailyBalances(plain, records, balances, asOf), holdingDailyValues(holdingIds, securities.values, asOf));
}

export interface SecurityRow {
  holding: MoneyHolding;
  security: MoneySecurity;
  /** 評価額（円）。 */
  value: number;
  /** 取得額（円）。取得単価が無ければ null。 */
  cost: number | null;
  /** 評価損益（円）。取得額が無ければ null。 */
  gain: number | null;
  /** 評価損益の割合（評価損益 ÷ 取得額）。取得額が無い・0なら null。 */
  gainRate: number | null;
  /** 現在値（円。ドル建ては × 為替。国内投信は1万口あたりの基準価額）。まだ取れていない・預り金は null。 */
  price: number | null;
  /** 現在値の日付（評価額の行の日）。 */
  priceOn: string | null;
}

/**
 * 証券口座の保有の一覧。Zaim と同じく**預り区分ごとに1行**で、並びは 預り区分（特定 → NISA成長投資枠 →
 * NISAつみたて投資枠 → 一般）→ 銘柄の並び順。預り金は最後。使わなくした保有は入れない。
 * 評価額は asOf 以前で最新の行。取得額は今の保有数 × 取得単価。金額はすべて円。
 */
export function securityRows(
  walletId: string,
  data: MoneySecuritiesData,
  asOf: string,
): SecurityRow[] {
  const rows: SecurityRow[] = [];
  for (const holding of data.holdings) {
    if (holding.walletId !== walletId || holding.archived) continue;
    const security = data.securities.find((entry) => entry.id === holding.securityId);
    if (!security) continue;
    const latest = latestValue(holding.id, data.values, asOf);
    const value = latest?.value ?? 0;
    const cost =
      holding.costPrice === null ? null : Math.round((holding.quantity * holding.costPrice) / securityUnit(security.kind));
    const gain = cost === null ? null : value - cost;
    rows.push({
      holding,
      security,
      value,
      cost,
      gain,
      gainRate: cost !== null && cost > 0 && gain !== null ? gain / cost : null,
      price: latest === null || security.kind === 'cash' ? null : latest.price * latest.fx,
      priceOn: latest?.valueOn ?? null,
    });
  }
  const accountIndex = (account: MoneyHoldingAccount) => HOLDING_ACCOUNTS.findIndex((entry) => entry.id === account);
  return rows.sort(
    (a, b) =>
      Number(a.security.kind === 'cash') - Number(b.security.kind === 'cash') ||
      accountIndex(a.holding.account) - accountIndex(b.holding.account) ||
      a.security.position - b.security.position,
  );
}

/** 証券口座の評価損益の合計（取得単価のある銘柄だけ）。1つも無ければ null。 */
export function walletGain(rows: readonly SecurityRow[]): { gain: number; rate: number | null } | null {
  const counted = rows.filter((row) => row.cost !== null);
  if (counted.length === 0) return null;
  const cost = counted.reduce((sum, row) => sum + (row.cost ?? 0), 0);
  const gain = counted.reduce((sum, row) => sum + (row.gain ?? 0), 0);
  return { gain, rate: cost > 0 ? gain / cost : null };
}

/** 評価損益の割合（+12.34% / −5.00%）。 */
export function formatGainRate(rate: number): string {
  if (rate === 0) return '0.00%';
  return `${rate > 0 ? '+' : '−'}${Math.abs(rate * 100).toFixed(2)}%`;
}

/** 保有数（株数・口数。小数は4桁まで）。 */
export const formatQuantity = (quantity: number): string => quantity.toLocaleString('ja-JP', { maximumFractionDigits: 4 });
