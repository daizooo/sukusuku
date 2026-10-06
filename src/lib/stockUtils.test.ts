// 防災備蓄の期限の読み書きと色分け（docs/home.md §3）。
// 実行: npm run test:stock
import assert from 'node:assert/strict';

import {
  countByLevel,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  parseExpiryInput,
  isShort,
  requiredQuantity,
  sortStockItems,
  targetStatuses,
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

// ---- 必要数 ----

const plan = { people: 3, days: 7, carryDays: 1 };
// 水は1人1日3L → 63L。ラジオは決まった数。
assert.equal(requiredQuantity({ id: 'w', quantity: 3, perPersonDay: true }, plan), 63);
assert.equal(requiredQuantity({ id: 'r', quantity: 1, perPersonDay: false }, plan), 1);

const statuses = targetStatuses(
  [
    { id: 'water', quantity: 3, perPersonDay: true },
    { id: 'meat', quantity: 3, perPersonDay: true },
    { id: 'rice', quantity: 0.225, perPersonDay: true },
  ],
  [
    // 500ml × 48本 = 24L、1.8L × 46本 = 82.8L
    { targetId: 'water', quantity: 48, amountPerUnit: 0.5, expiresOn: '2036-12-06' },
    { targetId: 'water', quantity: 46, amountPerUnit: 1.8, expiresOn: '2037-02-23' },
    { targetId: 'meat', quantity: 60, amountPerUnit: 1, expiresOn: '2028-06-13' },
    // 期限切れは数えない
    { targetId: 'meat', quantity: 10, amountPerUnit: 1, expiresOn: '2026-01-01' },
    { targetId: null, quantity: 5, amountPerUnit: 1, expiresOn: null },
  ],
  plan,
  today,
);
assert.deepEqual(
  statuses.map(({ required, have, shortage }) => ({ required, have, shortage })),
  [
    { required: 63, have: 106.8, shortage: 0 },
    { required: 63, have: 60, shortage: 3 },
    { required: 4.73, have: 0, shortage: 4.73 },
  ],
);

console.log('stockUtils targets: OK');

// ---- 保管場所（持ち出し） ----
// 水は1人1日3L。持ち出しは1日分（9L）。持ち出しにあるのは 500ml × 6本 = 3L だけ。
const [water] = targetStatuses(
  [{ id: 'water', quantity: 3, perPersonDay: true, carry: true }],
  [
    { targetId: 'water', quantity: 42, amountPerUnit: 0.5, expiresOn: '2036-12-06', storage: 'home' },
    { targetId: 'water', quantity: 6, amountPerUnit: 0.5, expiresOn: '2036-12-06', storage: 'carry' },
    { targetId: 'water', quantity: 46, amountPerUnit: 1.8, expiresOn: '2037-02-23', storage: 'home' },
  ],
  plan,
  today,
);
// 全体は両方の場所を数える（24L + 82.8L）。持ち出しは持ち出しの分だけ。
assert.equal(water.have, 106.8);
assert.deepEqual(water.carry, { required: 9, have: 3, shortage: 6 });
assert.equal(isShort(water), true);

// 持ち出しに入れない品目は carry が null。決まった数の品目は全部を持ち出しで確かめる。
const [rice, light] = targetStatuses(
  [
    { id: 'rice', quantity: 0.25, perPersonDay: true, carry: false },
    { id: 'light', quantity: 1, perPersonDay: false, carry: true },
  ],
  [{ targetId: 'light', quantity: 1, amountPerUnit: 1, expiresOn: null, storage: 'carry' }],
  plan,
  today,
);
assert.equal(rice.carry, null);
assert.deepEqual(light.carry, { required: 1, have: 1, shortage: 0 });
assert.equal(isShort(light), false);

console.log('stockUtils storage: OK');
