// 買い出しリストへ送るときの決まりごと（docs/home.md §4.2）。
// 実行: npm run test:shopping
import assert from 'node:assert/strict';

import { formatPrice, planShoppingAdd, shortageTitle, suggestProducts } from './shoppingUtils.ts';

const groups = [
  { id: 'aeon', name: 'イオン' },
  { id: 'drug', name: 'ドラッグストア' },
];
const items = [
  { groupId: 'aeon', title: '牛乳', done: false, position: 0 },
  { groupId: 'aeon', title: 'パン', done: false, position: 1 },
  { groupId: null, title: '電池', done: false, position: 0 },
  { groupId: 'drug', title: 'ティッシュ', done: true, position: 0 },
];

// お店の名前と同じグループの末尾へ。全角・半角や前後の空白は気にしない。
assert.deepEqual(planShoppingAdd(groups, items, 'トイレットペーパー', ' ｲｵﾝ '), {
  kind: 'add',
  groupId: 'aeon',
  groupName: 'イオン',
  position: 2,
});
// 同じ名前のグループが無ければ未分類の末尾へ。
assert.deepEqual(planShoppingAdd(groups, items, '洗剤', 'コストコ'), {
  kind: 'add',
  groupId: null,
  groupName: null,
  position: 1,
});
// まだ買っていない同じ項目があれば重ねない。買い終えた項目なら入れ直す。
assert.deepEqual(planShoppingAdd(groups, items, ' 牛乳 ', 'イオン'), { kind: 'duplicate', groupName: 'イオン' });
assert.equal(planShoppingAdd(groups, items, 'ティッシュ', 'ドラッグストア').kind, 'add');

// 候補: 打った文字を含むもの。同じものは出さない。最近送ったものが先。
const products = [
  { name: 'トイレットペーパー', lastAddedAt: '2026-10-01T00:00:00Z' },
  { name: 'キッチンペーパー', lastAddedAt: '2026-10-05T00:00:00Z' },
  { name: 'ペーパータオル', lastAddedAt: null },
  { name: '牛乳', lastAddedAt: null },
];
assert.deepEqual(
  suggestProducts(products, 'ペーパー').map((product) => product.name),
  ['キッチンペーパー', 'トイレットペーパー', 'ペーパータオル'],
);
assert.deepEqual(suggestProducts(products, '牛乳'), []);
assert.deepEqual(suggestProducts(products, '  '), []);

assert.equal(shortageTitle('肉（やきとり缶）', 3, '個'), '肉（やきとり缶） 3個');
assert.equal(shortageTitle('ご飯（無洗米）', 5.25, 'kg'), 'ご飯（無洗米） 5.25kg');
assert.equal(formatPrice(1280), '¥1,280');

console.log('shoppingUtils: OK');
