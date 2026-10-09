// 特別費の年の数え方と、予定・実績の突き合わせ。docs/home.md §5.4・docs/kakei.md §4.3。
// mobile版の `mobile/src/lib/specialUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 特別費は年（1月〜12月）で締める（2026-10-09に、4月始まりの年度から変えた）。月の並びも1月→12月。
// 1つの項目が年に複数回出る（予定が複数行）・n年おきに出る（周期）・1回きり、のどれも
// 「その年に出る予定の行」を作る形にそろえて、画面はその行を月ごとに並べるだけにする。
// 生活費の予算も同じく年ごとの月額（2026-10-09にすべて暦年にそろえた）。
//
// 実績は2通り。予定にひも付く（「済」を押した。plan_id がある）ものは、その予定の行の実績になる。
// ひも付かないもの（予定外の出費・予定を消した実績）は、予算0の行として実績の月に並ぶ。

import type { SpecialActual, SpecialItem, SpecialKind } from '@/types/app';

/** 年の中の月の並び（1月→12月）。 */
export const YEAR_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** 周期の入力で選べる範囲（DBの check と同じ上限）。 */
export const MAX_CYCLE_YEARS = 50;

const pad2 = (value: number) => String(value).padStart(2, '0');

/** YYYY-MM-DD が属する年（西暦）。 */
export function yearOf(dateKey: string): number {
  return Number(dateKey.split('-')[0]);
}

/** 今日（Date）が属する年。 */
export function yearOfDate(date: Date): number {
  return date.getFullYear();
}

/** 年の表示（特別費・振り返りの年）。 */
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

/** 日付の入力を読む。「2026-07-20」「2026/7/20」「2026.07.20」を受け付け、YYYY-MM-DD にそろえる。存在しない日付は null。 */
export function parseDateInput(text: string): string | null {
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text.trim());
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** 周期の表示。 */
export function cycleLabel(cycleYears: number): string {
  if (cycleYears === 0) return '1回きり';
  if (cycleYears === 1) return '毎年';
  return `${cycleYears}年おき`;
}

/** その年に出る項目か。毎年は起点の年以降すべて、n年おきは起点から n 年ごと、1回きりは起点の年だけ。 */
export function appliesInYear(
  item: Pick<SpecialItem, 'cycleYears' | 'baseYear'>,
  year: number,
): boolean {
  if (item.cycleYears === 1) return item.baseYear === null || year >= item.baseYear;
  if (item.baseYear === null) return false;
  if (item.cycleYears === 0) return year === item.baseYear;
  return year >= item.baseYear && (year - item.baseYear) % item.cycleYears === 0;
}

/** 画面の1行。予定1回ぶん、または予定外の実績1件。 */
export interface SpecialRow {
  key: string;
  item: SpecialItem;
  /** 予定の行なら予定のid。予定外の実績の行は null。 */
  planId: string | null;
  /** 行を置く月（1〜12）。月未定で実績も無いものは null。 */
  month: number | null;
  tentative: boolean;
  /** 予算。予定外の行は 0。 */
  budget: number;
  /** 実績の合計。まだ無ければ null（「済」にしていない）。 */
  actual: number | null;
  /** この行の実績（予定の行は複数のこともある）。 */
  actuals: SpecialActual[];
}

const monthOfDate = (dateKey: string) => Number(dateKey.split('-')[1]);

const byName = (a: SpecialItem, b: SpecialItem) =>
  a.position !== b.position ? a.position - b.position : a.name.localeCompare(b.name, 'ja');

/**
 * ある年の行を作る。kind の項目だけ。
 *
 * - 年に出る項目の予定は、1回ぶんを1行にする。ひも付く実績（その年のもの）を足して実績にする
 * - 予定にひも付かない実績・出ない年の項目にひも付いた実績は、予算0の行にする（実績の月に置く）
 */
export function buildYearRows(
  items: readonly SpecialItem[],
  actuals: readonly SpecialActual[],
  year: number,
  kind: SpecialKind,
): SpecialRow[] {
  const rows: SpecialRow[] = [];
  const used = new Set<string>();
  const sortedItems = items.filter((item) => item.kind === kind).sort(byName);

  for (const item of sortedItems) {
    if (!appliesInYear(item, year)) continue;
    for (const plan of item.plans) {
      const linked = actuals.filter(
        (actual) => actual.planId === plan.id && yearOf(actual.occurredOn) === year,
      );
      linked.forEach((actual) => used.add(actual.id));
      rows.push({
        key: `plan:${plan.id}`,
        item,
        planId: plan.id,
        month: plan.month ?? (linked.length > 0 ? monthOfDate(linked[0].occurredOn) : null),
        tentative: plan.tentative,
        budget: plan.amount,
        actual: linked.length > 0 ? linked.reduce((sum, actual) => sum + actual.amount, 0) : null,
        actuals: linked,
      });
    }
  }

  const itemById = new Map(sortedItems.map((item) => [item.id, item]));
  for (const actual of actuals) {
    const item = itemById.get(actual.itemId);
    if (!item || used.has(actual.id) || yearOf(actual.occurredOn) !== year) continue;
    rows.push({
      key: `actual:${actual.id}`,
      item,
      planId: null,
      month: monthOfDate(actual.occurredOn),
      tentative: false,
      budget: 0,
      actual: actual.amount,
      actuals: [actual],
    });
  }
  return rows;
}

export interface SpecialTotals {
  budget: number;
  actual: number;
  /** 予算 − 実績（シートの「差異」と同じ向き）。 */
  diff: number;
}

export function yearTotals(rows: readonly SpecialRow[]): SpecialTotals {
  const budget = rows.reduce((sum, row) => sum + row.budget, 0);
  const actual = rows.reduce((sum, row) => sum + (row.actual ?? 0), 0);
  return { budget, actual, diff: budget - actual };
}

export interface SpecialMonthGroup extends SpecialTotals {
  /** 月（1〜12）。月未定は null。 */
  month: number | null;
  rows: SpecialRow[];
}

/** 月ごとにまとめる。年の月の順（1月→12月）で、行のある月だけ。月未定は最後。 */
export function groupByMonth(rows: readonly SpecialRow[]): SpecialMonthGroup[] {
  const order: (number | null)[] = [...YEAR_MONTHS, null];
  return order
    .map((month) => {
      const inMonth = rows.filter((row) => row.month === month);
      return { month, rows: inMonth, ...yearTotals(inMonth) };
    })
    .filter((group) => group.rows.length > 0);
}

/** 支出の行が予算を超えているか（予算のある行は実績が予算より多い、予算0の予定外は実績があれば）。 */
export const isOverBudget = (row: SpecialRow): boolean =>
  row.item.kind === 'expense' && row.actual !== null && row.actual > row.budget;

/** 項目の予定の月を、年の並び（1月→12月、未定は最後）にそろえる。 */
export function sortPlans<T extends { month: number | null }>(plans: readonly T[]): T[] {
  const rank = (month: number | null) => (month === null ? 99 : YEAR_MONTHS.indexOf(month));
  return [...plans].sort((a, b) => rank(a.month) - rank(b.month));
}
