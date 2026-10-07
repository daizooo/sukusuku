// 家計タブの数え方（月の集計・予算との差・種類の並び・電卓）。docs/kakei.md §3〜§5。
// mobile版の `mobile/src/lib/moneyUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 年度は特別費と同じ4月始まり（2026年4月〜2027年3月＝2026年度）。予算は大分類・年度ごとの月額で、
// その年度の予算が無ければ前の年度の額を使う（毎年入れ直さなくてよいように）。
//
// 月の収支＝収入 − 生活費 − 貯金。特別費（特別費の項目を持つ品目）は月の収支に入れず、別枠で数える
// （docs/kakei.md §4.1）。貯金は、貯金用の出金元への振替。ほかの振替は集計に入れない。

import type {
  MoneyBudget,
  MoneyCategory,
  MoneyCategoryKind,
  MoneyItem,
  MoneyItemDraft,
  MoneyRecord,
  MoneyRecordKind,
  MoneyWallet,
  MoneyWalletType,
  SpecialActual,
} from '@/types/app';
import type { SpecialRow } from '@/lib/specialUtils';

const pad2 = (value: number) => String(value).padStart(2, '0');

// ---- 月・年度 ----

/** 年度の最初の月（特別費と同じ）。 */
const FISCAL_START_MONTH = 4;

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

/** 月（YYYY-MM）が属する年度。2027-02 は 2026。 */
export function fiscalYearOfMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number);
  return month >= FISCAL_START_MONTH ? year : year - 1;
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
];

export const walletTypeLabel = (type: MoneyWalletType) =>
  WALLET_TYPES.find((entry) => entry.id === type)?.label ?? '';

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

/** その年度の大分類の月の予算。その年度に無ければ、前の年度のいちばん近いもの。どこにも無ければ null。 */
export function budgetFor(budgets: readonly MoneyBudget[], categoryId: string, fiscalYear: number): number | null {
  let found: MoneyBudget | null = null;
  for (const budget of budgets) {
    if (budget.categoryId !== categoryId || budget.fiscalYear > fiscalYear) continue;
    if (found === null || budget.fiscalYear > found.fiscalYear) found = budget;
  }
  return found?.monthlyAmount ?? null;
}

// ---- 記録 ----

/** 記録の合計（品目の合計）。 */
export const recordTotal = (record: Pick<MoneyRecord, 'items'>): number =>
  record.items.reduce((sum, item) => sum + item.amount, 0);

/** 新しい順（日付が同じなら入った順の逆）。 */
export function sortRecordsDesc(records: readonly MoneyRecord[]): MoneyRecord[] {
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

/** 最近使ったお店（新しい順・重複なし）。 */
export function recentStores(records: readonly MoneyRecord[], limit = 12): string[] {
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
 * 生活費のタイル。予算を超えた順（超えた額の大きい順）に、予算どおり・残りの少ない順が続く
 * （予算 − 実績 の小さい順）。使わなくした大分類は、その月に使っていれば出す。
 */
export function buildBudgetTiles(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  monthKey: string,
): BudgetTile[] {
  const fiscalYear = fiscalYearOfMonth(monthKey);
  const spend = livingSpendByTop(records, categories, monthKey);
  return topCategories(categories, 'living', true)
    .filter((category) => !category.archived || (spend.get(category.id) ?? 0) > 0)
    .map((category) => {
      const budget = budgetFor(budgets, category.id, fiscalYear);
      const actual = spend.get(category.id) ?? 0;
      return {
        category,
        budget,
        actual,
        diff: (budget ?? 0) - actual,
        percent: budget !== null && budget > 0 ? Math.round((actual / budget) * 100) : null,
      };
    })
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => (a.tile.diff !== b.tile.diff ? a.tile.diff - b.tile.diff : a.index - b.index))
    .map((entry) => entry.tile);
}

export interface MonthSummary {
  /** 収入（特別収入を除く）。 */
  income: number;
  /** 生活費の実績。 */
  living: number;
  /** 生活費の予算の合計。 */
  livingBudget: number;
  /** 貯金（貯金用の出金元への振替）。 */
  saving: number;
  /** 貯金の目標の合計。 */
  savingTarget: number;
  /** 特別費（支出）の実績。月の収支には入れない。 */
  special: number;
  /** 月の収支＝収入 − 生活費 − 貯金。 */
  balance: number;
  /** 生活費が予算どおりなら残る予定だった額＝収入 − 生活費の予算 − 貯金。 */
  plannedBalance: number;
}

export function buildMonthSummary(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  wallets: readonly MoneyWallet[],
  monthKey: string,
): MonthSummary {
  const savingWallets = new Set(wallets.filter((wallet) => wallet.isSaving).map((wallet) => wallet.id));
  let income = 0;
  let living = 0;
  let saving = 0;
  let special = 0;
  for (const record of recordsInMonth(records, monthKey)) {
    if (record.kind === 'transfer') {
      if (record.toWalletId !== null && savingWallets.has(record.toWalletId)) saving += recordTotal(record);
      continue;
    }
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
  const fiscalYear = fiscalYearOfMonth(monthKey);
  const livingBudget = topCategories(categories, 'living').reduce(
    (sum, category) => sum + (budgetFor(budgets, category.id, fiscalYear) ?? 0),
    0,
  );
  const savingTarget = wallets
    .filter((wallet) => wallet.isSaving && !wallet.archived)
    .reduce((sum, wallet) => sum + (wallet.savingTarget ?? 0), 0);
  return {
    income,
    living,
    livingBudget,
    saving,
    savingTarget,
    special,
    balance: income - living - saving,
    plannedBalance: income - livingBudget - saving,
  };
}

/** 年度の月の並び（4月→3月）の YYYY-MM。 */
export function fiscalMonthKeys(fiscalYear: number): string[] {
  return Array.from({ length: 12 }, (_, index) => shiftMonth(`${fiscalYear}-04`, index));
}

export interface YearMonthRow {
  monthKey: string;
  income: number;
  living: number;
  saving: number;
  /** 月の収支（収入 − 生活費 − 貯金）。 */
  balance: number;
  /** 生活費の予算 − 実績。 */
  livingDiff: number;
}

export interface YearSummary {
  months: YearMonthRow[];
  total: Omit<YearMonthRow, 'monthKey'>;
}

/**
 * 年度の収支（docs/kakei.md §4.2）。月ごとの 収入・生活費・貯金・収支 と年間の合計。特別費は入れない。
 * upTo（YYYY-MM）より後の月は、まだ来ていないので合計に入れない（行は 0 のまま返す）。
 */
export function buildYearSummary(
  records: readonly MoneyRecord[],
  categories: readonly MoneyCategory[],
  budgets: readonly MoneyBudget[],
  wallets: readonly MoneyWallet[],
  fiscalYear: number,
  upTo: string,
): YearSummary {
  const total = { income: 0, living: 0, saving: 0, balance: 0, livingDiff: 0 };
  const months = fiscalMonthKeys(fiscalYear).map((monthKey) => {
    if (monthKey > upTo) return { monthKey, income: 0, living: 0, saving: 0, balance: 0, livingDiff: 0 };
    const summary = buildMonthSummary(records, categories, budgets, wallets, monthKey);
    const row = {
      monthKey,
      income: summary.income,
      living: summary.living,
      saving: summary.saving,
      balance: summary.balance,
      livingDiff: summary.livingBudget - summary.living,
    };
    total.income += row.income;
    total.living += row.living;
    total.saving += row.saving;
    total.balance += row.balance;
    total.livingDiff += row.livingDiff;
    return row;
  });
  return { months, total };
}

export interface SpecialProgress {
  /** 年度の特別費の予算（予定の合計）。 */
  yearBudget: number;
  /** その月に払った特別費。 */
  spentThisMonth: number;
  /** 年度の初めからその月までに払った特別費。 */
  spentToDate: number;
  /** 年度の予算の残り（予算 − ここまで払った額）。 */
  remaining: number;
  /** その月の予定で、まだ払っていないもの。 */
  pendingThisMonth: number;
}

/**
 * その月に、特別費の年度の予算がどれだけ減ったか（docs/kakei.md §4.1）。月の収支には入れない。
 * rows は specialUtils の buildYearRows(…, 年度, 'expense')。
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

// ---- 記録の入力（記録の詳細・品目の画面）の形 ----

/** 品目の画面の1行。金額は 個数 × 単価。 */
export interface EditorLine {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
  productId: string | null;
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
        productId: item.productId,
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
        productId: line.productId,
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
