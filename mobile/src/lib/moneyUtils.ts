// 家計タブの数え方（月の集計・予算との差・種類の並び・電卓）。docs/kakei.md §3〜§5。
// PWA版の `src/lib/moneyUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 年はすべて暦年（1月〜12月。2026-10-09に、4月始まりの年度から変えた）。予算は大分類・年ごとの月額で、
// その年の予算が無ければ前の年の額を使う（毎年入れ直さなくてよいように）。
//
// 生活費の収支＝収入 − 生活費（特別費以外の支出）。特別費（特別費の項目を持つ品目）は収支に入れず、別枠で数える
// （docs/kakei.md §4.1）。振替は集計に入れない。貯金は記録なので、収支の式にも表示にも入れない。

import type {
  MoneyBudget,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyHolding,
  MoneyHoldingAccount,
  MoneyHoldingValue,
  MoneyItem,
  MoneyItemDraft,
  MoneyHolidayRule,
  MoneyRecord,
  MoneyRecordKind,
  MoneyRecurring,
  MoneySecuritiesData,
  MoneySecurity,
  MoneySecurityKind,
  MoneyStore,
  MoneyWallet,
  MoneyWalletBalance,
  MoneyWalletType,
  SpecialActual,
} from '@/types/app';
import type { SpecialRow } from '@/lib/specialUtils';

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
export const formatYen = (value: number) => `¥${Math.abs(value).toLocaleString('ja-JP')}`;

/** 符号つき（＋¥1,234 / −¥1,234 / ¥0）。 */
export function formatSignedYen(value: number): string {
  if (value === 0) return formatYen(0);
  return `${value > 0 ? '+' : '−'}${formatYen(value)}`;
}

// ---- 種類・出金元の決まりごと ----

export const RECORD_KIND_LABEL: Record<MoneyRecordKind, string> = {
  expense: '支出',
  income: '収入',
  transfer: '振替',
};

/** 出金元の種類（Zaim の「出金元の選択」と同じ並び）。 */
export const WALLET_TYPES: { id: MoneyWalletType; label: string }[] = [
  { id: 'cash', label: '財布' },
  { id: 'card', label: 'カード' },
  { id: 'bank', label: '口座' },
  { id: 'prepaid', label: 'プリペイド' },
  { id: 'qr', label: 'QR決済' },
  { id: 'securities', label: '証券' },
];

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

/** 「毎月27日（休日は翌営業日）」「6・12月の10日（休日は前営業日）」。 */
export function recurringScheduleLabel(rule: Pick<MoneyRecurring, 'day' | 'months' | 'holiday'>): string {
  const when =
    rule.months === null
      ? `毎月${formatDayOfMonth(rule.day)}`
      : `${[...rule.months].sort((a, b) => a - b).join('・')}月の${formatDayOfMonth(rule.day)}`;
  return `${when}（${rule.holiday === 'none' ? '休日もそのまま' : `休日は${HOLIDAY_RULE_LABEL[rule.holiday]}`}）`;
}

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
 * ルールの過去1年の記録（種類・出金元・お店が同じで、見込みでないもの。新しい順）。見込みの額のもとになる
 * （DBの money_recurring_estimate と同じ選び方。額の出し方はDBだけが持つ）。設定画面で、ルールが過去の記録と
 * 結びついているかを確かめるのに使う。1件の記録に同じ種類の品目が複数あれば合計する。
 */
export function recurringHistory(
  rule: Pick<MoneyRecurring, 'kind' | 'walletId' | 'toWalletId' | 'store' | 'categoryId' | 'specialItemId'>,
  records: readonly MoneyRecord[],
  today: string,
): { occurredOn: string; amount: number }[] {
  if (rule.walletId === null) return [];
  const since = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const matches = (item: MoneyItem) =>
    rule.categoryId !== null
      ? item.categoryId === rule.categoryId
      : rule.specialItemId !== null
        ? item.specialItemId === rule.specialItemId
        : true;
  const history: { occurredOn: string; amount: number }[] = [];
  for (const record of records) {
    if (record.kind !== rule.kind || record.isEstimate || record.walletId !== rule.walletId) continue;
    if (rule.kind === 'transfer' && record.toWalletId !== rule.toWalletId) continue;
    if (record.store.trim() !== rule.store.trim()) continue;
    if (record.occurredOn < since || record.occurredOn >= today) continue;
    const items = record.items.filter(matches);
    if (items.length === 0) continue;
    history.push({ occurredOn: record.occurredOn, amount: items.reduce((sum, item) => sum + item.amount, 0) });
  }
  return history.sort((x, y) => (x.occurredOn < y.occurredOn ? 1 : x.occurredOn > y.occurredOn ? -1 : 0));
}

/** その月の、見込みの額のままの記録（振替を除く。収支に入るものだけ）。 */
export const estimatesInMonth = (records: readonly MoneyRecord[], monthKey: string): MoneyRecord[] =>
  recordsInMonth(records, monthKey).filter((record) => record.isEstimate && record.kind !== 'transfer');

/**
 * 標準の種類（Zaim のカテゴリをもとにした、どの家族でも使える並び）。docs/kakei.md §3.1。
 * 種類がまだ1つも無い家族に「標準の種類で始める」で入れる。名前・並びはあとで家族が変える。
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

// ---- 種類のアイコン（docs/kakei.md §3.1。Zaim と同じく種類ごとに絵と色） ----

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

/** 名前から近いアイコンを選ぶ（アイコンを決めていない種類に使う）。当たらなければ「その他」。 */
export function guessIconKey(name: string): string {
  return ICON_RULES.find(([pattern]) => pattern.test(name))?.[1] ?? 'other';
}

/**
 * 種類のアイコンの key（決めたもの、無ければ名前から）。色を選んでいる種類は "food|#e53935" の形で色まで持ち回る
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

/** 種類の大分類の id（大分類ならそれ自身）。知らない id は null。 */
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

/**
 * その月（YYYY-MM）の大分類の月の予算。予算は年ごとに12か月ぶんを持つので、年の途中で直しても、直した月より前の月は変わらない。
 * その年の行が無ければ、前の年のいちばん近い行の12月の額（毎年入れ直さなくてよいように）。どこにも無い月は null。
 */
export function budgetFor(budgets: readonly MoneyBudget[], categoryId: string, monthKey: string): number | null {
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

/** その年の1月〜12月の予算（長さ12）。年の途中で直すとき、直す前の月をそのまま残すのに使う。 */
export const budgetMonths = (budgets: readonly MoneyBudget[], categoryId: string, year: number): (number | null)[] =>
  Array.from({ length: 12 }, (_, index) => budgetFor(budgets, categoryId, `${year}-${pad2(index + 1)}`));

/** fromMonth（1〜12）から年末までを amount にした12か月ぶん。それより前の月は current のまま。 */
export const withBudgetFrom = (
  current: readonly (number | null)[],
  fromMonth: number,
  amount: number,
): (number | null)[] => current.map((value, index) => (index + 1 >= fromMonth ? amount : value));

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

/** 品目の種類のまとまり（記録の詳細で、同じ種類の品目を1行に見せる）。 */
export interface ItemGroup<T extends Omit<MoneyItem, 'id'>> {
  key: string;
  categoryId: string | null;
  specialItemId: string | null;
  specialPlanId: string | null;
  items: T[];
  total: number;
}

export const itemGroupKey = (item: Pick<MoneyItem, 'categoryId' | 'specialItemId' | 'specialPlanId'>) =>
  item.categoryId !== null
    ? `category:${item.categoryId}`
    : item.specialItemId !== null
      ? `special:${item.specialItemId}:${item.specialPlanId ?? ''}`
      : 'none';

/** 品目を種類ごとにまとめる。最初に出てきた順。 */
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
        specialItemId: item.specialItemId,
        specialPlanId: item.specialPlanId,
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

/** 家計の品目を、特別費の画面の実績の形にする（特別費の項目を持つ品目だけ）。 */
export function specialActualsFromRecords(records: readonly MoneyRecord[]): SpecialActual[] {
  const actuals: SpecialActual[] = [];
  for (const record of records) {
    for (const item of record.items) {
      if (item.specialItemId === null) continue;
      actuals.push({
        id: item.id,
        recordId: record.id,
        itemId: item.specialItemId,
        planId: item.specialPlanId,
        occurredOn: record.occurredOn,
        amount: item.amount,
        note: item.memo,
      });
    }
  }
  return actuals.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn));
}

// ---- 入力の手助け ----

/** よく使う小分類（直近の記録で多い順）。使わなくした種類は出さない。 */
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
 * お店の選択肢（docs/kakei.md §3.5）。まず最近使ったお店（新しい順。登録の有無は問わない）、
 * 続けて登録したお店のうち残りを使った回数の多い順に（同じ回数なら名前順）。
 * 登録していない前に使ったお店（others。名前順）は、名前で探したときだけ出す。
 * 使わなくしたお店は、記録で使っていても候補に出さない。
 */
export function storeChoices(
  stores: readonly MoneyStore[],
  records: readonly StoreUse[],
  recentLimit = 12,
): { registered: string[]; recent: string[]; others: string[] } {
  const archived = new Set(stores.filter((store) => store.archived).map((store) => store.name));
  const used = recentStores(records, Number.MAX_SAFE_INTEGER).filter((name) => !archived.has(name));
  const recent = used.slice(0, recentLimit);
  const shown = new Set(recent);
  const uses = new Map<string, number>();
  for (const record of records) {
    const store = record.store.trim();
    if (store !== '') uses.set(store, (uses.get(store) ?? 0) + 1);
  }
  const registered = stores
    .filter((store) => !store.archived && !shown.has(store.name))
    .map((store) => store.name)
    .sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || a.localeCompare(b, 'ja'));
  const registeredNames = new Set(stores.map((store) => store.name));
  const others = used
    .filter((name) => !shown.has(name) && !registeredNames.has(name))
    .sort((a, b) => a.localeCompare(b, 'ja'));
  return { registered, recent, others };
}

/** 前回の出金元（その種類の記録でいちばん新しいもの）。使わなくした出金元は使わない。 */
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

/** その月の生活費を、大分類ごとに足す（特別費・振替は入れない）。 */
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
 * 生活費のタイル。種類の並び（大分類の並び順）のまま（2026-10-08に、予算を超えた順から変えた）。
 * 使わなくした大分類は、その月に使っていれば出す。
 */
export function buildBudgetTiles(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  monthKeys: string | readonly string[],
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
      const monthly = keys
        .map((key) => budgetFor(budgets, category.id, key))
        .filter((value): value is number => value !== null);
      const budget = monthly.length === 0 ? null : monthly.reduce((sum, value) => sum + value, 0);
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

export interface MonthSummary {
  /** 収入（特別収入を除く）。 */
  income: number;
  /** 生活費の実績（特別費以外の支出）。 */
  living: number;
  /** 生活費の予算の合計。 */
  livingBudget: number;
  /** 特別費（支出）の実績。生活費の収支には入れず、別に出す。 */
  special: number;
  /** 生活費の収支＝収入 − 生活費（特別費以外の支出）。貯金は記録なので式に入れない。 */
  balance: number;
  /** 生活費が予算どおりなら残る予定だった額＝収入 − 生活費の予算。 */
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
  let special = 0;
  for (const record of recordsInMonth(records, monthKey)) {
    // 振替（貯金への振替を含む）は集計に入れない。
    if (record.kind === 'transfer') continue;
    for (const item of record.items) {
      if (record.kind === 'income') {
        if (item.specialItemId === null) income += item.amount;
      } else if (item.specialItemId !== null) {
        special += item.amount;
      } else if (item.categoryId !== null) {
        living += item.amount;
      }
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
    special,
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

export interface YearMonthRow {
  monthKey: string;
  /** その月に記録（特別費を除く）があるか。無い月は数えない（使い始める前の月・まだ来ていない月）。 */
  recorded: boolean;
  income: number;
  living: number;
  /** 特別費（支出）。生活費の収支には入れない。 */
  special: number;
  /** 生活費の収支（収入 − 生活費）。 */
  balance: number;
  /** 生活費の予算 − 実績。 */
  livingDiff: number;
}

export interface YearSummary {
  months: YearMonthRow[];
  /** 記録のある月だけの合計。 */
  total: Omit<YearMonthRow, 'monthKey' | 'recorded'>;
  /** 記録のある月の数。 */
  recordedMonths: number;
}

/**
 * 年の生活費の収支（docs/kakei.md §4.2）。月ごとの 収入・生活費・収支 と年間の合計。特別費は収支に入れず、別に数える。
 * 記録（特別費を除く）の無い月は数えない（使い始める前の月まで予算が残ったように見えないように）。
 * upTo（YYYY-MM）より後の月は、まだ来ていないので数えない。
 */
export function buildYearSummary(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  year: number,
  upTo: string,
): YearSummary {
  const total = { income: 0, living: 0, special: 0, balance: 0, livingDiff: 0 };
  let recordedMonths = 0;
  const months = yearMonthKeys(year).map((monthKey) => {
    const recorded =
      monthKey <= upTo &&
      recordsInMonth(records, monthKey).some((record) => record.items.some((item) => item.specialItemId === null));
    // 特別費だけの月（生活費の記録が無い月）も、特別費は年に数える。
    const hasAny = monthKey <= upTo && recordsInMonth(records, monthKey).length > 0;
    if (!recorded && !hasAny) return { monthKey, recorded, income: 0, living: 0, special: 0, balance: 0, livingDiff: 0 };
    const summary = buildMonthSummary(records, categories, budgets, monthKey);
    total.special += summary.special;
    if (!recorded) return { monthKey, recorded, income: 0, living: 0, special: summary.special, balance: 0, livingDiff: 0 };
    const row = {
      monthKey,
      recorded,
      income: summary.income,
      living: summary.living,
      special: summary.special,
      balance: summary.balance,
      livingDiff: summary.livingBudget - summary.living,
    };
    recordedMonths += 1;
    total.income += row.income;
    total.living += row.living;
    total.balance += row.balance;
    total.livingDiff += row.livingDiff;
    return row;
  });
  return { months, total, recordedMonths };
}

export interface SpecialProgress {
  /** 年の特別費の予算（予定の合計）。 */
  yearBudget: number;
  /** その月に払った特別費。 */
  spentThisMonth: number;
  /** 年のはじめからその月までに払った特別費。 */
  spentToDate: number;
  /** 年の予算の残り（予算 − ここまで払った額）。 */
  remaining: number;
  /** その月の予定で、まだ払っていないもの。 */
  pendingThisMonth: number;
}

/**
 * その月に、特別費の年の予算がどれだけ減ったか（docs/kakei.md §4.1）。月の収支には入れない。
 * rows は specialUtils の buildYearRows(…, 年, 'expense')。
 */
export function buildSpecialProgress(rows: readonly SpecialRow[], monthKey: string): SpecialProgress {
  const month = Number(monthKey.slice(5, 7));
  let yearBudget = 0;
  let spentThisMonth = 0;
  let spentToDate = 0;
  let pendingThisMonth = 0;
  for (const row of rows) {
    yearBudget += row.budget;
    for (const actual of row.actuals) {
      const key = monthKeyOf(actual.occurredOn);
      if (key === monthKey) spentThisMonth += actual.amount;
      if (key <= monthKey) spentToDate += actual.amount;
    }
    if (row.planId !== null && row.actual === null && row.month === month) pendingThisMonth += 1;
  }
  return { yearBudget, spentThisMonth, spentToDate, remaining: yearBudget - spentToDate, pendingThisMonth };
}

export interface SpecialReview {
  /** 年の特別費の予算（予定の合計）。 */
  yearBudget: number;
  /** 見ている期間（月、または年ぜんたい）に払った特別費。 */
  spent: number;
  /** 年のはじめから、見ている期間の終わりまでに払った額。 */
  spentToDate: number;
  /** 年の予算の残り＝予算 − ここまで払った額（マイナスは超えた額）。 */
  remaining: number;
}

/**
 * 振り返りの特別費（docs/kakei.md §4.1・§4.2）。monthKey があればその月に払った額と、その月までの累計での予算の残り。
 * null なら年ぜんたい。rows は specialUtils の buildYearRows(…, 年, 'expense')。
 */
export function buildSpecialReview(rows: readonly SpecialRow[], monthKey: string | null): SpecialReview {
  if (monthKey !== null) {
    const progress = buildSpecialProgress(rows, monthKey);
    return {
      yearBudget: progress.yearBudget,
      spent: progress.spentThisMonth,
      spentToDate: progress.spentToDate,
      remaining: progress.remaining,
    };
  }
  const yearBudget = rows.reduce((sum, row) => sum + row.budget, 0);
  const spent = rows.reduce((sum, row) => sum + row.actuals.reduce((inner, actual) => inner + actual.amount, 0), 0);
  return { yearBudget, spent, spentToDate: spent, remaining: yearBudget - spent };
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
  /** 年のとき、月ごとの実績（1月→12月、見ている期間に含まれる月だけ）。 */
  months: { monthKey: string; amount: number }[];
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
    item.specialItemId === null && item.categoryId !== null && topCategoryIdOf(categories, item.categoryId) === topId;
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

export interface SpecialAnalysis extends SpecialReview {
  /** 項目ごとの 年の予算と、見ている期間に払った額・年のはじめからの累計。期間に払った額が多い順。 */
  items: { id: string; name: string; category: string; budget: number; spent: number; spentToDate: number }[];
  /** 特別費の記録（品目を特別費のものだけに絞った）。 */
  records: MoneyRecord[];
}

/**
 * 内訳の特別費を分析する。rows は specialUtils の buildYearRows(…, 年, 'expense')、monthKey があればその月、
 * null なら年ぜんたい。year は rows の年。
 */
export function buildSpecialAnalysis(
  records: readonly MoneyRecord[],
  rows: readonly SpecialRow[],
  year: number,
  monthKey: string | null,
): SpecialAnalysis {
  const review = buildSpecialReview(rows, monthKey);
  const expenseItemIds = new Set(rows.map((row) => row.item.id));
  const periodKeys = monthKey !== null ? [monthKey] : yearMonthKeys(year);
  const untilKeys = monthKey !== null ? yearMonthKeys(year).filter((key) => key <= monthKey) : yearMonthKeys(year);
  const spentOf = (itemId: string, keys: readonly string[]) =>
    narrowRecords(records, keys, (item) => item.specialItemId === itemId).reduce(
      (total, record) => total + record.items.reduce((inner, item) => inner + item.amount, 0),
      0,
    );
  const byItem = new Map<string, { id: string; name: string; category: string; budget: number }>();
  for (const row of rows) {
    const entry = byItem.get(row.item.id) ?? { id: row.item.id, name: row.item.name, category: row.item.category, budget: 0 };
    entry.budget += row.budget;
    byItem.set(row.item.id, entry);
  }
  const items = [...byItem.values()]
    .map((entry) => ({ ...entry, spent: spentOf(entry.id, periodKeys), spentToDate: spentOf(entry.id, untilKeys) }))
    .filter((entry) => entry.budget > 0 || entry.spent > 0)
    .sort((a, b) => b.spent - a.spent || b.budget - a.budget || a.name.localeCompare(b.name, 'ja'));
  const narrowed = narrowRecords(records, periodKeys, (item) => item.specialItemId !== null && expenseItemIds.has(item.specialItemId));
  return { ...review, items, records: narrowed };
}

// ---- 記録の入力（記録の詳細・品目の画面）の形 ----

/** 品目の画面の1行。金額は 個数 × 単価。 */
export interface EditorLine {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  memo: string;
}

/** 品目の種類のまとまり（記録の詳細の1行、品目の画面1枚）。 */
export interface EditorGroup {
  key: string;
  categoryId: string | null;
  specialItemId: string | null;
  specialPlanId: string | null;
  lines: EditorLine[];
}

export const editorLineAmount = (line: Pick<EditorLine, 'quantity' | 'unitPrice'>) => line.unitPrice * line.quantity;

export const editorGroupTotal = (group: Pick<EditorGroup, 'lines'>) =>
  group.lines.reduce((sum, line) => sum + editorLineAmount(line), 0);

/** 品名も金額も無い行（空の行を押しただけ）。保存しない。 */
export const isBlankLine = (line: EditorLine) => line.name.trim() === '' && line.unitPrice === 0;

/** 保存してある品目を、入力の形にする（種類ごとにまとめる）。 */
export function groupsFromItems(items: readonly MoneyItem[], nextKey: () => string): EditorGroup[] {
  return groupItems(items).map((group) => ({
    key: nextKey(),
    categoryId: group.categoryId,
    specialItemId: group.specialItemId,
    specialPlanId: group.specialPlanId,
    lines: group.items.map((item) => {
      // 金額だけの品目（単価なし）は、1個あたりに直す。割り切れなければ1個として扱う。
      const divisible = item.amount % item.quantity === 0;
      return {
        key: nextKey(),
        name: item.name,
        quantity: item.unitPrice === null && !divisible ? 1 : item.quantity,
        unitPrice: item.unitPrice ?? (divisible ? item.amount / item.quantity : item.amount),
        memo: item.memo,
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
        specialItemId: group.specialItemId,
        specialPlanId: group.specialPlanId,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        name: line.name.trim(),
        memo: line.memo.trim(),
      })),
  );
}

/** 同じ種類（同じ特別費の予定）のまとまりか。 */
export const sameGroupTarget = (
  a: Pick<EditorGroup, 'categoryId' | 'specialItemId' | 'specialPlanId'>,
  b: Pick<EditorGroup, 'categoryId' | 'specialItemId' | 'specialPlanId'>,
) => a.categoryId === b.categoryId && a.specialItemId === b.specialItemId && a.specialPlanId === b.specialPlanId;

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
// 残高 = 最後に確定した残高 + その後の記録（支出・収入・振替）。確定した残高が無ければ記録だけから出す。
// 確定した残高は「その日の終わりの残高」なので、その日の記録は含まれている（足すのは翌日以降の記録）。

/** 今日の日付（YYYY-MM-DD。端末のローカル）。 */
export const dateKeyOfDate = (date: Date): string => `${monthKeyOfDate(date)}-${pad2(date.getDate())}`;

/** マイナスは「−¥1,234」。残高の表示に使う（formatYen は符号を付けない）。 */
export const formatBalance = (value: number): string => `${value < 0 ? '−' : ''}${formatYen(value)}`;

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
  /** 残高（円）。 */
  amount: number;
  /** 土台にした、最後に確定した残高。まだ確定していなければ null（記録だけから出した額）。 */
  confirmed: MoneyWalletBalance | null;
  /** 確定のあとの記録の増減（確定が無ければ記録の全部）。 */
  movement: number;
  /** 確定のあとの記録の件数。 */
  count: number;
}

/**
 * 出金元 walletId の、date の終わりの残高。date までの記録だけを数える（先の日付の記録は入れない）。
 * ignoreOnDate を立てると、date の確定を土台にしない（その日の確定を入れる前の「記録から出した額」を出すとき）。
 */
export function walletBalanceOn(
  walletId: string,
  date: string,
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
  ignoreOnDate = false,
): WalletBalanceResult {
  let confirmed: MoneyWalletBalance | null = null;
  for (const balance of balances) {
    if (balance.walletId !== walletId) continue;
    if (ignoreOnDate ? balance.balanceOn >= date : balance.balanceOn > date) continue;
    if (confirmed === null || balance.balanceOn > confirmed.balanceOn) confirmed = balance;
  }
  let movement = 0;
  let count = 0;
  for (const record of records) {
    if (record.walletId !== walletId && record.toWalletId !== walletId) continue;
    if (record.occurredOn > date || (confirmed !== null && record.occurredOn <= confirmed.balanceOn)) continue;
    movement += walletDelta(record, walletId);
    count += 1;
  }
  return { amount: (confirmed?.amount ?? 0) + movement, confirmed, movement, count };
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
          confirmed: null,
          movement: 0,
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
  /** 確定の前の確定と、そのあとの記録から出した額。 */
  expected: number;
  /** 確定した額 − 記録から出した額。前の確定が無い（はじめの残高）ときは null。 */
  diff: number | null;
}

/** 出金元の確定の履歴（新しい順）。確定のたびの、記録との差つき。 */
export function balanceChecks(
  walletId: string,
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
): BalanceCheck[] {
  return balances
    .filter((balance) => balance.walletId === walletId)
    .sort((a, b) => b.balanceOn.localeCompare(a.balanceOn))
    .map((balance) => {
      const before = walletBalanceOn(walletId, balance.balanceOn, records, balances, true);
      return { balance, expected: before.amount, diff: before.confirmed === null ? null : balance.amount - before.amount };
    });
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
 * 数え方は walletBalanceOn と同じ（補正した日はその額、それ以外の日は前の日の残高 + その日の記録）。
 * 記録も補正も無ければ空。今日より先の記録は入れない。
 */
export function dailyBalances(
  walletIds: readonly string[],
  records: readonly MoneyRecord[],
  balances: readonly MoneyWalletBalance[],
  asOf: string,
): BalancePoint[] {
  const ids = new Set(walletIds);
  const perWallet = new Map<string, { deltas: Map<string, number>; anchors: Map<string, number> }>();
  let start: string | null = null;
  const see = (date: string) => {
    if (date <= asOf && (start === null || date < start)) start = date;
  };
  const slot = (walletId: string) => {
    let entry = perWallet.get(walletId);
    if (!entry) {
      entry = { deltas: new Map(), anchors: new Map() };
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
    slot(balance.walletId).anchors.set(balance.balanceOn, balance.amount);
    see(balance.balanceOn);
  }
  if (start === null) return [];

  const days = Math.round((parseDateKey(asOf) - parseDateKey(start)) / DAY_MS) + 1;
  const totals = new Array<number>(days).fill(0);
  for (const { deltas, anchors } of perWallet.values()) {
    let amount = 0;
    for (let index = 0; index < days; index += 1) {
      const date = addDays(start, index);
      const anchor = anchors.get(date);
      amount = anchor !== undefined ? anchor : amount + (deltas.get(date) ?? 0);
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

/**
 * カードの請求の内訳。残高（マイナス＝未払い）が「請求済み」と「未請求」に分かれる。
 * 引き落としは締め日ごとにまとめて口座から落ちるので、残高には先月の請求と今月の利用が両方入っている。
 * 締め日が未設定のカードは null。未請求 ＝ 締め日のあとの利用（支出 − 返品。振替は入れない）、請求済み ＝ 未払い − 未請求。
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
  const unbilled = records
    .filter((record) => record.kind !== 'transfer' && record.walletId === wallet.id)
    .filter((record) => record.occurredOn > closedOn && record.occurredOn <= asOf)
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
