// 実行: npm run test:amazon-order
import assert from 'node:assert/strict';

import {
  isAmazonOrderSender,
  isAmazonShipmentSender,
  parseAmazonOrderMail,
  parseAmazonShipmentMail,
  readCategoryPicks,
  shortItemName,
} from './amazonOrder.ts';

// 2026-10-16に届いた注文メールの形（1通に注文が2件。宛名・住所は伏せた）
const subject = '注文済み: 「【テープ Sサイズ】パンパース オムツ...」2点とさらに4点の商品';
const body = `注文履歴

https://www.amazon.co.jp/gp/css/order-history?ref_=fed_yo_default

    ご注文ありがとうございます。
注文済み

日曜日にお届け

○○ - 熊本県

注文番号
250-7991927-9006245

注文内容の表示と変更
https://www.amazon.co.jp/your-orders/order-details?orderID=250-7991927-9006245&ref_=p_btn_fed_veo

* アタックZERO パーフェクトスティック 部屋干し 洗濯洗剤 じめじめ部屋干し臭・汗臭まるごと一発洗浄! 55 本入り
  数量: 1
  1100 JPY

* BabyGoo おむつがにおわない袋 防臭検査合格品 (Sサイズ標準パッケージ)
  数量: 2
  1170 JPY

* 【EC限定】ディアナチュラスタイル 鉄×マルチビタミン 90粒(90日分) アサヒ サプリ
  数量: 1
  1419 JPY

合計
4607 JPY

Amazonポイントを支払いに使用した場合、これらは注文時にAmazonポイント残高から差し引かれます。

10月29日にお届け

○○ - 熊本県

注文番号
250-2997453-8952646

注文内容の表示と変更
https://www.amazon.co.jp/your-orders/order-details?orderID=250-2997453-8952646&ref_=p_btn_fed_veo

* 【テープ Sサイズ】パンパース オムツ はじめての肌へのいちばん (4-8kg) 210枚 (70枚×3パック) [ケース品]【Amazon.co.jp限定】
  数量: 2
  5824 JPY

合計
11499 JPY

©2026 Amazon.com. All rights reserved.`;

assert.equal(isAmazonOrderSender('Amazon.co.jp <auto-confirm@amazon.co.jp>'), true);
assert.equal(isAmazonOrderSender('statement@vpass.ne.jp'), false);

const orders = parseAmazonOrderMail(subject, body);
assert.ok(orders);
assert.equal(orders.length, 2);
assert.equal(orders[0].orderNo, '250-7991927-9006245');
assert.equal(orders[0].total, 4607);
assert.deepEqual(
  orders[0].lines.map((line) => [line.quantity, line.unitPrice, line.amount]),
  [
    [1, 1100, 1100],
    [2, 1170, 2340],
    [1, 1419, 1419],
  ],
);
// 先頭の【EC限定】は外す
assert.equal(orders[0].lines[2].name, 'ディアナチュラスタイル 鉄×マルチビタミン 90粒(90日分) アサヒ サプリ');
assert.equal(shortItemName('あ'.repeat(50)), `${'あ'.repeat(40)}…`);
assert.equal(orders[1].orderNo, '250-2997453-8952646');
assert.equal(orders[1].total, 11499);
assert.deepEqual(orders[1].lines.map((line) => line.amount), [11648]);
// もとの品名は残す
assert.ok(orders[1].lines[0].receiptName.startsWith('【テープ Sサイズ】パンパース'));

// 件名が「注文済み」でなければ読まない／注文が読めなければ null
assert.equal(parseAmazonOrderMail('発送のお知らせ', body), null);
assert.equal(parseAmazonOrderMail(subject, 'ご注文ありがとうございます'), null);
// 合計が無ければ品目の和
assert.equal(
  parseAmazonOrderMail('注文済み: 「A」', '注文番号\n111-1111111-1111111\n* A\n  数量: 3\n  ¥200')?.[0].total,
  600,
);

// 合計が0円の注文（品目に値段が載っていても、カードに請求が立たない）は覚えない。2026-10-17の実物
const zeroBody = '注文番号 503-6829870-0030251\n\nキュレル リップケアスティック 4.2g\n数量: 1\n￥935\n\nキュレル リップケアバーム\n数量: 1\n￥1,320\n\n合計\n￥0\n';
// （読めない null とは区別して、空の配列。Apps Script が「対象外」のラベルを付ける）
assert.deepEqual(parseAmazonOrderMail('注文済み: 「キュレル」とさらに1点の商品', zeroBody), []);
// 品目がすべて0円の注文も同じ
assert.deepEqual(
  parseAmazonOrderMail('注文済み: 「A」', '注文番号 111-1111111-1111111\n* 無料サンプル\n  数量: 1\n  ￥0\n'),
  [],
);
// 0円の注文と払う注文が1通に入るときは、払う注文だけ読む
assert.deepEqual(
  parseAmazonOrderMail('注文済み: 「A」', `${zeroBody}注文番号 111-1111111-1111111\n* B\n  数量: 1\n  ￥500\n合計\n￥500\n`)?.map(
    (order) => [order.orderNo, order.total],
  ),
  [['111-1111111-1111111', 500]],
);
// 0円の品目は覚えない
assert.deepEqual(
  parseAmazonOrderMail('注文済み: 「A」', '注文番号 111-1111111-1111111\n* 無料サンプル\n  数量: 1\n  ￥0\n* B\n  数量: 1\n  ￥500\n合計\n￥500\n')?.[0].lines.map(
    (line) => line.receiptName,
  ),
  ['B'],
);

// 箇条書きの記号が無い・空行が挟まる書き方も読む
assert.deepEqual(
  parseAmazonOrderMail('注文済み: 「A」', '注文番号\r\n111-1111111-1111111\r\n\r\nA商品\r\n\r\n  数量: 2\r\n\r\n  300 JPY\r\n\r\n合計\r\n600 JPY')?.[0].lines.map(
    (line) => [line.receiptName, line.quantity, line.unitPrice],
  ),
  [['A商品', 2, 300]],
);

assert.equal(shortItemName('【EC限定】ディアナ'), 'ディアナ');
assert.equal(shortItemName('【A】【B】 ほげ'), 'ほげ');
assert.equal(shortItemName('【全部かっこ】'), '【全部かっこ】');

// ---- 発送メール ----
// 2026-10-23に届いた発送メールの形（宛名・住所は伏せた。注文メールでは合計136円＝ポイント利用。発送メールは値引き前の1248円）
const shipmentBody = `注文履歴

https://www.amazon.co.jp/gp/css/order-history?ref_=fed_yo_default

    荷物が発送されました。
注文済み

発送済み

日曜日にお届け

○○ - 熊本県

注文番号
250-2006575-1539859

配送状況を確認
https://www.amazon.co.jp/progress-tracker/package?_encoding=UTF8&orderId=250-2006575-1539859&packageIndex=0

* コモライフ 焼き網シート 約25cm×1m グリルシート フッ素加工 水洗いOK
  数量: 1
  1248 JPY

合計
1248 JPY
`;
assert.ok(isAmazonShipmentSender('Amazon.co.jp <shipment-tracking@amazon.co.jp>'));
assert.ok(!isAmazonShipmentSender('auto-confirm@amazon.co.jp'));
assert.deepEqual(parseAmazonShipmentMail('発送済み：「コモライフ 焼き網シート 約25cm×1m...」', shipmentBody), [
  { orderNo: '250-2006575-1539859', receiptName: 'コモライフ 焼き網シート 約25cm×1m グリルシート フッ素加工 水洗いOK', quantity: 1 },
]);
// 別々に注文した品目が同じ荷物に入る（注文番号が2つ）
assert.deepEqual(
  parseAmazonShipmentMail(
    '発送済み：「A」',
    '注文番号\n111-1111111-1111111\n\n* A\n  数量: 2\n  300 JPY\n\n注文番号\n222-2222222-2222222\n\n* B\n  数量: 1\n  500 JPY\n\n合計\n1100 JPY',
  )?.map((line) => [line.orderNo, line.receiptName, line.quantity]),
  [
    ['111-1111111-1111111', 'A', 2],
    ['222-2222222-2222222', 'B', 1],
  ],
);
assert.equal(parseAmazonShipmentMail('注文済み: 「A」', shipmentBody), null);
assert.deepEqual(parseAmazonShipmentMail('発送済み：「A」', '注文番号\n111-1111111-1111111\n\n* A\n  数量: 1\n  0 JPY'), []);

// ---- 種類の答えを読む ----
const ids = new Set(['c1', 'c2']);
assert.deepEqual(
  readCategoryPicks({ items: [{ index: 0, category_id: 'c1' }, { index: 1, category_id: 'zzz' }, { index: 5, category_id: 'c2' }] }, 3, ids),
  ['c1', null, null],
);
assert.deepEqual(readCategoryPicks(null, 2, ids), [null, null]);

console.log('amazonOrder: ok');
