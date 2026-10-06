// 防災備蓄の期限の読み書きと色分け（docs/home.md §3）。
// 実行: npm run test:stock
import assert from 'node:assert/strict';

import {
  countByLevel,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  parseExpiryInput,
  sortStockItems,
} from './stockUtils.ts';

// 元の一覧の書き方（日まで・月まで）をそのまま読めること。
assert.deepEqual(parseExpiryInput('2031.08.25'), { expiresOn: '2031-08-25', expiresMonthOnly: false });
assert.deepEqual(parseExpiryInput('2027.06'), { expiresOn: '2027-06-30', expiresMonthOnly: true });
assert.deepEqual(parseExpiryInput(' 2031/8/5 '), { expiresOn: '2031-08-05', expiresMonthOnly: false });
assert.deepEqual(parseExpiryInput('2028-02'), { expiresOn: '2028-02-29', expiresMonthOnly: true });
assert.deepEqual(parseExpiryInput(''), { expiresOn: null, expiresMonthOnly: false });
assert.equal(parseExpiryInput('2031.02.30'), null);
assert.equal(parseExpiryInput('2031.13'), null);
assert.equal(parseExpiryInput('来年'), null);

// 読んだものを書き戻すと元の書き方に戻る。
assert.equal(formatExpiry({ expiresOn: '2027-06-30', expiresMonthOnly: true }), '2027.06');
assert.equal(formatExpiry({ expiresOn: '2031-08-25', expiresMonthOnly: false }), '2031.08.25');
assert.equal(formatExpiry({ expiresOn: null, expiresMonthOnly: false }), '');

// 色分け。期限当日はまだ切れていない。3か月・1年の境目はその日を含む。
const today = '2026-10-06';
assert.equal(expiryLevel(null, today), 'none');
assert.equal(expiryLevel('2026-10-05', today), 'expired');
assert.equal(expiryLevel('2026-10-06', today), 'soon');
assert.equal(expiryLevel('2027-01-06', today), 'soon');
assert.equal(expiryLevel('2027-01-07', today), 'year');
assert.equal(expiryLevel('2027-10-06', today), 'year');
assert.equal(expiryLevel('2027-10-07', today), 'ok');
// 月末の日から月を足しても、存在しない日にならない（11/30 + 3か月 = 2/28）。
assert.equal(expiryLevel('2027-02-28', '2026-11-30'), 'soon');
assert.equal(expiryLevel('2027-03-01', '2026-11-30'), 'year');

// 期限の近い順。期限なしは末尾。
const sorted = sortStockItems([
  { name: 'ラジオ', category: '照明', expiresOn: null, position: 0 },
  { name: '水', category: '飲料', expiresOn: '2036-12-06', position: 0 },
  { name: 'アクエリアス', category: '飲料', expiresOn: '2027-06-30', position: 0 },
]);
assert.deepEqual(
  sorted.map((item) => item.name),
  ['アクエリアス', '水', 'ラジオ'],
);

assert.deepEqual(
  countByLevel(
    [{ expiresOn: '2026-01-01' }, { expiresOn: '2026-12-01' }, { expiresOn: '2027-06-30' }, { expiresOn: null }],
    today,
  ),
  { expired: 1, soon: 1, year: 1 },
);

assert.equal(formatQuantity(48), '48');
assert.equal(formatQuantity(1.5), '1.5');

console.log('stockUtils: OK');
