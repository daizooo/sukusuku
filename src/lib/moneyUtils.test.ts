// 家計タブの数え方（docs/kakei.md §3〜§5）。
// 実行: npm run test:money
import assert from 'node:assert/strict';

import {
  addDays,
  balanceChanges,
  balanceChecks,
  cardBilling,
  dailyBalances,
  filterTrend,
  formatAxisYen,
  niceTicks,
  recordsOfWallet,
  budgetFor,
  buildWalletBalances,
  canPickProductsFor,
  formatBalance,
  walletBalanceOn,
  walletDelta,
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
  storeKey,
  matchesStore,
  formatGainRate,
  formatQuantity,
  holdingDailyValues,
  securitiesValueOn,
  securityRows,
  sumDailyPoints,
  totalDailyBalances,
  walletGain,
} from './moneyUtils.ts';
import { buildYearRows } from './specialUtils.ts';
import type { MoneyBudget, MoneyCategory, MoneyHolding, MoneyHoldingValue, MoneyItem, MoneyRecord, MoneySecurity, MoneyStore, MoneyWallet, MoneyWalletBalance, SpecialItem } from '../types/app.ts';

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
  { id: 'card', name: 'カード', type: 'card', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, iconColor: null, position: 0, archived: false },
  { id: 'bank', name: '生活費口座', type: 'bank', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, iconColor: null, position: 1, archived: false },
  { id: 'save', name: '貯金口座', type: 'bank', isSaving: true, savingTarget: 30000, closeDay: null, payDay: null, payWalletId: null, iconColor: null, position: 2, archived: false },
  { id: 'gone', name: '昔のカード', type: 'card', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, iconColor: null, position: 3, archived: true },
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

// お店の選択肢: 最近使ったお店を先に、続けて登録したお店の残りを使った回数の多い順に。使わなくしたお店は出さない。
const storeList: MoneyStore[] = [
  { id: 's1', name: 'ドラッグ', archived: false },
  { id: 's2', name: 'スーパー', archived: false },
  { id: 's3', name: '閉店した店', archived: true },
];
assert.deepEqual(storeChoices(storeList, records), { recent: ['レストラン', 'スーパー'], registered: ['ドラッグ'], others: [] }, '最近使ったお店と重なる登録は、登録のほうに出さない');
assert.deepEqual(storeChoices(storeList, records, 1), { recent: ['レストラン'], registered: ['スーパー', 'ドラッグ'], others: [] }, '最近の件数を絞ると、残りは登録のほうへ（使った回数の多い順）');
assert.deepEqual(
  storeChoices([{ id: 's4', name: 'レストラン', archived: true }], records),
  { recent: ['スーパー'], registered: [], others: [] },
  '使わなくしたお店は、記録で使っていても候補に出さない',
);
assert.deepEqual(storeChoices([], records), { recent: ['レストラン', 'スーパー'], registered: [], others: [] }, '登録が無ければ最近使ったお店だけ');
assert.deepEqual(storeChoices([], records, 1), { recent: ['レストラン'], registered: [], others: ['スーパー'] }, '登録していない前のお店は others に');

// 似たお店: 全角半角・かなの違い・空白と記号をそろえ、どちらかがもう片方を含めば当たり。
assert.equal(storeKey('よかもんね!城南店'), storeKey('よかもんね 城南店'));
assert.equal(storeKey('ＤＡＩＳＯ'), 'daiso');
assert.equal(storeKey('だいそー'), 'ダイソー');
assert.ok(matchesStore('ドラッグストアコスモス', 'コスモス'), '打った名前を含むお店');
assert.ok(matchesStore('ロッキー', 'ロッキー城南店'), '打った名前に含まれるお店（支店名つき）');
assert.ok(matchesStore('よかもんね!城南店', 'よかもんね城南'), '記号の違いは見ない');
assert.ok(!matchesStore('ローソン', 'セブンイレブン'));
assert.ok(!matchesStore('ン', 'セブンイレブン'), '1文字のお店は、打った名前に含まれても当たりにしない');
assert.ok(matchesStore('ローソン', ''), '何も打っていなければすべて');

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

// ---- 口座の残高（docs/kakei.md §9.3） ----
{
  const money = (id: string, fields: Partial<MoneyRecord>, amount: number) =>
    record(id, { ...fields, items: [item({ amount })] });
  const rs: MoneyRecord[] = [
    money('b1', { kind: 'income', walletId: 'bank', occurredOn: '2026-09-25' }, 300000),
    money('b2', { walletId: 'bank', occurredOn: '2026-09-28' }, 7000),
    money('b3', { kind: 'transfer', walletId: 'bank', toWalletId: 'save', occurredOn: '2026-10-01' }, 50000),
    money('b4', { walletId: 'card', occurredOn: '2026-10-02' }, 12000),
    money('b5', { kind: 'transfer', walletId: 'bank', toWalletId: 'card', occurredOn: '2026-10-05' }, 12000),
    money('b6', { walletId: 'bank', occurredOn: '2026-10-20' }, 999),
    money('b7', { walletId: null, occurredOn: '2026-10-02' }, 1),
  ];
  const bal = (id: string, walletId: string, balanceOn: string, amount: number): MoneyWalletBalance => ({ id, walletId, balanceOn, amount, showInHistory: true });
  assert.equal(walletDelta(rs[0], 'bank'), 300000, '収入は入金先に増える');
  assert.equal(walletDelta(rs[1], 'bank'), -7000, '支出は出金元から減る');
  assert.equal(walletDelta(rs[1], 'card'), 0, '関係ない出金元は変わらない');
  assert.equal(walletDelta(rs[2], 'bank'), -50000, '振替は出金元から減る');
  assert.equal(walletDelta(rs[2], 'save'), 50000, '振替は入金先に増える');
  assert.equal(formatBalance(-12000), '−¥12,000');
  assert.equal(formatBalance(300), '¥300');

  // 確定が無ければ、記録だけから出す（今日までの記録。先の日付は入れない）。
  const none = walletBalanceOn('bank', '2026-10-10', rs, []);
  assert.deepEqual([none.amount, none.confirmed, none.count], [300000 - 7000 - 50000 - 12000, null, 4]);
  assert.equal(walletBalanceOn('card', '2026-10-10', rs, []).amount, -12000 + 12000, 'カードは支出でマイナス、引き落としの振替で戻る');

  // 確定のあとの記録だけを足す。確定の日の記録は確定に含まれている。
  const confirmed = [bal('x1', 'bank', '2026-10-01', 240000), bal('x0', 'bank', '2026-09-01', 5)];
  const after = walletBalanceOn('bank', '2026-10-10', rs, confirmed);
  assert.deepEqual([after.amount, after.confirmed?.id, after.movement, after.count], [228000, 'x1', -12000, 1]);
  assert.equal(walletBalanceOn('bank', '2026-10-25', rs, confirmed).amount, 228000 - 999, '今日までに来た記録は入る');
  assert.equal(walletBalanceOn('bank', '2026-09-30', rs, confirmed).confirmed?.id, 'x0', '日付より先の確定は土台にしない');

  // 確定の履歴: 前の確定とそのあとの記録から出した額との差。最初の確定は差を持たない。
  const checks = balanceChecks('bank', rs, confirmed);
  assert.deepEqual(checks.map((check) => check.balance.id), ['x1', 'x0'], '新しい順');
  assert.deepEqual([checks[0].expected, checks[0].diff], [5 + 300000 - 7000 - 50000, 240000 - 243005]);
  assert.deepEqual([checks[1].expected, checks[1].diff], [0, null], '最初の確定は差を持たない（はじめの残高）');
  assert.equal(
    walletBalanceOn('bank', '2026-10-01', rs, confirmed, true).amount,
    checks[0].expected,
    'ignoreOnDate はその日の確定を土台にしない',
  );

  // 総残高: 使わなくした出金元は入れない。確定していない出金元の数を出す。
  const totals = buildWalletBalances(wallets, rs, [bal('y1', 'bank', '2026-10-10', 100000)], '2026-10-10');
  assert.deepEqual(totals.rows.map((row) => row.wallet.id), ['card', 'bank', 'save', 'gone']);
  assert.equal(totals.total, 0 + 100000 + 50000, 'カード0（支出と引き落としが相殺）+ 口座 + 貯金口座');
}

// ---- 口座の推移（docs/kakei.md §9.3） ----
{
  const money = (id: string, fields: Partial<MoneyRecord>, amount: number) =>
    record(id, { ...fields, items: [item({ amount })] });
  const rs: MoneyRecord[] = [
    money('t1', { kind: 'income', walletId: 'bank', occurredOn: '2026-10-01' }, 1000),
    money('t2', { walletId: 'bank', occurredOn: '2026-10-03' }, 300),
    money('t3', { kind: 'transfer', walletId: 'bank', toWalletId: 'save', occurredOn: '2026-10-03' }, 200),
    money('t4', { walletId: 'bank', occurredOn: '2026-10-09' }, 5),
  ];
  const anchor = (id: string, walletId: string, balanceOn: string, amount: number): MoneyWalletBalance => ({ id, walletId, balanceOn, amount, showInHistory: true });

  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');

  const bank = dailyBalances(['bank'], rs, [], '2026-10-05');
  assert.deepEqual(bank.map((point) => point.date), ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'], '最初の記録の日から今日まで1日1点（先の記録は入れない）');
  assert.deepEqual(bank.map((point) => point.amount), [1000, 1000, 500, 500, 500]);
  assert.deepEqual(bank, [1000, 1000, 500, 500, 500].map((amount, index) => ({ date: addDays('2026-10-01', index), amount })));

  // 補正した日はその額になり、その後はそこから積み上げる（walletBalanceOn と同じ数え方）。
  const fixed = dailyBalances(['bank'], rs, [anchor('a1', 'bank', '2026-10-02', 2000)], '2026-10-10');
  assert.deepEqual(fixed.map((point) => point.amount), [1000, 2000, 1500, 1500, 1500, 1500, 1500, 1500, 1495, 1495]);
  assert.equal(fixed[fixed.length - 1].amount, walletBalanceOn('bank', '2026-10-10', rs, [anchor('a1', 'bank', '2026-10-02', 2000)]).amount);

  // 複数の出金元は合計（振替は出金元から入金先へ動くだけなので、合計は変わらない）。
  const both = dailyBalances(['bank', 'save'], rs, [], '2026-10-04');
  assert.deepEqual(both.map((point) => point.amount), [1000, 1000, 700, 700], '振替の200は合計に影響しない');
  assert.deepEqual(dailyBalances(['bank'], [], [], '2026-10-04'), [], '記録も補正も無ければ空');

  assert.deepEqual(filterTrend(fixed, 'month', '2026-10-10').length, fixed.length, '1ヶ月は30日前から');
  assert.equal(filterTrend(fixed, 'all', '2026-10-10').length, 10);
  assert.equal(filterTrend(dailyBalances(['bank'], rs, [], '2026-12-10'), 'month', '2026-12-10')[0].date, '2026-11-10');

  assert.deepEqual(balanceChanges(fixed).map((point) => point.date), ['2026-10-09', '2026-10-03', '2026-10-02', '2026-10-01'], '変わった日だけ新しい順');

  assert.deepEqual(niceTicks(0, 25_000_000), [0, 10_000_000, 20_000_000, 30_000_000], '最大値（2,500万）を含む');
  assert.deepEqual(niceTicks(-100, 700), [-500, 0, 500, 1000], 'きりのよい間隔（最大値を含むところまで）');
  assert.deepEqual(niceTicks(5, 5), [5]);
  assert.equal(formatAxisYen(20_000_000), '2,000万');
  assert.equal(formatAxisYen(850_000), '85万');
  assert.equal(formatAxisYen(-9000), '−9,000');

  assert.deepEqual(recordsOfWallet(rs, 'save').map((entry) => entry.id), ['t3'], '入金先の記録も含む');
  assert.deepEqual(recordsOfWallet(rs, 'bank').map((entry) => entry.id), ['t4', 't3', 't2', 't1'], '新しい順');
}

// ---- カードの請求（請求済みと未請求。docs/kakei.md §9.3） ----
{
  const spend = (id: string, occurredOn: string, amount: number, extra: Partial<MoneyRecord> = {}) =>
    record(id, { walletId: 'card', occurredOn, items: [item({ amount })], ...extra });
  // 末日締め・25日払い。9月の利用 1万 は10月25日に落ちる。10月の利用 3千 はまだ請求前。
  const card = { id: 'card', closeDay: 31, payDay: 25 };
  const rs = [spend('c1', '2026-09-10', 6000), spend('c2', '2026-09-30', 4000), spend('c3', '2026-10-02', 3000)];
  const billing = cardBilling(card, -13000, rs, '2026-10-10');
  assert.deepEqual(billing, { billed: 10000, unbilled: 3000, closedOn: '2026-09-30', payOn: '2026-10-25' }, '残高には先月の請求と今月の利用が両方入る');
  // 引き落としの振替（口座 → カード）が入ると、請求済みだけが減る。
  const paid = cardBilling(card, -3000, [...rs, record('p', { kind: 'transfer', walletId: 'bank', toWalletId: 'card', occurredOn: '2026-10-25', items: [item({ amount: 10000 })] })], '2026-10-26');
  assert.deepEqual(paid, { billed: 0, unbilled: 3000, closedOn: '2026-09-30', payOn: '2026-10-25' }, '引き落としのあとは未請求だけ');
  // 15日締め・翌10日払い。
  assert.deepEqual(cardBilling({ id: 'card', closeDay: 15, payDay: 10 }, -500, [spend('d1', '2026-10-16', 500)], '2026-10-20'), { billed: 0, unbilled: 500, closedOn: '2026-10-15', payOn: '2026-11-10' });
  // 15日締め・25日払いは同じ月に落ちる。年をまたぐ締め日。
  assert.equal(cardBilling({ id: 'card', closeDay: 15, payDay: 25 }, 0, [], '2026-10-20')?.payOn, '2026-10-25');
  assert.deepEqual(cardBilling({ id: 'card', closeDay: 31, payDay: 27 }, -100, [], '2027-01-05'), { billed: 100, unbilled: 0, closedOn: '2026-12-31', payOn: '2027-01-27' });
  assert.equal(cardBilling({ id: 'card', closeDay: null, payDay: null }, -100, rs, '2026-10-10'), null, '締め日が無ければ内訳は出さない');
  assert.equal(cardBilling({ id: 'card', closeDay: 31, payDay: null }, -100, [], '2026-10-10')?.payOn, null);
}

// ---- 証券の評価額（docs/kakei.md §9.2） ----
{
  const sec = (id: string, kind: MoneySecurity['kind'], currency: 'JPY' | 'USD' = 'JPY'): MoneySecurity => ({
    id, name: id, kind, code: kind === 'cash' ? null : id, fundCode: null, currency, position: 0, archived: false,
  });
  const hold = (id: string, securityId: string, account: MoneyHolding['account'], quantity: number, costPrice: number | null, extra: Partial<MoneyHolding> = {}): MoneyHolding => ({
    id, walletId: 'sec', securityId, account, quantity, costPrice, archived: false, ...extra,
  });
  const val = (holdingId: string, valueOn: string, value: number, price = 0, cost: number | null = null): MoneyHoldingValue => ({
    holdingId, valueOn, quantity: 0, price, fx: 1, value, cost,
  });
  const securities = [{ ...sec('fund', 'jp_fund'), position: 1 }, sec('stock', 'us_stock', 'USD'), { ...sec('usd', 'cash', 'USD'), position: 0 }];
  // 投信を NISA と特定で、米国株を特定で、ドルの預り金を持つ。
  const holdings = [
    hold('h1', 'fund', 'nisa', 100000, 30000),
    hold('h2', 'fund', 'tokutei', 50000, 40000),
    hold('h3', 'stock', 'tokutei', 10, 15000),
    hold('h4', 'usd', 'tokutei', 100, null),
    hold('h5', 'stock', 'nisa', 5, 10000, { archived: true }),
  ];
  const values = [
    val('h1', '2026-10-06', 450000, 45000),
    val('h1', '2026-10-08', 460000, 46000),
    val('h2', '2026-10-08', 230000, 46000),
    val('h3', '2026-10-07', 240000, 160),
    val('h4', '2026-10-07', 15800, 1),
    val('h5', '2026-10-06', 120000, 160),
    val('h5', '2026-10-07', 0, 0),
  ];
  const data = { securities, holdings, values };

  assert.equal(securitiesValueOn(['sec'], holdings, values, '2026-10-08'), 460000 + 230000 + 240000 + 15800, 'その日の行が無い保有は前の日の行。使わなくした保有は 0');
  assert.equal(securitiesValueOn(['sec'], holdings, values, '2026-10-06'), 450000 + 120000);
  assert.equal(securitiesValueOn(['other'], holdings, values, '2026-10-08'), 0, 'ほかの口座の保有は入れない');

  assert.deepEqual(holdingDailyValues(['h1', 'h5'], values, '2026-10-08'), [
    { date: '2026-10-06', amount: 570000 },
    { date: '2026-10-07', amount: 450000 },
    { date: '2026-10-08', amount: 460000 },
  ], '行の無い日は前の日の額');
  assert.deepEqual(holdingDailyValues(['none'], values, '2026-10-08'), []);

  assert.deepEqual(
    sumDailyPoints([{ date: '2026-10-07', amount: 10 }, { date: '2026-10-08', amount: 20 }], [{ date: '2026-10-06', amount: 1 }, { date: '2026-10-08', amount: 3 }]),
    [{ date: '2026-10-06', amount: 1 }, { date: '2026-10-07', amount: 11 }, { date: '2026-10-08', amount: 23 }],
    '始まる前は 0、抜けは前の日の額',
  );
  assert.deepEqual(sumDailyPoints([], []), []);

  const rows = securityRows('sec', data, '2026-10-08');
  assert.deepEqual(
    rows.map((row) => `${row.security.id}:${row.holding.account}`),
    ['stock:tokutei', 'fund:tokutei', 'fund:nisa', 'usd:tokutei'],
    '預り区分ごとに1行。特定 → NISA… の順、同じ区分は銘柄の並び順、預り金は最後。使わなくした保有は入れない',
  );
  const fundNisa = rows[2];
  assert.equal(fundNisa.value, 460000);
  assert.equal(fundNisa.cost, 300000, '取得額 = 保有数 × 取得単価 ÷ 1万口');
  assert.equal(fundNisa.gain, 160000);
  assert.equal(Math.round((fundNisa.gainRate ?? 0) * 1000) / 1000, 0.533);
  assert.equal(fundNisa.price, 46000, '基準価額（1万口あたり）');
  assert.equal(fundNisa.priceOn, '2026-10-08');
  const stock = rows[0];
  assert.equal(stock.gain, 240000 - 150000);
  assert.equal(stock.price, 160, 'ドル建ては × 為替の円（ここでは為替 1）');
  const usd = rows[3];
  assert.equal(usd.cost, null, '預り金は取得額なし');
  assert.equal(usd.gain, null);
  assert.equal(usd.price, null);

  assert.deepEqual(walletGain(rows), { gain: 90000 + 30000 + 160000, rate: 280000 / 650000 });
  assert.equal(walletGain([]), null);

  // 総残高: 証券口座は評価額で数える（記録・補正は見ない）。
  const secWallet: MoneyWallet = { id: 'sec', name: '証券', type: 'securities', isSaving: false, savingTarget: null, closeDay: null, payDay: null, payWalletId: null, iconColor: null, position: 9, archived: false };
  const bankWallet: MoneyWallet = { ...secWallet, id: 'bank2', name: '口座', type: 'bank' };
  const transfer = record('tr', { kind: 'transfer', walletId: 'bank2', toWalletId: 'sec', occurredOn: '2026-10-07', items: [item({ amount: 50000 })] });
  const summary = buildWalletBalances([bankWallet, secWallet], [transfer], [{ id: 'b', walletId: 'bank2', balanceOn: '2026-10-06', amount: 100000, showInHistory: true }], '2026-10-08', data);
  assert.deepEqual(summary.rows.map((row) => row.amount), [50000, 945800], '証券口座への振替は口座から減るが、証券口座は評価額');
  assert.equal(summary.total, 995800);
  const trend = totalDailyBalances([bankWallet, secWallet], [transfer], [{ id: 'b', walletId: 'bank2', balanceOn: '2026-10-06', amount: 100000, showInHistory: true }], data, '2026-10-08');
  assert.deepEqual(trend, [
    { date: '2026-10-06', amount: 100000 + 570000 },
    { date: '2026-10-07', amount: 50000 + 450000 + 240000 + 15800 },
    { date: '2026-10-08', amount: 50000 + 945800 },
  ]);

  assert.equal(formatGainRate(0.38), '+38.00%');
  assert.equal(formatGainRate(-0.05), '−5.00%');
  assert.equal(formatQuantity(123456), '123,456');
  assert.equal(formatQuantity(10.5), '10.5');
}

console.log('moneyUtils: ok');
