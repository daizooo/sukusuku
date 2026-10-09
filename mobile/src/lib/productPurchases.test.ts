// 日用品の「品ごとの買った記録」の数え方（docs/home.md §4.6）。
// 実行: npm run test:product-purchases
import assert from 'node:assert/strict';

import {
  compactYen,
  costEstimate,
  formatPriceChange,
  monthlyPurchases,
  newestFirst,
  priceHistory,
  priceSummary,
  priceTrend,
  purchaseTotals,
  resolveUnitPrice,
  type PurchaseLine,
} from './productPurchases.ts';

const line = (on: string, quantity: number, amount: number, store = 'イオン'): PurchaseLine => ({
  on,
  quantity,
  amount,
  unitPrice: Math.round(amount / quantity),
  store,
});

// 単価: 記録にあればそれ、無ければ 金額 ÷ 個数（丸め）。
assert.equal(resolveUnitPrice(1196, 2, 598), 598);
assert.equal(resolveUnitPrice(1000, 3, null), 333);
assert.equal(resolveUnitPrice(500, 0, null), 500);

// 費用の目安: 2回に満たなければ出さない。
assert.equal(costEstimate([], '2026-10-09'), null);
assert.equal(costEstimate([line('2026-10-01', 2, 1000)], '2026-10-09'), null);

// 合計 ÷ 最初に買った日から今日までの日数（今日を含む）。10/1〜10/10 は10日、合計 2000円 → 1日 200円。
assert.deepEqual(costEstimate([line('2026-10-01', 2, 1000), line('2026-10-08', 1, 1000)], '2026-10-10'), {
  perDay: 200,
  perMonth: 6080,
  perYear: 73000,
});
// 同じ日に2行あっても2回。最初の日が今日なら日数は1。
assert.deepEqual(costEstimate([line('2026-10-09', 1, 300), line('2026-10-09', 1, 300)], '2026-10-09'), {
  perDay: 600,
  perMonth: 18240,
  perYear: 219000,
});
// 渡す順は関係ない（最初の日は日付で決める）。
assert.equal(
  costEstimate([line('2026-10-08', 1, 1000), line('2026-10-01', 2, 1000)], '2026-10-10')?.perDay,
  200,
);

// 月ごと: 直近12か月、古い月が先。買っていない月は0、範囲外は数えない。
const monthly = monthlyPurchases(
  [line('2026-10-01', 2, 1000), line('2026-10-08', 1, 500), line('2026-08-15', 3, 900), line('2025-10-31', 1, 100)],
  '2026-10-09',
);
assert.equal(monthly.length, 12);
assert.equal(monthly[0].month, '2025-11');
assert.equal(monthly[11].month, '2026-10');
assert.deepEqual(monthly[11], { month: '2026-10', quantity: 3, amount: 1500 });
assert.deepEqual(monthly[9], { month: '2026-08', quantity: 3, amount: 900 });
assert.deepEqual(monthly[10], { month: '2026-09', quantity: 0, amount: 0 });
// 年またぎ。
assert.deepEqual(monthlyPurchases([], '2026-02-01', 3).map((row) => row.month), ['2025-12', '2026-01', '2026-02']);

// 新しい順。同じ日は渡された順のまま。
assert.deepEqual(
  newestFirst([line('2026-10-01', 1, 1, 'a'), line('2026-10-08', 1, 1, 'b'), line('2026-10-08', 1, 1, 'c')]).map(
    (row) => row.store,
  ),
  ['b', 'c', 'a'],
);

// n回・合計。
assert.deepEqual(purchaseTotals([line('2026-10-01', 2, 1000), line('2026-10-08', 1, 500)]), { count: 2, amount: 1500 });
assert.deepEqual(purchaseTotals([]), { count: 0, amount: 0 });

// 棒の下の金額。
assert.equal(compactYen(0), '0');
assert.equal(compactYen(1234), '1,234');
assert.equal(compactYen(9999), '9,999');
assert.equal(compactYen(12000), '1.2万');
assert.equal(compactYen(30000), '3万');

// 値段の推移: 古い順の点（日付・場所・値段）。
const priced = (on: string, unitPrice: number, store: string): PurchaseLine => ({
  on,
  quantity: 1,
  amount: unitPrice,
  unitPrice,
  store,
});
const history = [
  priced('2026-10-08', 648, 'イオン'),
  priced('2026-08-01', 598, 'コストコ'),
  priced('2026-09-05', 598, 'イオン'),
];
const trend = priceTrend(history);
assert.deepEqual(trend.map((point) => point.on), ['2026-08-01', '2026-09-05', '2026-10-08']);
assert.deepEqual(trend[2], { on: '2026-10-08', store: 'イオン', unitPrice: 648 });
assert.equal(priceSummary([]), null);
// 要約: 最初→いま の差、最安（同じ値段なら新しいほう）。
const summary = priceSummary(trend);
assert.equal(summary?.change, 50);
assert.deepEqual(summary?.lowest, { on: '2026-09-05', store: 'イオン', unitPrice: 598 });
assert.equal(summary?.first.store, 'コストコ');
assert.equal(summary?.latest.unitPrice, 648);
// 1回だけなら差は0。
assert.equal(priceSummary(trend.slice(0, 1))?.change, 0);

// 買った記録（新しい順）の値段の差: 1つ前に買ったときとの差。同じ値段・最初の1回は null。
assert.deepEqual(priceHistory(history).map((row) => row.change), [50, null, null]);
assert.deepEqual(priceHistory([priced('2026-10-08', 500, 'a'), priced('2026-10-01', 520, 'b')]).map((row) => row.change), [-20, null]);

assert.equal(formatPriceChange(50), '+¥50');
assert.equal(formatPriceChange(-1200), '−¥1,200');

console.log('productPurchases: ok');
