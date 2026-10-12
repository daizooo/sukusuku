// 実行: npm run test:receipt-scan
import assert from 'node:assert/strict';
import { buildItems, distributeTax, matchStore, matchWallet, normalizeName, type ReceiptReading } from './receiptScan.ts';

// ---- 名前のそろえ方 ----
assert.equal(normalizeName('ﾄﾞﾗｯｸﾞｽﾄｱ　コスモス・下城南中前店'), 'ドラッグストアコスモス下城南中前店');

// ---- 外税の配り方（§10.5） ----
const inclusive = { mode: 'inclusive', rate8_tax: 0, rate10_tax: 0 } as const;
assert.deepEqual(distributeTax([{ amount: 638, tax_rate: 8 }], inclusive), [638], '内税はそのまま');
assert.deepEqual(
  distributeTax(
    [
      { amount: 300, tax_rate: 8 },
      { amount: 100, tax_rate: 8 },
      { amount: 200, tax_rate: 10 },
    ],
    { mode: 'exclusive', rate8_tax: 33, rate10_tax: 20 },
  ),
  [325, 108, 220],
  '税率ごとに金額の比で配り、端数はいちばん大きい品目',
);
assert.deepEqual(
  distributeTax(
    [
      { amount: 500, tax_rate: 0 },
      { amount: -50, tax_rate: 0 },
    ],
    { mode: 'exclusive', rate8_tax: 36, rate10_tax: 0 },
  ),
  [540, -54],
  '税率が分からなければ全体に配る。値引きの行も比で減る',
);

// ---- お店 ----
const stores = ['ドラッグストアコスモス', 'ゆめタウン', 'ゆめタウン光の森'];
assert.equal(matchStore('ﾄﾞﾗｯｸﾞｽﾄｱｺｽﾓｽ 下城南中前店', stores), 'ドラッグストアコスモス');
assert.equal(matchStore('ゆめタウン光の森', stores), 'ゆめタウン光の森', '同じ名前が先');
assert.equal(matchStore('サンリブ', stores), null);
assert.equal(matchStore('', stores), null);

// ---- 出金元 ----
const wallets = [
  { id: 'cash', name: '財布（家族）', type: 'cash' },
  { id: 'visa', name: '三井住友カード 1234', type: 'card' },
  { id: 'amazon', name: 'Amazonカード', type: 'card' },
];
assert.equal(matchWallet({ method: 'cash', card_name: '', last4: '' }, wallets), 'cash', '現金 → 財布（1つだけのとき）');
assert.equal(matchWallet({ method: 'card', card_name: 'VISA', last4: '1234' }, wallets), 'visa', '下4桁');
assert.equal(matchWallet({ method: 'card', card_name: 'ａｍａｚｏｎ', last4: '' }, wallets), 'amazon', 'カード名');
assert.equal(matchWallet({ method: 'card', card_name: 'JCB', last4: '9999' }, wallets), null, '当たらなければ null');
assert.equal(matchWallet({ method: 'unknown', card_name: '', last4: '' }, wallets), null);

// ---- 品目（過去の手本 → AI → 無し） ----
const reading: ReceiptReading = {
  store: 'サンプル店',
  date: '2026-10-12',
  payment: { method: 'cash', card_name: '', last4: '' },
  items: [
    { receipt_name: '濃密ｷﾞﾘｼｬﾖｰｸﾞﾙﾄﾊﾟﾙﾃﾉﾌﾟ', name: '濃密ギリシャヨーグルトパルテノ', quantity: 6, unit_price: 159, amount: 954, tax_rate: 8, category_id: 'food' },
    { receipt_name: '大きな元気たまご', name: '大きな元気たまご', quantity: 2, unit_price: 319, amount: 638, tax_rate: 8, category_id: 'food' },
    { receipt_name: 'レジ袋ＬＬ', name: 'レジ袋LL', quantity: 1, unit_price: 6, amount: 6, tax_rate: 10, category_id: 'nope' },
  ],
  total: 1598,
  tax: inclusive,
};
const learned = new Map([['濃密ｷﾞﾘｼｬﾖｰｸﾞﾙﾄﾊﾟﾙﾃﾉﾌﾟ', { name: 'パルテノ ヨーグルト', categoryId: 'kids' }]]);
const items = buildItems(reading, learned, new Set(['food', 'kids']));
assert.deepEqual(
  items.map((item) => [item.name, item.categoryId, item.categorySource, item.quantity, item.unitPrice, item.amount]),
  [
    ['パルテノ ヨーグルト', 'kids', 'history', 6, 159, 954],
    ['大きな元気たまご', 'food', 'ai', 2, 319, 638],
    ['レジ袋LL', null, 'none', 1, 6, 6],
  ],
  '過去の手本があれば品名・種類はそれ。一覧に無い種類は使わない',
);
// 税を足して割り切れなくなったら1個として扱う
const taxed = buildItems(
  { ...reading, items: [reading.items[1]], tax: { mode: 'exclusive', rate8_tax: 51, rate10_tax: 0 } },
  new Map(),
  new Set(['food']),
);
assert.deepEqual([taxed[0].quantity, taxed[0].unitPrice, taxed[0].amount], [1, 689, 689]);

console.log('receiptScan: ok');
