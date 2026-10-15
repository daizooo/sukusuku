// 家計タブの数え方（docs/kakei.md §3〜§5）。
// 実行: npm run test:money
import assert from 'node:assert/strict';

import {
  addDays,
  balanceChanges,
  balanceChecks,
  baseIconKey,
  buildCategoryAnalysis,
  canCardNextPeriod,
  cardBilling,
  cardCarriedIn,
  cardPaymentHistory,
  cardUsagePeriod,
  dailyBalances,
  iconTone,
  yearMonthKeys,
  yearOfMonth,
  filterTrend,
  formatAxisYen,
  niceTicks,
  recordsOfWallet,
  budgetFor,
  budgetMonthKey,
  budgetMonths,
  buildWalletBalances,
  estimateRecurringAmount,
  fixedBudgetFor,
  fixedBudgetRows,
  inRecurringPeriod,
  isMonthClosed,
  unclosedMonths,
  buildYearLanding,
  monthForecastBalance,
  pendingRecurringInMonth,
  parsePeriodMonth,
  recurringEnded,
  recurringPeriodLabel,
  formatBalance,
  walletBalanceOn,
  walletDelta,
  buildYearSummary,
  buildBudgetTiles,
  buildMonthSummary,
  cardScheduleLabel,
  categoryPath,
  estimatesInMonth,
  evaluateCalc,
  formatDayOfMonth,
  recurringDateOf,
  recurringHistory,
  recurringScheduleLabel,
  formatSignedYen,
  groupsFromItems,
  groupsFromScan,
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
  reorderedPositions,
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
  compareWithPreviousYear,
  yearToDateBalance,
  incomeRecordsInYear,
  recurringDayLabel,
  receiptReplaceNotices,
} from './moneyUtils.ts';
import type { MoneyBudget, MoneyCategory, MoneyHolding, MoneyHoldingValue, MoneyItem, MoneyRecord, MoneyRecurring, MoneySecurity, MoneyStore, MoneyWallet, MoneyWalletBalance } from '../types/app.ts';

// ---- 月・年 ----
assert.equal(shiftMonth('2026-12', 1), '2027-01');
assert.equal(shiftMonth('2026-01', -1), '2025-12');
assert.equal(shiftMonth('2026-09', -12), '2025-09');
assert.equal(formatSignedYen(1200), '+¥1,200');
assert.equal(formatSignedYen(-3800), '−¥3,800');
assert.equal(formatSignedYen(0), '¥0');

// ---- カテゴリ ----
const cat = (id: string, name: string, parentId: string | null, extra: Partial<MoneyCategory> = {}): MoneyCategory => ({
  id,
  name,
  parentId,
  kind: 'living',
  icon: null,
  iconColor: null,
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
  cat('old', '昔のカテゴリ', null, { position: 3, archived: true }),
  cat('salary', '給料', null, { kind: 'income' }),
  cat('bonus', '賞与', 'salary', { kind: 'income' }),
  // 特別費も大分類のひとつ（docs/kakei.md §0.2）。予算は置かない
  cat('special', '特別費', null, { position: 4 }),
  cat('tax', '自動車税', 'special'),
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

// ---- 予算（その年に無ければ前の年） ----
const budgets: MoneyBudget[] = [
  { id: 'b1', categoryId: 'food', year: 2025, monthAmounts: Array(12).fill(55000) },
  { id: 'b2', categoryId: 'food', year: 2026, monthAmounts: Array(12).fill(60000) },
  { id: 'b3', categoryId: 'med', year: 2024, monthAmounts: Array(12).fill(5000) },
  { id: 'b4', categoryId: 'house', year: 2026, monthAmounts: Array(12).fill(85000) },
];
assert.equal(budgetFor(budgets, 'food', '2026-06'), 60000);
assert.equal(budgetFor(budgets, 'food', '2027-03'), 60000, '翌年は今の額のまま');
assert.equal(budgetFor(budgets, 'food', '2025-12'), 55000);
assert.equal(budgetFor(budgets, 'food', '2024-12'), null, '前の年にも無ければ未設定');
assert.equal(budgetFor(budgets, 'med', '2026-01'), 5000);

// 月ごとに予算を決められる。直した月以外は変わらない（過去の振り返りがおかしくならない）
{
  const current = budgetMonths(budgets, 'food', 2026);
  assert.deepEqual(current, Array(12).fill(60000));
  const changed = current.map((value, index) => (index === 9 ? 70000 : value));
  const after: MoneyBudget[] = [...budgets.filter((b) => b.id !== 'b2'), { id: 'b2', categoryId: 'food', year: 2026, monthAmounts: changed }];
  assert.equal(budgetFor(after, 'food', '2026-09'), 60000, '過去の月');
  assert.equal(budgetFor(after, 'food', '2026-10'), 70000);
  assert.equal(budgetFor(after, 'food', '2026-11'), 60000, '直していない月はそのまま');
  assert.equal(budgetFor(after, 'food', '2027-02'), 60000, '翌年は年末（12月）の額を引き継ぐ');
  assert.equal(budgetFor(after, 'food', '2025-12'), 55000, '前の年は変わらない');
  // その年にはじめて決める（それまで予算なし）。決めない月は予算なしのまま
  const first = budgetMonths(budgets, 'house', 2025).map((value, index) => (index === 3 ? 30000 : value));
  assert.deepEqual(first.slice(0, 3), [null, null, null]);
  assert.equal(first[3], 30000);
}

// 固定費は、そのカテゴリの月の予算に自動で足される（額は記録を作るDBと同じ決め方）
{
  const cats = [
    { id: 'house', kind: 'living', parentId: null },
    { id: 'rent', kind: 'living', parentId: 'house' },
    { id: 'food', kind: 'living', parentId: null },
    { id: 'util', kind: 'living', parentId: null },
    { id: 'elec', kind: 'living', parentId: 'util' },
    { id: 'salary', kind: 'income', parentId: null },
  ] as unknown as MoneyCategory[];
  const rule = (over: Partial<MoneyRecurring>): MoneyRecurring =>
    ({
      kind: 'expense', months: null, amount: 0, categoryId: null, archived: false, walletId: 'w1', toWalletId: null,
      store: '', day: 25, weekOfMonth: null, weekday: null, holiday: 'none', amountMode: 'fixed', createdAt: '2026-04-10', ...over,
    }) as MoneyRecurring;
  const rec = (id: string, occurredOn: string, amount: number, over: Partial<MoneyRecord> = {}): MoneyRecord =>
    ({
      id, kind: 'expense', occurredOn, walletId: 'w1', toWalletId: null, store: '電力', createdBy: null, isEstimate: false,
      recurringId: null, month: null, items: [{ id: `i-${id}`, amount, categoryId: 'elec', name: '' }], ...over,
    }) as unknown as MoneyRecord;
  const today = '2026-10-11';

  // 日取り（DBの money_rule_date・money_shift_business_day と同じ）
  assert.equal(recurringDateOf(2026, 10, rule({ day: 25, holiday: 'next' })), '2026-10-26', '日曜 → 翌営業日');
  assert.equal(recurringDateOf(2026, 10, rule({ day: 25, holiday: 'prev' })), '2026-10-23', '日曜 → 前営業日');
  assert.equal(recurringDateOf(2026, 10, rule({ day: 25, holiday: 'none' })), '2026-10-25', 'そのまま');
  assert.equal(recurringDateOf(2026, 11, rule({ day: 31 })), '2026-11-30', '31 は末日');
  assert.equal(recurringDateOf(2026, 10, rule({ weekOfMonth: 2, weekday: 5 })), '2026-10-09', '第2金曜日');
  assert.equal(recurringDateOf(2026, 10, rule({ weekOfMonth: 5, weekday: 5 })), '2026-10-30', '最終金曜日');
  assert.equal(recurringDateOf(2026, 12, rule({ day: 31, holiday: 'next' })), '2027-01-04', '12/31〜1/3 は休業日');
  assert.equal(recurringDateOf(2026, 12, rule({ day: 31, holiday: 'prev' })), '2026-12-30');

  // 固定額
  const rent = rule({ id: 'r1', categoryId: 'rent', amount: 80000 }); // 小分類 → 大分類 house へ。毎月
  const tax = rule({ id: 'r2', categoryId: 'house', amount: 30000, months: [5] }); // 5月だけ（自動車税など）
  // 見込み（前年同月 → 直近3回の平均 → ルールの額）
  const power = rule({ id: 'r3', categoryId: 'elec', store: '電力', amountMode: 'estimate', amount: 6000, createdAt: '2025-01-01' });
  const history = [
    rec('h1', '2025-08-25', 9000),
    rec('h2', '2026-07-24', 7000),
    rec('h3', '2026-08-25', 8000),
    rec('h4', '2026-09-25', 8500, { recurringId: 'r3', month: '2026-09' }), // 確定した記録（9月のぶんは数えない）
    rec('h5', '2026-08-25', 99999, { store: '別の店' }), // お店が違う
    rec('h6', '2026-08-26', 99999, { isEstimate: true }), // 見込みの記録は数えない
  ];
  assert.equal(estimateRecurringAmount(power, '2026-08', history), 9000, '前年同月の記録があればその額');
  assert.equal(estimateRecurringAmount(power, '2026-11', history), Math.round((8500 + 8000 + 7000) / 3), '無ければ直近3回の平均');
  assert.equal(estimateRecurringAmount(power, '2026-09', history), 7500, '確定した当月の記録は数えない（作った時点と同じ）');
  assert.equal(estimateRecurringAmount(power, '2026-11', []), 6000, '記録が1件も無ければルールの額');

  const rows = fixedBudgetRows(
    [
      rent, tax, power,
      rule({ id: 'r4', categoryId: 'house', amount: 9999, archived: true }), // 使わない
      rule({ id: 'r5', categoryId: 'salary', amount: 300000, kind: 'income' }), // 収入は対象外
      rule({ id: 'r6', categoryId: null, amount: 1000 }), // カテゴリなし
      rule({ id: 'r7', categoryId: 'food', amount: 0 }), // 額なし
      rule({ id: 'r8', categoryId: 'food', amount: 1000, walletId: null }), // 出金元なし（記録は作られない）
    ],
    cats,
    [
      ...history,
      // 10月のぶんは見込みのまま作られている → その記録の額
      rec('m10', '2026-10-25', 7777, { isEstimate: true, recurringId: 'r3', month: '2026-10' }),
    ],
    today,
  );
  const withFixed: MoneyBudget[] = [...budgets, ...rows];
  assert.deepEqual(new Set(rows.map((row) => row.categoryId)), new Set(['house', 'util']), '固定費がある大分類の行だけ');
  assert.ok(rows.every((row) => row.fixed === true));
  assert.equal(fixedBudgetFor(withFixed, 'house', '2026-01'), 80000, 'ルールを作った年なら、作った月より前の月にも足す');
assert.equal(fixedBudgetFor(withFixed, 'house', '2026-03'), 80000);
assert.equal(fixedBudgetFor(withFixed, 'house', '2025-12'), 0, 'ルールを作る前の年は足さない');
  assert.equal(fixedBudgetFor(withFixed, 'house', '2026-04'), 80000);
  assert.equal(fixedBudgetFor(withFixed, 'house', '2026-05'), 110000, '決まった月だけ足される');
  assert.equal(fixedBudgetFor(withFixed, 'house', '2027-05'), 110000, '来年も');
  assert.equal(fixedBudgetFor(withFixed, 'house', '2029-05'), 110000, 'その先は直近の年の同じ月');
  assert.equal(fixedBudgetFor(withFixed, 'food', '2026-05'), 0);
  assert.equal(fixedBudgetFor(withFixed, 'util', '2026-08'), 9000, '見込みのルール（前年同月）');
  assert.equal(fixedBudgetFor(withFixed, 'util', '2026-10'), 7777, '見込みのままの記録があれば、その記録の額');
  assert.equal(fixedBudgetFor(withFixed, 'util', '2026-11'), Math.round((8500 + 8000 + 7000) / 3), '記録がまだ無い月は同じ計算で見込む（見込みのままの記録は数えない）');
  assert.equal(budgetFor(withFixed, 'house', '2026-04'), 85000 + 80000, '手入力の予算＋固定費');
  assert.equal(budgetFor(withFixed, 'house', '2026-05'), 85000 + 110000);
  assert.equal(budgetFor(withFixed, 'util', '2026-08'), 9000, '手入力が無い月は固定費だけ');
  assert.equal(budgetFor(withFixed, 'food', '2026-06'), 60000, '固定費の無いカテゴリは今まで通り');
  assert.deepEqual(budgetMonths(withFixed, 'house', 2026), Array(12).fill(85000), '編集の初期値に固定費は入らない');

  // 締める月に、これから自動で作られる記録（docs/kakei.md §4.5）
  const salary = rule({ id: 'p1', kind: 'income', categoryId: 'salary', amount: 200000, day: 25, holiday: 'prev' });
  const madeRent = rule({ id: 'p2', categoryId: 'rent', amount: 80000, day: 27 });
  const pendingList = pendingRecurringInMonth(
    [salary, madeRent, rule({ id: 'p3', categoryId: 'rent', amount: 1, day: 5 }), rule({ id: 'p4', kind: 'transfer', categoryId: null, toWalletId: 'w2', day: 28 })],
    [rec('pm', '2026-10-27', 80000, { recurringId: 'p2', month: '2026-10' })],
    '2026-10',
    '2026-10-20',
  );
  assert.deepEqual(
    pendingList.map((entry) => [entry.rule.id, entry.date, entry.amount]),
    [['p1', '2026-10-23', 200000]],
    'まだ来ていない日のものだけ（作ったもの・過ぎた日・振替は除く。25日が日曜なので前営業日の23日）',
  );
  assert.deepEqual(pendingRecurringInMonth([salary], [], '2026-09', '2026-10-20'), [], '過ぎた月は無い');

  // 期間（開始月・終了月。docs/kakei.md §3.3）
  const leave = rule({ id: 'r9', categoryId: 'rent', amount: 1000, startMonth: '2026-06', endMonth: '2026-08' });
  const periodRows = fixedBudgetRows([leave], cats, [], today);
  assert.equal(fixedBudgetFor(periodRows, 'house', '2026-05'), 0, '期間の前の月は足さない');
  assert.equal(fixedBudgetFor(periodRows, 'house', '2026-06'), 1000, '期間の始まりの月から');
  assert.equal(fixedBudgetFor(periodRows, 'house', '2026-08'), 1000, '期間の終わりの月まで');
  assert.equal(fixedBudgetFor(periodRows, 'house', '2026-09'), 0, '期間のあとの月は足さない');
  assert.equal(inRecurringPeriod({ startMonth: null, endMonth: null }, '2030-01'), true, '無期限');
  assert.equal(recurringEnded(rule({ endMonth: '2026-09' }), '2026-10'), true);
  assert.equal(recurringEnded(rule({ endMonth: '2026-10' }), '2026-10'), false, '終わりの月はまだ期間の中');
  assert.equal(recurringPeriodLabel(rule({ startMonth: '2027-09', endMonth: null })), '2027/9〜');
  assert.equal(recurringPeriodLabel(rule({ startMonth: null, endMonth: '2027-08' })), '〜2027/8');
  assert.equal(recurringPeriodLabel(rule({ startMonth: null, endMonth: null })), '');
  // 見込みは期間の始まりより前の記録を使わない（このルールが作った記録は使う）
  const later = rule({ ...power, id: 'r10', startMonth: '2026-09' });
  assert.equal(estimateRecurringAmount(later, '2026-11', history), 8500, '始まりより前の記録（8月まで）は使わない');
  assert.equal(estimateRecurringAmount(rule({ ...power, id: 'r3', startMonth: '2026-12' }), '2027-01', history), 8500, 'このルールが作った記録は使う');
  assert.equal(estimateRecurringAmount(rule({ ...power, id: 'r11', startMonth: '2026-12' }), '2027-01', history), 6000, '使える記録が無ければルールの額');
}
{
  // 月の締め（docs/kakei.md §4.5）
  const r = (occurredOn: string, kind: MoneyRecord['kind'] = 'expense') => ({ occurredOn, kind }) as unknown as MoneyRecord;
  const closings = [
    { month: '2026-09', closedAt: '2026-10-02T00:00:00Z' },
    { month: '2026-08', closedAt: null }, // 締めを外した
  ];
  assert.equal(isMonthClosed(closings, '2026-09'), true);
  assert.equal(isMonthClosed(closings, '2026-08'), false, '締めを外した月');
  assert.deepEqual(
    unclosedMonths(
      [r('2026-07-03'), r('2026-08-10'), r('2026-09-01'), r('2026-06-05', 'transfer'), r('2026-10-01')],
      closings,
      '2026-10-15',
    ),
    ['2026-07', '2026-08'],
    '記録のある過ぎた月のうち締めていないもの（振替だけの月・今月は数えない）',
  );
}
{
  // 年末の着地見込み（docs/kakei.md §4.6）
  const cats = [
    { id: 'food', kind: 'living', parentId: null, archived: false, position: 0, name: '食費' },
    { id: 'house', kind: 'living', parentId: null, archived: false, position: 1, name: '住居費' },
    { id: 'salary', kind: 'income', parentId: null, archived: false, position: 0, name: '給料' },
  ] as unknown as MoneyCategory[];
  const buds: MoneyBudget[] = [{ id: 'b1', categoryId: 'food', year: 2026, monthAmounts: Array.from({ length: 12 }, () => 50000) }];
  const rule = (over: Partial<MoneyRecurring>): MoneyRecurring =>
    ({
      kind: 'expense', months: null, amount: 0, categoryId: null, archived: false, walletId: 'w1', toWalletId: null,
      store: '', day: 25, weekOfMonth: null, weekday: null, holiday: 'none', amountMode: 'fixed', createdAt: '2026-09-01',
      startMonth: null, endMonth: null, ...over,
    }) as MoneyRecurring;
  const rules = [
    rule({ id: 'sal', kind: 'income', categoryId: 'salary', amount: 300000 }),
    rule({ id: 'rent', categoryId: 'house', amount: 80000 }),
    rule({ id: 'save', kind: 'transfer', categoryId: 'house', toWalletId: 'w2', amount: 50000 }), // 振替は数えない
    rule({ id: 'old', categoryId: 'house', amount: 9999, archived: true }), // 使っていないルール
    rule({ id: 'end', categoryId: 'house', amount: 10000, endMonth: '2026-11' }), // 11月まで
  ];
  const r = (id: string, occurredOn: string, kind: MoneyRecord['kind'], amount: number, categoryId: string) =>
    ({ id, occurredOn, kind, isEstimate: false, recurringId: null, month: null, items: [{ id: `i-${id}`, amount, categoryId }] }) as unknown as MoneyRecord;
  const rs = [r('a', '2026-10-25', 'income', 300000, 'salary'), r('b', '2026-10-03', 'expense', 100000, 'food')];
  const closings = [{ month: '2026-10', closedAt: '2026-11-01T00:00:00Z' }];

  assert.equal(monthForecastBalance(rules, cats, buds, rs, '2026-11'), 300000 - 80000 - 10000 - 50000, '固定収入 − 固定費 − 変動費の予算');
  assert.equal(monthForecastBalance(rules, cats, buds, rs, '2026-12'), 170000, '期間の外のルールは数えない');
  assert.equal(monthForecastBalance(rules, cats, buds, rs, '2027-03'), 170000, '先の年の予算は前の年の12月の額');

  const landing = buildYearLanding(rs, cats, buds, rules, closings, 2026);
  assert.ok(landing);
  assert.deepEqual(
    landing.months.filter((m) => m.counted).map((m) => [m.monthKey, m.closed, m.balance, m.cumulative]),
    [['2026-10', true, 200000, 200000], ['2026-11', false, 160000, 360000], ['2026-12', false, 170000, 530000]],
    '使い始めた月から。締めた月は実額、ほかは見込み',
  );
  assert.equal(landing.total, 530000);
  assert.equal(landing.closedMonths, 1);

  const open = buildYearLanding(rs, cats, buds, rules, [], 2026);
  assert.equal(open?.months[9].balance, 160000, '締めていない月は実績（200000）を使わず見込み');

  const next = buildYearLanding(rs, cats, buds, rules, closings, 2027);
  assert.equal(next?.months.every((m) => m.counted && !m.closed), true, '先の年は全部の月を見込み');
  assert.equal(next?.total, 170000 * 12);
  assert.equal(buildYearLanding([], cats, buds, rules, closings, 2026), null, '記録が無ければ出さない');
  assert.equal(buildYearLanding(rs, cats, buds, rules, closings, 2025), null, '使い始める前の年は出さない');
}
assert.equal(parsePeriodMonth(''), null, '空は無期限');
assert.equal(parsePeriodMonth('2027/9'), '2027-09');
assert.equal(parsePeriodMonth('２０２７年９月'), '2027-09', '全角・年月');
assert.equal(parsePeriodMonth('2027-13'), undefined, '読めない');
assert.equal(parsePeriodMonth('9月'), undefined, '年が無い');
assert.equal(budgetMonthKey(2026, '2026-10-09'), '2026-10', '今年は今月');
assert.equal(budgetMonthKey(2027, '2026-10-09'), '2027-01', 'これからの年は1月');
assert.equal(budgetMonthKey(2025, '2026-10-09'), '2025-12', '過ぎた年は12月');

// ---- 記録 ----
let seq = 0;
const item = (fields: Partial<MoneyItem>): MoneyItem => ({
  id: `i${(seq += 1)}`,
  amount: 0,
  categoryId: null,
  categoryName: '',
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
  cardNextPeriod: false,
  items: [],
  ...fields,
});
const wallets: MoneyWallet[] = [
  { id: 'card', name: 'カード', type: 'card', closeDay: null, payDay: null, payWalletId: null, payMonthOffset: null, iconColor: null, position: 0, archived: false },
  { id: 'bank', name: '生活費口座', type: 'bank', closeDay: null, payDay: null, payWalletId: null, payMonthOffset: null, iconColor: null, position: 1, archived: false },
  { id: 'save', name: '貯金口座', type: 'bank', closeDay: null, payDay: null, payWalletId: null, payMonthOffset: null, iconColor: null, position: 2, archived: false },
  { id: 'gone', name: '昔のカード', type: 'card', closeDay: null, payDay: null, payWalletId: null, payMonthOffset: null, iconColor: null, position: 3, archived: true },
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
    items: [item({ amount: 58000, categoryId: 'tax', memo: '年払い' })],
  }),
  record('r7', { occurredOn: '2026-09-20', kind: 'income', items: [item({ amount: 400000, categoryId: 'bonus' })] }),
  record('r8', { occurredOn: '2026-08-31', walletId: 'card', store: 'スーパー', items: [item({ amount: 1000, categoryId: 'grocery' })] }),
  record('r9', { occurredOn: '2026-09-02', walletId: 'card', store: '', items: [item({ amount: 85000, categoryId: 'house' })] }),
];

const summary = buildMonthSummary(records, categories, budgets, '2026-09');
assert.equal(summary.income, 300000 + 400000, '賞与も月の収入に入れる');
assert.equal(summary.living, 396 + 168 + 500 + 70000 + 85000 + 58000, '特別費も生活費と同じ支出に入れる');
assert.equal('saving' in summary, false, '貯金は記録なので、集計にも表示にも入れない（貯金の口座への振替も数えない）');
assert.equal('special' in summary, false, '特別費は別枠にしない（大分類「特別費」のカテゴリ）');
assert.equal(summary.livingBudget, 60000 + 5000 + 85000, '使わなくした大分類・収入・予算のない特別費は予算に入れない');
assert.equal(summary.balance, summary.income - summary.living, '収支＝収入 − 支出（特別費を含む。振替は入れない）');
assert.equal(summary.plannedBalance, summary.income - summary.livingBudget);

// 削除したカテゴリの品目（名前だけ残っている）は、月の合計には数えるが、大分類のタイルには出さない
{
  const withDeleted = [
    ...records,
    record('rd', {
      occurredOn: '2026-09-27',
      walletId: 'card',
      items: [item({ amount: 1234, categoryName: '旧カテゴリ' })],
    }),
  ];
  assert.equal(buildMonthSummary(withDeleted, categories, budgets, '2026-09').living, summary.living + 1234);
  assert.deepEqual(
    buildBudgetTiles(withDeleted, categories, budgets, '2026-09').map((tile) => tile.actual),
    buildBudgetTiles(records, categories, budgets, '2026-09').map((tile) => tile.actual),
  );
  const [deletedGroup] = groupItems(withDeleted[withDeleted.length - 1].items);
  assert.equal(deletedGroup.key, 'deleted:旧カテゴリ');
  assert.equal(deletedGroup.categoryName, '旧カテゴリ');
}

const tiles = buildBudgetTiles(records, categories, budgets, '2026-09');
assert.deepEqual(
  tiles.map((tile) => [tile.category.id, tile.diff, tile.percent]),
  [
    ['house', 0, 100],
    ['food', 60000 - 70564, 118],
    ['med', 4500, 10],
    ['special', -58000, null],
  ],
  'カテゴリの並び順のまま。特別費も大分類のひとつ（予算なし）。使っていない使わなくした大分類は出さない',
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
  '同じカテゴリの品目は1つにまとめる',
);
assert.equal(itemNamesLabel(groups[0].items), '牛乳 ×2・食パン');
// 記録の一覧の2行目（品名の要約。docs/kakei.md §3.2）
assert.equal(itemSummary([{ name: '牛乳' }, { name: ' 卵 ' }]), '牛乳、卵');
assert.equal(itemSummary([{ name: '牛乳' }, { name: '卵' }, { name: 'パン' }]), '牛乳、卵ほか');
assert.equal(itemSummary([{ name: '牛乳' }, { name: '牛乳' }, { name: '' }]), '牛乳', '同じ品名・空の品名は数えない');
assert.equal(itemSummary([{ name: '' }]), '');

assert.deepEqual(frequentCategoryIds(records, categories, 'living', 2), ['grocery', 'eatout'], '多い順、同じ回数なら最近使った順');
assert.deepEqual(recentStores(records), ['レストラン', 'スーパー']);

// お店の選択肢: 最近使ったお店を先に、続けて登録したお店の残りを使った回数の多い順に。使わなくしたお店は出さない。
const storeList: MoneyStore[] = [
  { id: 's1', name: 'ドラッグ', position: 0, archived: false },
  { id: 's2', name: 'スーパー', position: 1, archived: false },
  { id: 's3', name: '閉店した店', position: 2, archived: true },
];
assert.deepEqual(storeChoices(storeList, records), { recent: ['レストラン', 'スーパー'], registered: ['ドラッグ'], others: [] }, '最近使ったお店と重なる登録は、登録のほうに出さない');
assert.deepEqual(storeChoices(storeList, records, 1), { recent: ['レストラン'], registered: ['スーパー', 'ドラッグ'], others: [] }, '最近の件数を絞ると、残りは登録のほうへ（使った回数の多い順）');
assert.deepEqual(
  storeChoices([{ id: 's4', name: 'レストラン', position: 0, archived: true }], records),
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

// ---- 年の収支 ----
const year = buildYearSummary(records, categories, budgets, 2026, '2026-09');
assert.equal(year.months.length, 12);
assert.equal(year.months[0].monthKey, '2026-01');
assert.equal(year.months[11].monthKey, '2026-12');
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
assert.equal(year.total.balance, year.total.income - year.total.living, '年の収支も 収入 − 支出');
// カテゴリだけの月も、普通の記録のある月として数える
const specialOnly = buildYearSummary(
  [record('s1', { occurredOn: '2026-07-10', items: [item({ amount: 30000, categoryId: 'tax' })] })],
  categories,
  budgets,
  2026,
  '2026-09',
);
assert.equal(specialOnly.total.living, 30000);
assert.equal(specialOnly.recordedMonths, 1);
assert.equal(specialOnly.months.find((row) => row.monthKey === '2026-07')!.balance, -30000);

assert.equal(year.months.find((row) => row.monthKey === '2026-10')!.recorded, false, 'まだ来ていない月は数えない');

// 月が進むごとに年初からの累計が伸びる（育休中のように、給付金が2か月ごとに入る年）
const leave = [
  record('l1', { occurredOn: '2027-01-10', items: [item({ amount: 200000, categoryId: 'house' })] }),
  record('l2', { occurredOn: '2027-01-25', kind: 'income', items: [item({ amount: 300000, categoryId: 'bonus' })] }),
  record('l3', { occurredOn: '2027-02-10', items: [item({ amount: 250000, categoryId: 'house' })] }),
  record('l4', { occurredOn: '2027-03-10', items: [item({ amount: 220000, categoryId: 'house' })] }),
  record('l5', { occurredOn: '2027-03-25', kind: 'income', items: [item({ amount: 500000, categoryId: 'bonus' })] }),
];
const cumulativeAt = (upTo: string) =>
  buildYearSummary(leave, categories, budgets, 2027, upTo).months.map((row) => (row.recorded ? row.cumulative : null));
assert.deepEqual(cumulativeAt('2027-01').slice(0, 3), [100000, null, null], '1月だけ: 1月の収支');
assert.deepEqual(cumulativeAt('2027-02').slice(0, 3), [100000, -150000, null], '2月: 1月 + 2月（給付金なしの赤字月）');
assert.deepEqual(cumulativeAt('2027-03').slice(0, 3), [100000, -150000, 130000], '3月: 給付金が入った月で累計が戻る');
assert.equal(yearToDateBalance(leave, categories, budgets, '2027-02'), -150000, '月の画面の累計も同じ');
assert.equal(yearToDateBalance(leave, categories, budgets, '2027-04'), null, '記録の無い月は累計を出さない');
const marchYear = buildYearSummary(leave, categories, budgets, 2027, '2027-03');
assert.equal(marchYear.total.balance, 130000, '年の収支は累計の終点と同じ');
assert.equal(marchYear.average!.balance, 43333, '月平均は記録のある月で割る');
assert.equal(
  buildYearSummary(records, categories, budgets, 2026, '2026-08').total.living,
  1000,
  'upTo より後の月は合計に入れない',
);

// ---- 年初からの累計・月平均・前年比（docs/kakei.md §0.4） ----
{
  const earn = (id: string, occurredOn: string, income: number, spent: number) => [
    record(`${id}-in`, { occurredOn, kind: 'income', walletId: 'bank', items: [item({ amount: income, categoryId: 'salary' })] }),
    record(`${id}-out`, { occurredOn, walletId: 'bank', items: [item({ amount: spent, categoryId: 'grocery' })] }),
  ];
  const flow: MoneyRecord[] = [
    ...earn('n25', '2025-11-25', 300000, 250000), // +50,000
    ...earn('d25', '2025-12-25', 700000, 300000), // +400,000（賞与の月）
    ...earn('o26', '2026-10-25', 300000, 20000), // +280,000
    ...earn('n26', '2026-11-25', 300000, 350000), // −50,000（支出が多い月）
    ...earn('d26', '2026-12-25', 700000, 300000), // +400,000
    record('t26', { occurredOn: '2026-12-26', kind: 'transfer', walletId: 'bank', toWalletId: 'save', items: [item({ amount: 100000 })] }),
    record('t27', { occurredOn: '2027-01-05', kind: 'transfer', walletId: 'bank', toWalletId: 'save', items: [item({ amount: 100000 })] }),
  ];

  const y2026 = buildYearSummary(flow, categories, budgets, 2026, '2026-12');
  assert.equal(y2026.recordedMonths, 3, '記録のある月だけを数える（2026年は10月から）');
  assert.equal(y2026.total.balance, 280000 - 50000 + 400000);
  assert.deepEqual(
    y2026.months.filter((row) => row.monthKey >= '2026-09').map((row) => [row.monthKey, row.cumulative]),
    [['2026-09', 0], ['2026-10', 280000], ['2026-11', 230000], ['2026-12', 630000]],
    '年初からの累計は、数える月だけを足す',
  );
  assert.deepEqual(y2026.average, { income: 433333, living: 223333, balance: 210000 }, '月平均は数える月で割る（円に丸める）');

  // 振替だけの月は数えない
  const jan27 = buildYearSummary(flow, categories, budgets, 2027, '2027-01');
  assert.equal(jan27.recordedMonths, 0);
  assert.equal(jan27.average, null, '数える月が無ければ平均は無い');

  assert.equal(yearToDateBalance(flow, categories, budgets, '2026-10'), 280000);
  assert.equal(yearToDateBalance(flow, categories, budgets, '2026-11'), 230000);
  assert.equal(yearToDateBalance(flow, categories, budgets, '2026-12'), 630000);
  assert.equal(yearToDateBalance(flow, categories, budgets, '2026-09'), null, '記録の無い月に累計は出さない');
  assert.equal(yearToDateBalance(flow, categories, budgets, '2027-01'), null, '振替だけの月');

  // 前の年の同じ月ぶんとの比べ
  assert.deepEqual(compareWithPreviousYear(flow, categories, budgets, 2026, '2026-12'), {
    months: 2,
    balance: -50000 + 400000,
    previousBalance: 50000 + 400000,
    diff: -100000,
  }, '今年の10月は前年の10月が無いので比べない。11・12月だけを比べる');
  assert.equal(compareWithPreviousYear(flow, categories, budgets, 2025, '2025-12'), null, '前の年に記録が無ければ比べない');
}

// ---- 固定収入の履歴（その年の収入の記録。docs/kakei.md §0.3） ----
{
  const income = (id: string, occurredOn: string, amount: number, isEstimate: boolean, kind: MoneyRecord['kind'] = 'income') =>
    record(id, { occurredOn, kind, isEstimate, walletId: 'bank', items: [item({ amount, categoryId: 'bonus' })] });
  const list = incomeRecordsInYear(
    [
      income('b1', '2026-06-10', 400000, false),
      income('s1', '2026-10-25', 300000, true),
      income('x1', '2026-10-26', 5000, false, 'expense'),
      income('t1', '2026-10-27', 5000, false, 'transfer'),
      income('p1', '2025-12-10', 250000, false),
    ],
    2026,
  );
  assert.deepEqual(list.map((entry) => entry.id), ['s1', 'b1'], 'その年の収入だけ。新しい日から（支出・振替・ほかの年は入れない）');
  assert.equal(list[0].isEstimate, true, '見込みか確定かが分かる');
}

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
editorGroups[0].lines.push({ key: 'blank', name: '', quantity: 1, unitPrice: 0, memo: '' });
const saved = itemsFromGroups(editorGroups);
assert.equal(saved.length, 4, '空の行は保存しない');
assert.deepEqual(saved[0], {
  amount: 396,
  categoryId: 'grocery',
  categoryName: '',
  quantity: 2,
  unitPrice: 198,
  name: '牛乳',
  memo: '',
  receiptName: null,
});
// マイナスの品目（値引き。docs/kakei.md §10.5）は、マイナスのまま行き来する
const discountGroups = groupsFromItems(
  [item({ amount: 638, categoryId: 'grocery', quantity: 2, unitPrice: 319 }), item({ amount: -50, categoryId: 'grocery', name: '値引' })],
  () => `d${(key += 1)}`,
);
assert.deepEqual(discountGroups[0].lines.map((line) => [line.quantity, line.unitPrice]), [
  [2, 319],
  [1, -50],
]);
assert.deepEqual(
  itemsFromGroups(discountGroups).map((entry) => [entry.amount, entry.unitPrice]),
  [
    [638, 319],
    [-50, -50],
  ],
);

// レシートの読み取り（docs/kakei.md §10.4）: カテゴリごとにまとめ、カテゴリの無い品目は1つにまとめる。表記は保存まで持ち回る
const scanGroups = groupsFromScan(
  [
    { receiptName: 'ﾀﾏｺﾞ', name: 'たまご', quantity: 2, unitPrice: 319, amount: 638, categoryId: 'grocery', categorySource: 'ai' },
    { receiptName: 'ﾚｼﾞ袋', name: 'レジ袋', quantity: 1, unitPrice: 6, amount: 6, categoryId: null, categorySource: 'none' },
    { receiptName: '値引', name: '値引', quantity: 1, unitPrice: -50, amount: -50, categoryId: 'grocery', categorySource: 'ai' },
  ],
  () => `s${(key += 1)}`,
);
assert.deepEqual(
  scanGroups.map((group) => [group.categoryId, group.lines.map((line) => line.name)]),
  [
    ['grocery', ['たまご', '値引']],
    [null, ['レジ袋']],
  ],
);
assert.deepEqual(
  itemsFromGroups(scanGroups).map((entry) => [entry.receiptName, entry.amount]),
  [
    ['ﾀﾏｺﾞ', 638],
    ['値引', -50],
    ['ﾚｼﾞ袋', 6],
  ],
);

// ---- 毎月の記録（docs/kakei.md §3.3・§3.4） ----
assert.equal(formatDayOfMonth(27), '27日');
assert.equal(formatDayOfMonth(31), '末日');
assert.equal(recurringScheduleLabel({ day: 27, months: null, holiday: 'next' }), '毎月27日（休日は翌営業日）');
assert.equal(recurringScheduleLabel({ day: 10, months: [12, 6], holiday: 'prev' }), '6・12月の10日（休日は前営業日）');
assert.equal(recurringScheduleLabel({ day: 31, months: null, holiday: 'none' }), '毎月末日（休日もそのまま）');
// 「第◯◯曜日」の日取り（賞与など。docs/kakei.md §0.3）
assert.equal(recurringDayLabel({ day: 1, weekOfMonth: 2, weekday: 5 }), '第2金曜日');
assert.equal(recurringDayLabel({ day: 1, weekOfMonth: 5, weekday: 5 }), '最終金曜日');
assert.equal(recurringDayLabel({ day: 27, weekOfMonth: null, weekday: null }), '27日');
assert.equal(recurringScheduleLabel({ day: 1, weekOfMonth: 2, weekday: 5, months: [12, 6], holiday: 'prev' }), '6・12月の第2金曜日（休日は前営業日）');
assert.equal(recurringScheduleLabel({ day: 1, weekOfMonth: 1, weekday: 1, months: null, holiday: 'next' }), '毎月第1月曜日（休日は翌営業日）');
assert.equal(cardScheduleLabel({ closeDay: 15, payDay: 10, payMonthOffset: null }), '15日締め・翌10日払い');
assert.equal(cardScheduleLabel({ closeDay: 31, payDay: 27, payMonthOffset: null }), '末日締め・翌27日払い');
assert.equal(cardScheduleLabel({ closeDay: 5, payDay: 27, payMonthOffset: null }), '5日締め・27日払い', '締め日より後の引き落とし日は同じ月');
assert.equal(cardScheduleLabel({ closeDay: 15, payDay: null, payMonthOffset: null }), '');
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
  const rule = { kind: 'expense' as const, walletId: 'bank', toWalletId: null, store: '電力', categoryId: 'elec' };
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
  ], '出金元・お店・カテゴリが同じで、見込みでない過去1年の記録だけ（同じカテゴリの品目は合計）');
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
  const card = { id: 'card', closeDay: 31, payDay: 25, payMonthOffset: null };
  const rs = [spend('c1', '2026-09-10', 6000), spend('c2', '2026-09-30', 4000), spend('c3', '2026-10-02', 3000)];
  const billing = cardBilling(card, -13000, rs, '2026-10-10');
  assert.deepEqual(billing, { billed: 10000, unbilled: 3000, closedOn: '2026-09-30', payOn: '2026-10-25' }, '残高には先月の請求と今月の利用が両方入る');
  // 引き落としの振替（口座 → カード）が入ると、請求済みだけが減る。
  const paid = cardBilling(card, -3000, [...rs, record('p', { kind: 'transfer', walletId: 'bank', toWalletId: 'card', occurredOn: '2026-10-25', items: [item({ amount: 10000 })] })], '2026-10-26');
  assert.deepEqual(paid, { billed: 0, unbilled: 3000, closedOn: '2026-09-30', payOn: '2026-10-25' }, '引き落としのあとは未請求だけ');
  // 15日締め・翌10日払い。
  assert.deepEqual(cardBilling({ id: 'card', closeDay: 15, payDay: 10, payMonthOffset: null }, -500, [spend('d1', '2026-10-16', 500)], '2026-10-20'), { billed: 0, unbilled: 500, closedOn: '2026-10-15', payOn: '2026-11-10' });
  // 15日締め・25日払いは同じ月に落ちる。年をまたぐ締め日。
  assert.equal(cardBilling({ id: 'card', closeDay: 15, payDay: 25, payMonthOffset: null }, 0, [], '2026-10-20')?.payOn, '2026-10-25');
  assert.deepEqual(cardBilling({ id: 'card', closeDay: 31, payDay: 27, payMonthOffset: null }, -100, [], '2027-01-05'), { billed: 100, unbilled: 0, closedOn: '2026-12-31', payOn: '2027-01-27' });
  assert.equal(cardBilling({ id: 'card', closeDay: null, payDay: null, payMonthOffset: null }, -100, rs, '2026-10-10'), null, '締め日が無ければ内訳は出さない');
  assert.equal(cardBilling({ id: 'card', closeDay: 31, payDay: null, payMonthOffset: null }, -100, [], '2026-10-10')?.payOn, null);
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
  const data = { securities, holdings, values, historyLoaded: true };

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
  const secWallet: MoneyWallet = { id: 'sec', name: '証券', type: 'securities', closeDay: null, payDay: null, payWalletId: null, payMonthOffset: null, iconColor: null, position: 9, archived: false };
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
// ---- カードの引き落としを翌月分に回す（card_next_period。docs/kakei.md §3.4） ----
{
  const cardWallet = { type: 'card' as const };
  assert.equal(canCardNextPeriod('expense', cardWallet, '2026-09-25'), true, 'カードで25日以降');
  assert.equal(canCardNextPeriod('income', cardWallet, '2026-09-30'), true, '返品も');
  assert.equal(canCardNextPeriod('expense', cardWallet, '2026-09-24'), false, '24日までは出さない');
  assert.equal(canCardNextPeriod('transfer', cardWallet, '2026-09-28'), false, '振替は出さない');
  assert.equal(canCardNextPeriod('expense', { type: 'bank' }, '2026-09-28'), false, 'カードでない出金元は出さない');
  assert.equal(canCardNextPeriod('expense', undefined, '2026-09-28'), false);

  // 末日締め・27日払い。9/28 の 4千 を翌月分に回すと、10月27日でなく11月27日の引き落としに入る。
  const card = { id: 'card', closeDay: 31, payDay: 27, payMonthOffset: null };
  const spend = (id: string, occurredOn: string, amount: number, cardNextPeriod = false) =>
    record(id, { walletId: 'card', occurredOn, cardNextPeriod, items: [item({ amount })] });
  const rs = [spend('n1', '2026-09-10', 6000), spend('n2', '2026-09-28', 4000, true), spend('n3', '2026-10-02', 3000)];
  assert.deepEqual(
    cardBilling(card, -13000, rs, '2026-10-10'),
    { billed: 6000, unbilled: 7000, closedOn: '2026-09-30', payOn: '2026-10-27' },
    '回した記録は締め日の前でも未請求',
  );
  assert.deepEqual(cardCarriedIn(card, '2026-11', rs), { monthKey: '2026-09', amount: 4000 }, '11月の引き落としに9月分が回ってくる');
  assert.equal(cardCarriedIn(card, '2026-10', rs), null, '回ってきた記録が無ければ null');
  assert.equal(cardCarriedIn({ id: 'card', closeDay: null, payDay: 27, payMonthOffset: null }, '2026-11', rs), null);
  // 返品（収入）も回せる。回した額は 支出 − 返品
  const refund = record('n4', { kind: 'income', walletId: 'card', occurredOn: '2026-09-29', cardNextPeriod: true, items: [item({ amount: 1000 })] });
  assert.deepEqual(cardCarriedIn(card, '2026-11', [...rs, refund]), { monthKey: '2026-09', amount: 3000 });
}

// ---- 翌々月払いのカード（月末締めの翌々月2日払いなど。2026-10-09） ----
{
  const eneos = { id: 'card', closeDay: 31, payDay: 2, payMonthOffset: 2 };
  assert.equal(cardScheduleLabel(eneos), '末日締め・翌々月2日払い');
  assert.equal(cardScheduleLabel({ closeDay: 15, payDay: 10, payMonthOffset: 1 }), '15日締め・翌10日払い');
  // 10月10日: 8月の利用は10月2日に落ちて済み。9月の利用が12月2日、10月の利用は未請求
  const spend = (id: string, occurredOn: string, amount: number) =>
    record(id, { walletId: 'card', occurredOn, items: [item({ amount })] });
  const rs = [spend('e1', '2026-09-10', 6000), spend('e2', '2026-09-30', 4000), spend('e3', '2026-10-02', 3000)];
  assert.deepEqual(cardBilling(eneos, -13000, rs, '2026-10-10'), {
    billed: 10000,
    unbilled: 3000,
    closedOn: '2026-09-30',
    payOn: '2026-11-02',
  }, '9月末締めは翌々月＝11月2日');
  assert.equal(cardBilling(eneos, 0, [], '2026-11-05')?.payOn, '2026-12-02', '10月末締めは12月2日');
  assert.equal(cardBilling(eneos, 0, [], '2026-12-05')?.payOn, '2027-01-02', '11月末締めは年をまたいで1月2日');
  assert.equal(cardBilling({ id: 'card', closeDay: 31, payDay: 2, payMonthOffset: null }, 0, [], '2026-11-05')?.payOn, '2026-11-02', '従来は翌月');

  // 引き落とし月に対する利用期間
  assert.deepEqual(cardUsagePeriod(eneos, '2026-11'), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(cardUsagePeriod(eneos, '2027-01'), { from: '2026-11-01', to: '2026-11-30' });
  assert.deepEqual(cardUsagePeriod(eneos, '2026-04'), { from: '2026-02-01', to: '2026-02-28' }, '2月は末日（28日）');
  assert.deepEqual(cardUsagePeriod({ closeDay: 15, payDay: 10, payMonthOffset: null }, '2026-11'), { from: '2026-09-16', to: '2026-10-15' });
  assert.deepEqual(cardUsagePeriod({ closeDay: 5, payDay: 27, payMonthOffset: null }, '2026-10'), { from: '2026-09-06', to: '2026-10-05' }, '締め日より後の引き落とし日は同じ月');
  assert.equal(cardUsagePeriod({ closeDay: null, payDay: 2, payMonthOffset: 2 }, '2026-11'), null);

  // これまでの引き落とし額（口座 → カードの振替を、引き落とし月ごとに新しい月から）
  const pay = (id: string, occurredOn: string, amount: number, isEstimate = false) =>
    record(id, { kind: 'transfer', walletId: 'bank', toWalletId: 'card', occurredOn, isEstimate, items: [item({ amount })] });
  const history = cardPaymentHistory(
    'card',
    [pay('p1', '2026-09-02', 8000), pay('p2', '2026-10-02', 12000), pay('p3', '2026-10-20', 500, true), pay('p4', '2026-12-02', 9999), spend('x', '2026-10-05', 700)],
    '2026-11-10',
  );
  assert.deepEqual(history, [
    { monthKey: '2026-10', amount: 12500, estimate: true, lastOn: '2026-10-20' },
    { monthKey: '2026-09', amount: 8000, estimate: false, lastOn: '2026-09-02' },
  ], '今日より先と、支出（振替でない記録）は入れない');
}

// ---- アイコンの色 ----
{
  assert.equal(iconKeyOf({ icon: 'food', name: '食費', iconColor: null }), 'food');
  assert.equal(iconKeyOf({ icon: 'food', name: '食費', iconColor: '#e53935' }), 'food|#e53935');
  assert.equal(iconKeyOf({ icon: null, name: '食費' }), 'food', '色を持たない形でも読める');
  assert.equal(baseIconKey('food|#e53935'), 'food');
  assert.equal(iconTone('food|#e53935').color, '#e53935', '選んだ色が効く');
  assert.equal(iconTone('food').color, '#7cb342', '色なしはアイコンごとの色');
  assert.equal(iconTone('food|#e53935').key, 'food');
}

// ---- 年（暦年） ----
assert.deepEqual(yearMonthKeys(2026), ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
assert.equal(yearOfMonth('2027-02'), 2027, '2027年2月は2027年');

// ---- 内訳の分析（振り返りの内訳をタップしたとき） ----
{
  const cats: MoneyCategory[] = [
    cat('food', '食費', null, { position: 0 }),
    cat('groc', '食料品', 'food', { position: 0 }),
    cat('out', '外食', 'food', { position: 1 }),
    cat('med', '医療費', null, { position: 1 }),
    cat('sp', '特別費', null, { position: 2 }),
    cat('tax', '自動車税', 'sp'),
  ];
  const buds: MoneyBudget[] = [{ id: 'fb', categoryId: 'food', year: 2026, monthAmounts: Array(12).fill(50000) }];
  const rs = [
    record('a1', { occurredOn: '2026-09-02', items: [item({ amount: 3000, categoryId: 'groc' }), item({ amount: 500, categoryId: 'med' })] }),
    record('a2', { occurredOn: '2026-09-20', store: 'ラーメン', items: [item({ amount: 1200, categoryId: 'out' })] }),
    record('a3', { occurredOn: '2026-08-15', items: [item({ amount: 4000, categoryId: 'groc' })] }),
    record('a4', { occurredOn: '2026-09-25', items: [item({ amount: 700, categoryId: 'food' })] }),
    record('a5', { occurredOn: '2026-09-26', items: [item({ amount: 20000, categoryId: 'tax' })] }),
  ];
  const analysis = buildCategoryAnalysis(rs, cats, buds, 'food', ['2026-09'], ['2026-08']);
  assert.equal(analysis.actual, 4900, '食費の大分類。ほかの大分類は入らない');
  assert.equal(analysis.budget, 50000);
  assert.equal(analysis.diff, 45100);
  assert.equal(analysis.percent, 10);
  assert.equal(analysis.previous, 4000, '前の月');
  assert.deepEqual(analysis.children.map((child) => [child.name, child.amount]), [['食料品', 3000], ['外食', 1200], ['その他', 700]], '小分類ごと（多い順。大分類そのものは「その他」）');
  assert.deepEqual(analysis.records.map((r) => r.id).sort(), ['a1', 'a2', 'a4']);
  assert.equal(analysis.records.find((r) => r.id === 'a1')!.items.length, 1, '記録の品目は、この大分類のものだけに絞る');
  const wholeYear = buildCategoryAnalysis(rs, cats, buds, 'food', ['2026-08', '2026-09'], null);
  assert.equal(wholeYear.actual, 8900);
  assert.equal(wholeYear.budget, 100000, '予算は月ごとに足す');
  assert.equal(wholeYear.previous, null);
  assert.deepEqual(wholeYear.months.map((m) => m.amount), [4000, 4900]);

  // 特別費も大分類のひとつなので、同じ分析で見られる
  const special = buildCategoryAnalysis(rs, cats, buds, 'sp', ['2026-09'], ['2026-08']);
  assert.equal(special.actual, 20000);
  assert.equal(special.budget, null, '特別費は予算を置かない');
  assert.deepEqual(special.children.map((child) => [child.name, child.amount]), [['自動車税', 20000]]);
  assert.deepEqual(special.records.map((r) => r.id), ['a5'], '特別費の記録だけ');
}

console.log('moneyUtils: ok');

// 並べ替えのあとの position: 持っていた position を新しい並びに割り当て直す。出ていない行は動かさない。変わった行だけ返す。
assert.deepEqual(
  reorderedPositions([{ id: 'a', position: 0 }, { id: 'b', position: 1 }, { id: 'c', position: 2 }], ['c', 'a', 'b']),
  [{ id: 'c', position: 0 }, { id: 'a', position: 1 }, { id: 'b', position: 2 }],
);
assert.deepEqual(
  reorderedPositions([{ id: 'a', position: 0 }, { id: 'x', position: 1 }, { id: 'b', position: 2 }], ['b', 'a']),
  [{ id: 'b', position: 0 }, { id: 'a', position: 2 }],
  '種類ごとの一部だけ動かしても、ほかの行の position は動かさない',
);
assert.deepEqual(reorderedPositions([{ id: 'a', position: 0 }, { id: 'b', position: 1 }], ['a', 'b']), [], '変わらなければ何も返さない');
assert.deepEqual(
  reorderedPositions([{ id: 'a', position: 0 }, { id: 'b', position: 0 }], ['b', 'a']),
  [{ id: 'a', position: 1 }],
  'position が重なっていても並びが決まる',
);

// ---- 既にある記録にレシートを当てる前の確認（docs/kakei.md §10.8） ----
{
  // カードの利用通知から作った記録（品名の無い品目1つ）で合計が同じなら、確かめずに入れ替える
  const fromMail = record('rm', { items: [item({ amount: 4415 })] });
  assert.deepEqual(receiptReplaceNotices(fromMail, 4415), []);
  assert.deepEqual(receiptReplaceNotices(fromMail, 4400), ['記録の ¥4,415 とレシートの ¥4,400 で合計が違います']);
  // 手で入れた品目（2つ以上・品名あり）は確かめる
  const manual = record('rh', { items: [item({ amount: 4000 }), item({ amount: 415 })] });
  assert.deepEqual(receiptReplaceNotices(manual, 4415), ['手で入れた品目があります']);
  const named = record('rn', { items: [item({ amount: 4415, name: '牛乳' })] });
  assert.deepEqual(receiptReplaceNotices(named, 4000), ['記録の ¥4,415 とレシートの ¥4,000 で合計が違います', '手で入れた品目があります']);
}
