// 家計タブの数え方（docs/kakei.md §3〜§5）。
// 実行: npm run test:money
import assert from 'node:assert/strict';

import {
  budgetFor,
  canPickProductsFor,
  buildSpecialProgress,
  buildSpecialReview,
  buildYearSummary,
  buildBudgetTiles,
  buildMonthSummary,
  cardScheduleLabel,
  categoryPath,
  estimatesInMonth,
  evaluateCalc,
  formatDayOfMonth,
  recurringHistory,
  recurringScheduleLabel,
  fiscalYearOfMonth,
  formatSignedYen,
  groupsFromItems,
  itemsFromGroups,
  frequentCategoryIds,
  guessIconKey,
  iconKeyOf,
  groupItems,
  groupRecordsByDay,
  itemNamesLabel,
  itemSummary,
  lastWalletId,
  pressCalcKey,
  recentStores,
  shiftMonth,
  specialActualsFromRecords,
  storeChoices,
} from './moneyUtils.ts';
import { buildYearRows } from './specialUtils.ts';
import type { MoneyBudget, MoneyCategory, MoneyItem, MoneyRecord, MoneyStore, MoneyWallet, SpecialItem } from '../types/app.ts';

// ---- 月・年度 ----
assert.equal(shiftMonth('2026-12', 1), '2027-01');
assert.equal(shiftMonth('2026-01', -1), '2025-12');
assert.equal(shiftMonth('2026-09', -12), '2025-09');
assert.equal(fiscalYearOfMonth('2026-04'), 2026);
assert.equal(fiscalYearOfMonth('2027-03'), 2026, '3月は前の年度');
assert.equal(formatSignedYen(1200), '+¥1,200');
assert.equal(formatSignedYen(-3800), '−¥3,800');
assert.equal(formatSignedYen(0), '¥0');

// ---- 種類 ----
const cat = (id: string, name: string, parentId: string | null, extra: Partial<MoneyCategory> = {}): MoneyCategory => ({
  id,
  name,
  parentId,
  kind: 'living',
  icon: null,
  position: 0,
  archived: false,
  ...extra,
});
const categories: MoneyCategory[] = [
  cat('food', '食費', null, { position: 1 }),
  cat('grocery', '食料品', 'food'),
  cat('eatout', '外食', 'food'),
  cat('med', '医療費', null, { position: 2 }),
  cat('drug', '薬', 'med'),
  cat('house', '住居費', null, { position: 0 }),
  cat('old', '昔の種類', null, { position: 3, archived: true }),
  cat('salary', '給料', null, { kind: 'income' }),
];
assert.equal(categoryPath(categories, 'grocery'), '食費 › 食料品');
assert.equal(categoryPath(categories, 'food'), '食費');
assert.equal(categoryPath(categories, null), '');

// ---- アイコン（決めていなければ名前から） ----
assert.equal(guessIconKey('食費'), 'food');
assert.equal(guessIconKey('食料品'), 'grocery', '食料品は「食」より先に当てる');
assert.equal(guessIconKey('日用品・雑貨費'), 'daily');
assert.equal(guessIconKey('通信費'), 'phone');
assert.equal(guessIconKey('インターネット'), 'wifi');
assert.equal(guessIconKey('子ども費'), 'baby');
assert.equal(guessIconKey('なにか'), 'other');
assert.equal(iconKeyOf({ name: '食費', icon: 'cafe' }), 'cafe', '決めたアイコンが先');
assert.equal(iconKeyOf(null), 'other');

// ---- 日用品から選ぶ（docs/kakei.md §3.2） ----
assert.equal(canPickProductsFor(categories, [], 'grocery'), false, '台帳が空なら出さない');
assert.equal(canPickProductsFor(categories, [{ moneyCategoryId: null }], 'grocery'), true, '食費は出す');
assert.equal(canPickProductsFor(categories, [{ moneyCategoryId: null }], 'drug'), false, '医療費は前に記録した品が無ければ出さない');
assert.equal(canPickProductsFor(categories, [{ moneyCategoryId: 'drug' }], 'drug'), true, '前に記録した品がある種類は出す');
assert.equal(canPickProductsFor(categories, [{ moneyCategoryId: 'drug' }], 'house'), false);
assert.equal(canPickProductsFor(categories, [{ moneyCategoryId: null }], null), false);

// ---- 予算（その年度に無ければ前の年度） ----
const budgets: MoneyBudget[] = [
  { id: 'b1', categoryId: 'food', fiscalYear: 2025, monthlyAmount: 55000 },
  { id: 'b2', categoryId: 'food', fiscalYear: 2026, monthlyAmount: 60000 },
  { id: 'b3', categoryId: 'med', fiscalYear: 2024, monthlyAmount: 5000 },
  { id: 'b4', categoryId: 'house', fiscalYear: 2026, monthlyAmount: 85000 },
];
assert.equal(budgetFor(budgets, 'food', 2026), 60000);
assert.equal(budgetFor(budgets, 'food', 2027), 60000, '翌年度は今の額のまま');
assert.equal(budgetFor(budgets, 'food', 2025), 55000);
assert.equal(budgetFor(budgets, 'food', 2024), null, '前の年度にも無ければ未設定');
assert.equal(budgetFor(budgets, 'med', 2026), 5000);

// ---- 記録 ----
let seq = 0;
const item = (fields: Partial<MoneyItem>): MoneyItem => ({
  id: `i${(seq += 1)}`,
  amount: 0,
  categoryId: null,
  specialItemId: null,
  specialPlanId: null,
  productId: null,
  quantity: 1,
  unitPrice: null,
  name: '',
  memo: '',
  ...fields,
});
const record = (id: string, fields: Partial<MoneyRecord>): MoneyRecord => ({
  id,
  kind: 'expense',
  occurredOn: '2026-09-01',
  walletId: null,
  toWalletId: null,
  store: '',
  createdBy: null,
  isEstimate: false,
  recurringId: null,
  month: null,
  items: [],
  ...fields,
});
const wallets: MoneyWallet[] = [
  { id: 'card', name: 'カード', type: 'card', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, position: 0, archived: false },
  { id: 'bank', name: '生活費口座', type: 'bank', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, position: 1, archived: false },
  { id: 'save', name: '貯金口座', type: 'bank', isSaving: true, savingTarget: 30000, closeDay: null, payDay: null, payWalletId: null, position: 2, archived: false },
  { id: 'gone', name: '昔のカード', type: 'card', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, position: 3, archived: true },
];
const records: MoneyRecord[] = [
  record('r1', {
    occurredOn: '2026-09-06',
    walletId: 'card',
    store: 'スーパー',
    items: [
      item({ amount: 396, categoryId: 'grocery', name: '牛乳', quantity: 2, unitPrice: 198 }),
      item({ amount: 168, categoryId: 'grocery', name: '食パン' }),
      item({ amount: 500, categoryId: 'drug', name: '薬' }),
    ],
  }),
  record('r2', {
    occurredOn: '2026-09-14',
    walletId: 'gone',
    store: 'レストラン',
    items: [item({ amount: 70000, categoryId: 'eatout' })],
  }),
  record('r3', { occurredOn: '2026-09-25', kind: 'income', walletId: 'bank', items: [item({ amount: 300000, categoryId: 'salary' })] }),
  record('r4', {
    occurredOn: '2026-09-25',
    kind: 'transfer',
    walletId: 'bank',
    toWalletId: 'save',
    items: [item({ amount: 30000 })],
  }),
  record('r5', { occurredOn: '2026-09-26', kind: 'transfer', walletId: 'bank', toWalletId: 'card', items: [item({ amount: 9999 })] }),
  record('r6', {
    occurredOn: '2026-09-10',
    walletId: 'bank',
    items: [item({ amount: 58000, specialItemId: 'tax', specialPlanId: 'plan1', memo: '年払い' })],
  }),
  record('r7', { occurredOn: '2026-09-20', kind: 'income', items: [item({ amount: 400000, specialItemId: 'bonus' })] }),
  record('r8', { occurredOn: '2026-08-31', walletId: 'card', store: 'スーパー', items: [item({ amount: 1000, categoryId: 'grocery' })] }),
  record('r9', { occurredOn: '2026-09-02', walletId: 'card', store: '', items: [item({ amount: 85000, categoryId: 'house' })] }),
];

const summary = buildMonthSummary(records, categories, budgets, '2026-09');
assert.equal(summary.income, 300000, '特別収入は月の収入に入れない');
assert.equal(summary.living, 396 + 168 + 500 + 70000 + 85000);
assert.equal('saving' in summary, false, '貯金は記録なので、集計にも表示にも入れない（貯金用の口座への振替も数えない）');
assert.equal(summary.special, 58000, '特別費は別枠');
assert.equal(summary.livingBudget, 60000 + 5000 + 85000, '使わなくした大分類・収入は予算に入れない');
assert.equal(summary.balance, summary.income - summary.living, '生活費の収支＝収入 − 特別費以外の支出（特別費・振替は入れない）');
assert.equal(summary.plannedBalance, summary.income - summary.livingBudget);

const tiles = buildBudgetTiles(records, categories, budgets, '2026-09');
assert.deepEqual(
  tiles.map((tile) => [tile.category.id, tile.diff, tile.percent]),
  [
    ['house', 0, 100],
    ['food', 60000 - 70564, 118],
    ['med', 4500, 10],
  ],
  '種類の並び順のまま。使っていない使わなくした大分類は出さない',
);

assert.deepEqual(
  groupRecordsByDay(records.filter((entry) => entry.occurredOn.startsWith('2026-09-2'))).map((group) => [
    group.date,
    group.records.map((entry) => entry.id),
  ]),
  [
    ['2026-09-26', ['r5']],
    ['2026-09-25', ['r4', 'r3']],
    ['2026-09-20', ['r7']],
  ],
);

const groups = groupItems(records[0].items);
assert.deepEqual(
  groups.map((group) => [group.key, group.total, group.items.length]),
  [
    ['category:grocery', 564, 2],
    ['category:drug', 500, 1],
  ],
  '同じ種類の品目は1つにまとめる',
);
assert.equal(itemNamesLabel(groups[0].items), '牛乳 ×2・食パン');
// 記録の一覧の2行目（品名の要約。docs/kakei.md §3.2）
assert.equal(itemSummary([{ name: '牛乳' }, { name: ' 卵 ' }]), '牛乳、卵');
assert.equal(itemSummary([{ name: '牛乳' }, { name: '卵' }, { name: 'パン' }]), '牛乳、卵ほか');
assert.equal(itemSummary([{ name: '牛乳' }, { name: '牛乳' }, { name: '' }]), '牛乳', '同じ品名・空の品名は数えない');
assert.equal(itemSummary([{ name: '' }]), '');

assert.deepEqual(
  specialActualsFromRecords(records).map((actual) => [actual.recordId, actual.itemId, actual.planId, actual.occurredOn, actual.amount, actual.note]),
  [
    ['r6', 'tax', 'plan1', '2026-09-10', 58000, '年払い'],
    ['r7', 'bonus', null, '2026-09-20', 400000, ''],
  ],
);

assert.deepEqual(frequentCategoryIds(records, categories, 'living', 2), ['grocery', 'eatout'], '多い順、同じ回数なら最近使った順');
assert.deepEqual(recentStores(records), ['レストラン', 'スーパー']);

// お店の選択肢: 最近使ったお店を先に、続けて登録したお店の残りを名前順に。使わなくしたお店は出さない。
const storeList: MoneyStore[] = [
  { id: 's1', name: 'ドラッグ', archived: false },
  { id: 's2', name: 'スーパー', archived: false },
  { id: 's3', name: '閉店した店', archived: true },
];
assert.deepEqual(storeChoices(storeList, records), { recent: ['レストラン', 'スーパー'], registered: ['ドラッグ'] }, '最近使ったお店と重なる登録は、登録のほうに出さない');
assert.deepEqual(storeChoices(storeList, records, 1), { recent: ['レストラン'], registered: ['スーパー', 'ドラッグ'] }, '最近の件数を絞ると、残りは登録のほうへ');
assert.deepEqual(
  storeChoices([{ id: 's4', name: 'レストラン', archived: true }], records),
  { recent: ['スーパー'], registered: [] },
  '使わなくしたお店は、記録で使っていても候補に出さない',
);
assert.deepEqual(storeChoices([], records), { recent: ['レストラン', 'スーパー'], registered: [] }, '登録が無ければ最近使ったお店だけ');
assert.equal(lastWalletId(records, wallets, 'expense'), 'bank', '前回の出金元（特別費の記録も含む）');
assert.equal(
  lastWalletId(records.filter((entry) => entry.id !== 'r6'), wallets, 'expense'),
  'card',
  '使わなくした出金元は飛ばす',
);

// ---- 電卓 ----
assert.equal(evaluateCalc('198*2'), 396);
assert.equal(evaluateCalc('100+200*3'), 700, '× を先に');
assert.equal(evaluateCalc('1000/3'), 333, '円に丸める');
assert.equal(evaluateCalc('500-'), 500, '演算子で終わる式は最後の演算子を無視');
assert.equal(evaluateCalc('100-200'), null, '負は入れない');
assert.equal(evaluateCalc('5/0'), null);
assert.equal(evaluateCalc(''), null);
assert.equal(pressCalcKey('', '00'), '0');
assert.equal(pressCalcKey('0', '5'), '5');
assert.equal(pressCalcKey('12', '+'), '12+');
assert.equal(pressCalcKey('12+', '*'), '12*', '演算子は置き換える');
assert.equal(pressCalcKey('', '+'), '');
assert.equal(pressCalcKey('12', 'back'), '1');

// ---- 年度の収支 ----
const year = buildYearSummary(records, categories, budgets, 2026, '2026-09');
assert.equal(year.months.length, 12);
assert.equal(year.months[0].monthKey, '2026-04');
assert.equal(year.months[11].monthKey, '2027-03');
const september = year.months.find((row) => row.monthKey === '2026-09')!;
assert.equal(september.balance, summary.balance, '月の行は月の収支と同じ');
assert.equal(september.livingDiff, summary.livingBudget - summary.living);
const august = year.months.find((row) => row.monthKey === '2026-08')!;
assert.equal(august.living, 1000);
assert.equal(year.total.living, september.living + august.living, '記録の無い月は0');
assert.equal(year.recordedMonths, 2, '記録のある月だけを数える');
assert.equal(year.months[0].recorded, false);
assert.equal(year.total.livingDiff, september.livingDiff + august.livingDiff, '記録の無い月の予算は差に入れない');
assert.equal(year.total.balance, year.months.reduce((sum, row) => sum + row.balance, 0));
assert.equal(september.special, 58000, '年の月の行にも、その月の特別費を出す');
assert.equal(year.total.special, 58000, '特別費は年の合計にも別に数える（収支には入れない）');
assert.equal(year.total.balance, year.total.income - year.total.living, '年の収支も 収入 − 生活費');
// 生活費の記録が無く、特別費だけの月も、特別費は年に数える
const specialOnly = buildYearSummary(
  [record('s1', { occurredOn: '2026-07-10', items: [item({ amount: 30000, specialItemId: 'tax' })] })],
  categories,
  budgets,
  2026,
  '2026-09',
);
assert.equal(specialOnly.total.special, 30000);
assert.equal(specialOnly.recordedMonths, 0, '特別費だけの月は、生活費の収支を数える月には入れない');
assert.equal(specialOnly.months.find((row) => row.monthKey === '2026-07')!.special, 30000);

assert.equal(year.months.find((row) => row.monthKey === '2026-10')!.recorded, false, 'まだ来ていない月は数えない');
assert.equal(
  buildYearSummary(records, categories, budgets, 2026, '2026-08').total.living,
  1000,
  'upTo より後の月は合計に入れない',
);

// ---- 特別費の年度の予算の減り ----
const specialItems: SpecialItem[] = [
  {
    id: 'tax',
    kind: 'expense',
    category: '税金',
    name: '自動車税',
    cycleYears: 1,
    baseYear: null,
    note: '',
    position: 0,
    plans: [
      { id: 'plan1', month: 9, amount: 60000, tentative: false },
      { id: 'plan2', month: 9, amount: 10000, tentative: false },
    ],
  },
  { id: 'trip', kind: 'expense', category: '旅行', name: '旅行', cycleYears: 1, baseYear: null, note: '', position: 1, plans: [{ id: 'plan3', month: 12, amount: 100000, tentative: false }] },
];
const specialRows = buildYearRows(
  specialItems,
  [
    ...specialActualsFromRecords(records),
    { id: 'old', recordId: 'r0', itemId: 'trip', planId: null, occurredOn: '2026-05-03', amount: 20000, note: '' },
  ],
  2026,
  'expense',
);
assert.deepEqual(buildSpecialProgress(specialRows, '2026-09'), {
  yearBudget: 170000,
  spentThisMonth: 58000,
  spentToDate: 78000,
  remaining: 92000,
  pendingThisMonth: 1,
});
assert.deepEqual(buildSpecialProgress(specialRows, '2026-06'), {
  yearBudget: 170000,
  spentThisMonth: 0,
  spentToDate: 20000,
  remaining: 150000,
  pendingThisMonth: 0,
});

// 振り返りの特別費: 月はその月に払った額と、その月までの累計での予算の残り。年は年度ぜんたい
assert.deepEqual(buildSpecialReview(specialRows, '2026-09'), { yearBudget: 170000, spent: 58000, spentToDate: 78000, remaining: 92000 });
assert.deepEqual(buildSpecialReview(specialRows, '2026-06'), { yearBudget: 170000, spent: 0, spentToDate: 20000, remaining: 150000 });
assert.deepEqual(buildSpecialReview(specialRows, null), { yearBudget: 170000, spent: 78000, spentToDate: 78000, remaining: 92000 }, '年度ぜんたい');
assert.equal(buildSpecialReview([], '2026-09').remaining, 0);

// ---- 入力の形との行き来 ----
let key = 0;
const editorGroups = groupsFromItems(
  [...records[0].items, item({ amount: 1000, categoryId: 'drug', quantity: 3 })],
  () => `k${(key += 1)}`,
);
assert.equal(editorGroups.length, 2);
assert.deepEqual(
  editorGroups[1].lines.map((line) => [line.quantity, line.unitPrice]),
  [
    [1, 500],
    [1, 1000],
  ],
  '単価の無い品目は1個あたりに直す（割り切れなければ1個）',
);
editorGroups[0].lines.push({ key: 'blank', name: '', quantity: 1, unitPrice: 0, productId: null, memo: '' });
const saved = itemsFromGroups(editorGroups);
assert.equal(saved.length, 4, '空の行は保存しない');
assert.deepEqual(saved[0], {
  amount: 396,
  categoryId: 'grocery',
  specialItemId: null,
  specialPlanId: null,
  productId: null,
  quantity: 2,
  unitPrice: 198,
  name: '牛乳',
  memo: '',
});

// ---- 毎月の記録（docs/kakei.md §3.3・§3.4） ----
assert.equal(formatDayOfMonth(27), '27日');
assert.equal(formatDayOfMonth(31), '末日');
assert.equal(recurringScheduleLabel({ day: 27, months: null, holiday: 'next' }), '毎月27日（休日は翌営業日）');
assert.equal(recurringScheduleLabel({ day: 10, months: [12, 6], holiday: 'prev' }), '6・12月の10日（休日は前営業日）');
assert.equal(recurringScheduleLabel({ day: 31, months: null, holiday: 'none' }), '毎月末日（休日もそのまま）');
assert.equal(cardScheduleLabel({ closeDay: 15, payDay: 10 }), '15日締め・翌10日払い');
assert.equal(cardScheduleLabel({ closeDay: 31, payDay: 27 }), '末日締め・翌27日払い');
assert.equal(cardScheduleLabel({ closeDay: 5, payDay: 27 }), '5日締め・27日払い', '締め日より後の引き落とし日は同じ月');
assert.equal(cardScheduleLabel({ closeDay: 15, payDay: null }), '');
{
  const estimates = estimatesInMonth(
    [
      record('e1', { occurredOn: '2026-10-27', isEstimate: true, items: [item({ amount: 8000, categoryId: 'c' })] }),
      record('e2', { occurredOn: '2026-10-28', items: [item({ amount: 100, categoryId: 'c' })] }),
      record('e3', { occurredOn: '2026-10-10', kind: 'transfer', isEstimate: true, items: [item({ amount: 5000 })] }),
      record('e4', { occurredOn: '2026-11-27', isEstimate: true, items: [item({ amount: 8000, categoryId: 'c' })] }),
    ],
    '2026-10',
  );
  assert.deepEqual(estimates.map((entry) => entry.id), ['e1'], '収支に入る見込みだけ（カード代金の振替は除く）');
}

{
  const rule = { kind: 'expense' as const, walletId: 'bank', toWalletId: null, store: '電力', categoryId: 'elec', specialItemId: null };
  const history = recurringHistory(
    rule,
    [
      record('h1', { occurredOn: '2025-10-27', walletId: 'bank', store: '電力', items: [item({ amount: 9000, categoryId: 'elec' })] }),
      record('h2', { occurredOn: '2025-10-07', walletId: 'bank', store: '電力', items: [item({ amount: 1, categoryId: 'elec' })] }),
      record('h3', { occurredOn: '2026-09-28', walletId: 'bank', store: '電力 ', items: [item({ amount: 7000, categoryId: 'elec' }), item({ amount: 500, categoryId: 'elec' }), item({ amount: 99, categoryId: 'other' })] }),
      record('h4', { occurredOn: '2026-09-28', walletId: 'card', store: '電力', items: [item({ amount: 7000, categoryId: 'elec' })] }),
      record('h5', { occurredOn: '2026-10-01', walletId: 'bank', store: '電力', isEstimate: true, items: [item({ amount: 7000, categoryId: 'elec' })] }),
      record('h6', { occurredOn: '2026-08-27', walletId: 'bank', store: 'ガス', items: [item({ amount: 7000, categoryId: 'elec' })] }),
      record('h7', { occurredOn: '2026-10-08', walletId: 'bank', store: '電力', items: [item({ amount: 7000, categoryId: 'elec' })] }),
    ],
    '2026-10-08',
  );
  assert.deepEqual(history, [
    { occurredOn: '2026-09-28', amount: 7500 },
    { occurredOn: '2025-10-27', amount: 9000 },
  ], '出金元・お店・種類が同じで、見込みでない過去1年の記録だけ（同じ種類の品目は合計）');
}

console.log('moneyUtils: ok');
