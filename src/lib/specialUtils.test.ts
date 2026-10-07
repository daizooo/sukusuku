// 特別費の年度の数え方と、予定・実績の突き合わせ（docs/home.md §5.4）。
// 実行: npm run test:special
import assert from 'node:assert/strict';

import {
  appliesInYear,
  buildYearRows,
  calendarYearOf,
  cycleLabel,
  fiscalYearOf,
  groupByMonth,
  isOverBudget,
  parseAmountInput,
  parseDateInput,
  sortPlans,
  yearTotals,
} from './specialUtils.ts';
import type { SpecialActual, SpecialItem } from '../types/app.ts';

// ---- 年度（4月始まり） ----
assert.equal(fiscalYearOf('2026-04-01'), 2026, '4月1日は新しい年度');
assert.equal(fiscalYearOf('2027-03-31'), 2026, '翌年3月末は同じ年度');
assert.equal(fiscalYearOf('2026-03-31'), 2025);
assert.equal(calendarYearOf(2026, 4), 2026);
assert.equal(calendarYearOf(2026, 12), 2026);
assert.equal(calendarYearOf(2026, 1), 2027, '年度の1月は翌年');

// ---- 金額の入力 ----
assert.equal(parseAmountInput('30,500'), 30500);
assert.equal(parseAmountInput('¥30500'), 30500);
assert.equal(parseAmountInput('３０５００円'), 30500);
assert.equal(parseAmountInput(' 0 '), 0);
assert.equal(parseAmountInput(''), null);
assert.equal(parseAmountInput('-5'), null);
assert.equal(parseAmountInput('12.5'), null);
assert.equal(parseAmountInput('abc'), null);

// ---- 日付の入力 ----
assert.equal(parseDateInput('2026-07-20'), '2026-07-20');
assert.equal(parseDateInput('2026/7/5'), '2026-07-05');
assert.equal(parseDateInput(' 2026.07.20 '), '2026-07-20');
assert.equal(parseDateInput('2026-02-30'), null, '存在しない日付');
assert.equal(parseDateInput('2026-13-01'), null);
assert.equal(parseDateInput('7月20日'), null);
assert.equal(parseDateInput(''), null);

assert.equal(cycleLabel(1), '毎年');
assert.equal(cycleLabel(2), '2年おき');
assert.equal(cycleLabel(0), '1回きり');

// ---- 周期 ----
assert.equal(appliesInYear({ cycleYears: 1, baseYear: null }, 2030), true, '毎年は起点が無ければいつでも');
assert.equal(appliesInYear({ cycleYears: 1, baseYear: 2027 }, 2026), false, '起点より前の年度には出ない');
assert.equal(appliesInYear({ cycleYears: 1, baseYear: 2027 }, 2028), true);
assert.equal(appliesInYear({ cycleYears: 2, baseYear: 2026 }, 2026), true);
assert.equal(appliesInYear({ cycleYears: 2, baseYear: 2026 }, 2027), false, '2年おきは間の年に出ない');
assert.equal(appliesInYear({ cycleYears: 2, baseYear: 2026 }, 2028), true);
assert.equal(appliesInYear({ cycleYears: 2, baseYear: 2026 }, 2024), false, '起点より前には出ない');
assert.equal(appliesInYear({ cycleYears: 0, baseYear: 2026 }, 2026), true, '1回きりはその年度だけ');
assert.equal(appliesInYear({ cycleYears: 0, baseYear: 2026 }, 2027), false);
assert.equal(appliesInYear({ cycleYears: 3, baseYear: null }, 2026), false, '起点が無い周期は出さない');

// ---- 行の組み立て ----
const item = (patch: Partial<SpecialItem> & Pick<SpecialItem, 'id' | 'name'>): SpecialItem => ({
  kind: 'expense',
  category: '',
  cycleYears: 1,
  baseYear: null,
  note: '',
  position: 0,
  plans: [],
  ...patch,
});
const actual = (patch: Partial<SpecialActual> & Pick<SpecialActual, 'id' | 'itemId' | 'occurredOn' | 'amount'>): SpecialActual => ({
  recordId: `record-${patch.id}`,
  planId: null,
  note: '',
  ...patch,
});

const oil = item({
  id: 'oil',
  name: 'オイル交換',
  plans: [
    { id: 'oil-jul', month: 7, amount: 14000, tentative: false },
    { id: 'oil-jan', month: 1, amount: 14000, tentative: false },
  ],
});
const inspection = item({
  id: 'sha',
  name: '車検',
  cycleYears: 2,
  baseYear: 2026,
  plans: [{ id: 'sha-p', month: null, amount: 46000, tentative: false }],
});
const trip = item({
  id: 'trip',
  name: '旅行',
  plans: [{ id: 'trip-p', month: 12, amount: 50000, tentative: true }],
});
const bonus = item({
  id: 'bonus',
  name: '賞与',
  kind: 'income',
  plans: [{ id: 'bonus-p', month: 6, amount: 400000, tentative: false }],
});
const items = [oil, inspection, trip, bonus];

const actuals = [
  actual({ id: 'a1', itemId: 'oil', planId: 'oil-jul', occurredOn: '2026-07-20', amount: 13722 }),
  // 予定外（予定にひも付かない）
  actual({ id: 'a2', itemId: 'trip', occurredOn: '2026-08-05', amount: 8000 }),
  // 前の年度の実績は、この年度には入らない
  actual({ id: 'a3', itemId: 'oil', planId: 'oil-jul', occurredOn: '2025-07-20', amount: 99999 }),
  actual({ id: 'a4', itemId: 'bonus', planId: 'bonus-p', occurredOn: '2026-06-10', amount: 410213 }),
];

const rows2026 = buildYearRows(items, actuals, 2026, 'expense');
const byKey = (key: string) => rows2026.find((row) => row.key === key)!;
assert.equal(rows2026.length, 5, '予定4行(オイル2・車検・旅行)＋予定外1行。収入は含まない');
assert.equal(byKey('plan:oil-jul').actual, 13722, 'ひも付く実績は予定の実績になる');
assert.equal(byKey('plan:oil-jan').actual, null, 'まだ「済」でない予定は実績なし');
assert.equal(byKey('plan:sha-p').month, null, '月未定で実績も無ければ月は null');
assert.equal(byKey('plan:trip-p').tentative, true);
assert.equal(byKey('actual:a2').budget, 0, '予定外の行は予算0');
assert.equal(byKey('actual:a2').month, 8, '予定外の行は実績の月に置く');
assert.equal(rows2026.some((row) => row.key === 'actual:a3'), false, '前の年度の実績は入らない');

// 2年おきの車検は、間の年度には出ない
const rows2027 = buildYearRows(items, actuals, 2027, 'expense');
assert.equal(rows2027.some((row) => row.item.id === 'sha'), false);
assert.equal(buildYearRows(items, actuals, 2028, 'expense').some((row) => row.item.id === 'sha'), true);
// 前の年度の実績が、その年度の予定にひも付く
assert.equal(buildYearRows(items, actuals, 2025, 'expense').find((r) => r.key === 'plan:oil-jul')!.actual, 99999);

// 収入は別に数える
const income = buildYearRows(items, actuals, 2026, 'income');
assert.deepEqual(yearTotals(income), { budget: 400000, actual: 410213, diff: -10213 });

// 年間の予算・実績・差異（差異＝予算−実績）
assert.deepEqual(yearTotals(rows2026), { budget: 14000 + 14000 + 46000 + 50000, actual: 13722 + 8000, diff: 124000 - 21722 });

// 月ごと（4月→3月の順、未定は最後）
const groups = groupByMonth(rows2026);
assert.deepEqual(groups.map((group) => group.month), [7, 8, 12, 1, null]);
assert.equal(groups[0].budget, 14000);
assert.equal(groups[0].actual, 13722);
assert.equal(groups[1].budget, 0, '予定外だけの月は予算0');

// 月未定の予定でも、「済」にしたら実績の月に置く
const paidLater = buildYearRows(
  items,
  [...actuals, actual({ id: 'a5', itemId: 'sha', planId: 'sha-p', occurredOn: '2026-11-03', amount: 47000 })],
  2026,
  'expense',
);
assert.equal(paidLater.find((row) => row.key === 'plan:sha-p')!.month, 11);

// 周期を変えて出なくなった年度でも、ひも付いた実績は消さない（予定外の行として残す）
const changed = item({ ...oil, cycleYears: 0, baseYear: 2030 });
const orphan = buildYearRows([changed], actuals, 2026, 'expense');
assert.deepEqual(orphan.map((row) => row.key), ['actual:a1']);

// 超過の判定は支出だけ
assert.equal(isOverBudget(byKey('actual:a2')), true, '予算0で払った予定外は超過');
assert.equal(isOverBudget(byKey('plan:oil-jul')), false);
assert.equal(isOverBudget(income[0]), false, '収入は超過にしない');

// ---- 予定の並べ替え ----
assert.deepEqual(
  sortPlans([{ month: 1 }, { month: null }, { month: 4 }, { month: 12 }]).map((plan) => plan.month),
  [4, 12, 1, null],
);

console.log('specialUtils: all passed');
