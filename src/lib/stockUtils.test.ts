// 防災備蓄の期限の読み書きと色分け（docs/home.md §3）。
// 実行: npm run test:stock
import assert from 'node:assert/strict';

import {
  buildStockBoard,
  carryInspection,
  costOverview,
  countByLevel,
  daysBetween,
  expiryCountdown,
  spanText,
  stockIconKey,
  expiryLevel,
  formatExpiry,
  formatQuantity,
  formatYen,
  inspectionDue,
  jstDateOf,
  nextInspectionOn,
  parseExpiryInput,
  replacementLots,
  targetCost,
  unitPriceOf,
  isShort,
  requiredQuantity,
  sortStockItems,
  storageShares,
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

// ---- 値段・点検・要対応（docs/home.md §10.2） ----

assert.equal(formatYen(1234567), '¥1,234,567');
assert.equal(formatYen(980.4), '¥980');
assert.equal(formatYen(0), '¥0');

// created_at（UTC）を日本時間の日付にする。UTC 15:00 以降は翌日。
assert.equal(jstDateOf('2026-10-06T14:59:59Z'), '2026-10-06');
assert.equal(jstDateOf('2026-10-06T15:00:00Z'), '2026-10-07');

// 最小単位あたり。500mlの本（0.5L）が120円なら 240円/L。目標に数えていない・値段未登録は null。
assert.equal(unitPriceOf({ price: 120, amountPerUnit: 0.5, targetId: 'water' }), 240);
assert.equal(unitPriceOf({ price: 120, amountPerUnit: 0.5, targetId: null }), null);
assert.equal(unitPriceOf({ price: null, amountPerUnit: 0.5, targetId: 'water' }), null);

// 点検。期限のある品・間隔の無い品・数が0の品は対象外。点検日が無ければ追加日から数える。
const radio = { expiresOn: null, quantity: 1, inspectedOn: null, inspectIntervalMonths: 6, createdOn: '2026-10-07' };
assert.equal(nextInspectionOn(radio), '2027-04-07');
assert.equal(inspectionDue(radio, '2027-04-06'), false);
assert.equal(inspectionDue(radio, '2027-04-07'), true);
assert.equal(nextInspectionOn({ ...radio, inspectedOn: '2027-04-07' }), '2027-10-07');
assert.equal(nextInspectionOn({ ...radio, inspectIntervalMonths: 3 }), '2027-01-07');
assert.equal(nextInspectionOn({ ...radio, inspectIntervalMonths: null }), null);
assert.equal(nextInspectionOn({ ...radio, expiresOn: '2030-01-01' }), null);
assert.equal(nextInspectionOn({ ...radio, quantity: 0 }), null);
// 月末の追加日から半年後が存在しない日でも、その月の末日にそろう。
assert.equal(nextInspectionOn({ ...radio, createdOn: '2026-08-31' }), '2027-02-28');

// 持ち出しバッグ。空なら null。一度も点検していなければ、一番古い追加日から半年。
const bagItem = (storage: 'home' | 'carry', inspectedOn: string | null, createdOn: string) => ({
  storage,
  quantity: 1,
  inspectedOn,
  createdOn,
});
assert.equal(carryInspection([bagItem('home', null, '2026-01-01')], today), null);
assert.deepEqual(carryInspection([bagItem('carry', null, '2026-04-06'), bagItem('carry', null, '2026-09-01')], today), {
  lastOn: null,
  nextOn: '2026-10-06',
  due: true,
});
assert.deepEqual(carryInspection([bagItem('carry', '2026-09-01', '2026-01-01'), bagItem('carry', null, '2026-01-01')], today), {
  lastOn: '2026-09-01',
  nextOn: '2027-03-01',
  due: false,
});

// 要対応: 期限切れ・3か月以内のロットだけ。数が0・1年以内は出さない。値段未登録は合計に含めない。
const lot = (name: string, expiresOn: string | null, quantity: number, price: number | null) => ({
  name,
  expiresOn,
  quantity,
  price,
  amountPerUnit: 1,
  targetId: null,
});
const replacement = replacementLots(
  [
    lot('スープ', '2026-12-01', 4, 200),
    lot('水', '2026-09-30', 10, 100),
    lot('えいようかん', '2026-11-01', 5, null),
    lot('缶', '2027-06-30', 3, 300),
    lot('ラジオ', null, 1, 5000),
    lot('空', '2026-10-10', 0, 100),
  ],
  today,
);
assert.deepEqual(
  replacement.lots.map((row) => [row.item.name, row.level, row.amount]),
  [
    ['水', 'expired', 1000],
    ['えいようかん', 'soon', null],
    ['スープ', 'soon', 800],
  ],
);
assert.equal(replacement.total, 1800);
assert.equal(replacement.unpriced, 1);

// 目標の費用。水500ml（0.5L・120円）と1.8L（300円）を、持っている量で重みを付けて平均する。
// 500ml: 240円/L・持っているのは 4L。1.8L: 約166.7円/L・持っているのは 3.6L。
const costTarget = { id: 'water', quantity: 3, perPersonDay: true };
const [costStatus] = targetStatuses(
  [costTarget],
  [
    { targetId: 'water', quantity: 8, amountPerUnit: 0.5, expiresOn: '2036-12-06' },
    { targetId: 'water', quantity: 2, amountPerUnit: 1.8, expiresOn: '2037-02-23' },
  ],
  plan,
  today,
);
const cost = targetCost(
  costStatus,
  [
    { targetId: 'water', quantity: 8, amountPerUnit: 0.5, price: 120 },
    { targetId: 'water', quantity: 2, amountPerUnit: 1.8, price: 300 },
  ],
  plan,
);
assert.equal(cost.daily, 9);
assert.ok(cost.unitPrice !== null && Math.abs(cost.unitPrice - (240 * 4 + (300 / 1.8) * 3.6) / 7.6) < 1e-9);
assert.equal(cost.total, cost.unitPrice! * 63);
assert.equal(cost.shortageCost, cost.unitPrice! * costStatus.shortage);

// 値段が未登録の目標は費用を出さず、合計にも含めず、件数だけ数える。決まった数の品目は1日あたりが null。
const noPrice = targetCost(costStatus, [{ targetId: 'water', quantity: 8, amountPerUnit: 0.5, price: null }], plan);
assert.deepEqual(noPrice, { unitPrice: null, daily: 9, total: null, shortageCost: null });
const fixed = targetCost({ ...costStatus, target: { id: 'r', quantity: 1, perPersonDay: false }, required: 1, shortage: 1 }, [], plan);
assert.equal(fixed.daily, null);
assert.deepEqual(costOverview([cost, noPrice]), {
  total: cost.total!,
  shortageTotal: cost.shortageCost!,
  unpricedTargets: 1,
});

console.log('stockUtils cost/inspection: OK');

// ---- 点検盤のまとめ ----
const boardItem = (patch: Record<string, unknown>) => ({
  id: String(patch.name),
  name: 'x',
  category: '',
  position: 0,
  quantity: 1,
  unit: '',
  amountPerUnit: 1,
  targetId: null,
  price: null,
  expiresOn: null,
  storage: 'home' as const,
  inspectedOn: null,
  inspectIntervalMonths: null,
  createdOn: '2026-01-01',
  ...patch,
});
const board = buildStockBoard(
  [
    boardItem({ name: '水500', targetId: 'water', amountPerUnit: 0.5, quantity: 6, price: 100, expiresOn: '2026-11-30' }),
    boardItem({ name: '水1.8', targetId: 'water', amountPerUnit: 1.8, quantity: 2, expiresOn: '2030-01-01', storage: 'carry' }),
    boardItem({ name: 'クッキー', expiresOn: '2027-03-01', price: 200 }),
    boardItem({ name: 'ラジオ', inspectIntervalMonths: 6, createdOn: '2026-04-01' }),
    boardItem({ name: 'ランタン', inspectIntervalMonths: 6, inspectedOn: '2026-09-01' }),
    boardItem({ name: '衛生用品' }),
  ],
  [{ id: 'water', quantity: 3, perPersonDay: true, carry: true, category: '飲料・水', name: '水', position: 0, unit: 'L' }],
  plan,
  today,
);
assert.equal(board.blocks.length, 1);
assert.deepEqual(
  board.blocks[0].lots.map((lot) => lot.name),
  ['水500', '水1.8'],
);
assert.deepEqual(
  board.others.map((lot) => lot.name),
  ['クッキー'],
);
assert.deepEqual(
  board.equipment.map((lot) => lot.name).sort(),
  ['ラジオ', 'ランタン', '衛生用品'],
);
// 点検の時期はラジオだけ（追加から半年経った）。ランタンは先月点検済み、衛生用品は間隔なし。
assert.deepEqual(
  board.attention.inspect.map((lot) => lot.name),
  ['ラジオ'],
);
assert.deepEqual(
  board.attention.replacement.lots.map((row) => row.item.name),
  ['水500'],
);
assert.equal(board.attention.short.length, 1);
assert.equal(board.counts.soon, 1);
assert.equal(board.counts.inspect, 1);
assert.equal(board.attention.bag?.lastOn, null);

console.log('stockUtils board: OK');

// ---- 見た目の小さな計算 ----
assert.equal(daysBetween('2026-10-07', '2026-10-17'), 10);
assert.equal(daysBetween('2026-10-07', '2026-09-30'), -7);
assert.equal(daysBetween('2027-02-28', '2027-03-01'), 1);
assert.equal(spanText(18), '18日');
assert.equal(spanText(-100), '3か月');
assert.equal(spanText(800), '2年');
assert.equal(expiryCountdown('2026-10-25', '2026-10-07'), 'あと18日');
assert.equal(expiryCountdown('2026-09-25', '2026-10-07'), '切れて12日');
assert.equal(expiryCountdown('2026-10-07', '2026-10-07'), '今日まで');
assert.equal(expiryCountdown('2027-03-07', '2026-10-07'), 'あと5か月');

assert.equal(stockIconKey('水 500ml'), 'water');
assert.equal(stockIconKey('ウォーターバッグ（10L）'), 'bag');
assert.equal(stockIconKey('BOS非常用トイレ'), 'toilet');
assert.equal(stockIconKey('BOS防臭袋'), 'trash');
assert.equal(stockIconKey('アクエリアスパウダー'), 'drink');
assert.equal(stockIconKey('やきとり缶'), 'meat');
assert.equal(stockIconKey('LEDランタン'), 'light');
assert.equal(stockIconKey('クッキー缶'), 'snack');
assert.equal(stockIconKey('なぞの品', '照明・情報・電池類'), 'light');
assert.equal(stockIconKey('なぞの品'), 'other');

assert.equal(board.readiness, Math.round((Math.min(1, 6.6 / 63)) * 100));
assert.equal(board.counts.ok, 1);
assert.equal(board.counts.year, 1);

console.log('stockUtils look: OK');

// ---- カテゴリ別・品目別 ----
const catItem = (patch: Record<string, unknown>) => boardItem({ category: '食料品', unit: '個', ...patch });
const catBoard = buildStockBoard(
  [
    catItem({ name: 'スープ', targetId: 'soup', quantity: 10, expiresOn: '2026-12-01', storage: 'home', category: '食料品' }),
    catItem({ name: 'スープ', targetId: 'soup', quantity: 4, expiresOn: '2028-01-01', storage: 'carry', category: '食料品' }),
    catItem({ name: '水', targetId: 'water', quantity: 20, amountPerUnit: 0.5, unit: '本', expiresOn: '2030-01-01', category: '飲料・水' }),
    catItem({ name: 'ラジオ', quantity: 1, unit: '台', category: '照明・情報', inspectIntervalMonths: 6, createdOn: '2026-04-01' }),
    catItem({ name: 'クッキー', quantity: 3, expiresOn: '2027-03-01' }),
    catItem({ name: 'クッキー', quantity: 2, expiresOn: '2026-11-01' }),
    catItem({ name: '名無し', quantity: 1, category: '' }),
  ],
  [
    { id: 'soup', quantity: 3, perPersonDay: true, carry: true, category: '食料品', name: '野菜スープ', position: 1, unit: '食' },
    { id: 'water', quantity: 3, perPersonDay: true, carry: false, category: '飲料・水', name: '水', position: 0, unit: 'L' },
  ],
  plan,
  today,
);
assert.deepEqual(
  catBoard.categories.map((row) => row.category),
  ['飲料・水', '食料品', '照明・情報', 'その他'],
);
const foods = catBoard.categories[1].products;
assert.deepEqual(
  foods.map((product) => product.name),
  ['野菜スープ', 'クッキー'],
);
// 目標のある品は目標の単位の量（寝室・持ち出しの合計）。持ち出しの分も別に持つ。
assert.equal(foods[0].total, 14);
assert.equal(foods[0].unit, '食');
assert.equal(foods[0].carryTotal, 4);
assert.deepEqual(foods[0].nearest, { on: '2026-12-01', level: 'soon' });
// 目標の無い同名のロットは1品目にまとめ、数を足す。いちばん近い期限を出す。
assert.equal(foods[1].total, 5);
assert.equal(foods[1].lots.length, 2);
assert.deepEqual(foods[1].nearest, { on: '2026-11-01', level: 'soon' });
// 水 500ml × 20本 = 10L。
assert.equal(catBoard.categories[0].products[0].total, 10);
// 点検が要る備品。
const radioProduct = catBoard.categories[2].products[0];
assert.deepEqual(radioProduct.inspect, { next: '2026-10-01', due: true });
assert.equal(radioProduct.nearest, null);

// 寝室・持ち出し用の内訳。持ち出しに入れる目標は、持ち出し用に「人数×バッグの日数」分、寝室に残りを要るとする。
assert.deepEqual(storageShares(foods[0], today), {
  home: { have: 10, required: 54, shortage: 44, surplus: 0 },
  carry: { have: 4, required: 9, shortage: 5, surplus: 0 },
});
// 持ち出しに入れない目標は、寝室に全部が要る。持ち出し用の要る量は無い。
assert.deepEqual(storageShares(catBoard.categories[0].products[0], today), {
  home: { have: 10, required: 63, shortage: 53, surplus: 0 },
  carry: { have: 0, required: null, shortage: 0, surplus: 0 },
});
// 目標の無い品目は、ロットの数だけ。
assert.deepEqual(storageShares(foods[1], today).home, { have: 5, required: null, shortage: 0, surplus: 0 });
// 寝室が多く、持ち出し用が足りない（分ければ揃う）。期限切れは数えない。
const shareTarget = { id: 's', quantity: 1, perPersonDay: true, carry: true, category: '', name: '', position: 0, unit: '本' };
const shareProduct = buildStockBoard(
  [
    catItem({ name: '水', targetId: 's', quantity: 25, expiresOn: '2030-01-01' }),
    catItem({ name: '水', targetId: 's', quantity: 1, expiresOn: '2030-01-01', storage: 'carry' }),
    catItem({ name: '水', targetId: 's', quantity: 5, expiresOn: '2026-01-01', storage: 'carry' }),
  ],
  [shareTarget],
  plan,
  today,
).categories[0].products[0];
assert.deepEqual(storageShares(shareProduct, today), {
  home: { have: 25, required: 18, shortage: 0, surplus: 7 },
  carry: { have: 1, required: 3, shortage: 2, surplus: 0 },
});

console.log('stockUtils categories: OK');

// migration 0062 の適用前は、値段・点検の列が undefined で来ても壊れない（NaN を出さない）。
const legacy = { ...radio, inspectIntervalMonths: undefined as unknown as null, price: undefined as unknown as null };
assert.equal(nextInspectionOn(legacy), null);
assert.equal(unitPriceOf({ price: undefined as unknown as null, amountPerUnit: 1, targetId: 'w' }), null);
assert.equal(replacementLots([{ ...lot('水', '2026-09-30', 2, null), price: undefined as unknown as null }], today).lots[0].amount, null);

console.log('stockUtils legacy: OK');
