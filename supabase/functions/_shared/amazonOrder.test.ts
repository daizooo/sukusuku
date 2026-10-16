// 実行: npm run test:amazon-order
import assert from 'node:assert/strict';

import {
  isAmazonCharge,
  isAmazonOrderSender,
  matchAmazonCharge,
  parseAmazonOrderMail,
  readCategoryPicks,
  shortItemName,
  type OpenAmazonOrder,
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

assert.equal(shortItemName('【EC限定】ディアナ'), 'ディアナ');
assert.equal(shortItemName('【A】【B】 ほげ'), 'ほげ');
assert.equal(shortItemName('【全部かっこ】'), '【全部かっこ】');

assert.equal(isAmazonCharge('AMAZON.CO.JP', '三井住友カード'), true);
assert.equal(isAmazonCharge('ＡＭＡＺＯＮ　ＣＯ　ＪＰ', '三井住友カード'), true);
assert.equal(isAmazonCharge('アマゾンジャパン', '三井住友カード'), true);
assert.equal(isAmazonCharge('YOKAMONNE JIYONANTEN', '三井住友カード'), false);
assert.equal(isAmazonCharge('YOKAMONNE JIYONANTEN', '三井住友カード（Amazon）'), true);

// ---- 割り振り ----
const line = (id: string, amount: number, position: number) => ({ id, amount, position });
const order = (over: Partial<OpenAmazonOrder> & Pick<OpenAmazonOrder, 'orderId' | 'lines'>): OpenAmazonOrder => ({
  orderedOn: '2026-10-10',
  discountLeft: 0,
  fee: 0,
  feeOpen: true,
  ...over,
});
const only = (ids: string[], over: object = {}) => ({ orderId: 'o1', lineIds: ids, withFee: false, discount: 0, ...over });

// 依頼の例: 注文（A500・B300・C250）に、500円と550円の2通
const abc = order({ orderId: 'o1', lines: [line('A', 500, 0), line('B', 300, 1), line('C', 250, 2)] });
assert.deepEqual(matchAmazonCharge(500, [abc]), only(['A']));
const afterFirst = order({ orderId: 'o1', lines: [line('B', 300, 1), line('C', 250, 2)] });
assert.deepEqual(matchAmazonCharge(550, [afterFirst]), only(['B', 'C']));
// 先に550円が来ても同じ（A は残る）
assert.deepEqual(matchAmazonCharge(550, [abc]), only(['B', 'C']));
// 当たらない額（どの組み合わせの和よりも高い）
assert.equal(matchAmazonCharge(1500, [abc]), null);
assert.equal(matchAmazonCharge(500, []), null);

// ---- 商品ごとの値引き（定期おトク便・クーポン）----
// 実物（2026-09-14の注文）: アタック 1,379円（定期おトク便で 138円引き）とブラックキャップ 1,509円。小計 2,888円・割引 −138円・請求 2,750円。
// アタックだけが 1,241円、ブラックキャップは 1,509円で請求された。値引きは全体への按分ではなく、商品ごと
const real = order({ orderId: 'o1', discountLeft: 138, lines: [line('attack', 1379, 0), line('cap', 1509, 1)] });
assert.deepEqual(matchAmazonCharge(1241, [real]), only(['attack'], { discount: 138 })); // ブラックキャップに当てると 268円引きで予算（138円）を超える
assert.deepEqual(matchAmazonCharge(1509, [real]), only(['cap'])); // 値引きなしで額が合う
assert.deepEqual(matchAmazonCharge(2750, [real]), only(['attack', 'cap'], { discount: 138 })); // 全部まとめて請求
// 残りの全部で値引きが予算より小さいものは当てない（アタックだけを 1,379円で請求 → 値引きが残ってしまう）
assert.equal(matchAmazonCharge(1379, [order({ orderId: 'o1', discountLeft: 138, lines: [line('attack', 1379, 0)] })]), null);
// ブラックキャップが先に請求されたあと（値引きの予算は残る）、アタックに 138円引き
assert.deepEqual(matchAmazonCharge(1241, [order({ orderId: 'o1', discountLeft: 138, lines: [line('attack', 1379, 0)] })]), only(['attack'], { discount: 138 }));
// アタックが先に請求されたあと（予算は使い切り）、ブラックキャップは値引きなし
assert.deepEqual(matchAmazonCharge(1509, [order({ orderId: 'o1', lines: [line('cap', 1509, 1)] })]), only(['cap']));

// 2026-10-16の注文: 品目の和 4,859円、合計 4,607円（差 252円 = アタック1,100円の10%とディアナチュラ1,419円の10%）
const coupon = order({
  orderId: 'o1',
  discountLeft: 252,
  lines: [line('x', 1100, 0), line('y', 2340, 1), line('z', 1419, 2)],
});
assert.deepEqual(matchAmazonCharge(4607, [coupon]), only(['x', 'y', 'z'], { discount: 252 }));
assert.deepEqual(matchAmazonCharge(990, [coupon]), only(['x'], { discount: 110 }));
assert.deepEqual(matchAmazonCharge(1277, [coupon]), only(['z'], { discount: 142 }));
// x+z（2,267円）は y の 73円引きとも読める（額の違う候補が予算内に2つ）→ 紛れるので当てない
assert.equal(matchAmazonCharge(990 + 1277, [coupon]), null);
assert.deepEqual(matchAmazonCharge(2340, [coupon]), only(['y'])); // y は値引きなし
// 値引きの予算内で、額の違う候補が複数あるとき（P の δ40・Q の δ90）→ 紛れるので当てない
const twoPromos = order({ orderId: 'o1', discountLeft: 100, lines: [line('P', 1000, 0), line('Q', 1050, 1)] });
assert.equal(matchAmazonCharge(960, [twoPromos]), null);

// ---- 予算を超える値引き（ポイントの利用。額は載らない）----
// 割引の無い注文（A500・B300・C250）に、ポイントが乗った請求
// 紛れる候補が無ければ当てる（B+C=550 に対して 540。ほかは差が大きすぎる）
assert.deepEqual(matchAmazonCharge(540, [abc]), only(['B', 'C'], { discount: 10 }));
// 候補が紛れるとき（A500 の450円は差10%、B+C=550 の差は18%）→ 当てない
assert.equal(matchAmazonCharge(450, [abc]), null);
// 全部まとめて請求（1,050円の注文に、ポイントで50円引かれた1,000円）
assert.deepEqual(matchAmazonCharge(1000, [abc]), only(['A', 'B', 'C'], { discount: 50 }));
// 値引きが大きすぎる（2割を超える）請求は、別の請求とみなして当てない
assert.equal(matchAmazonCharge(400, [order({ orderId: 'big', lines: [line('P', 1000, 0)] })]), null);
// 値引きの予算（252円）のある注文に、ポイントがさらに乗った全部の請求（4,859 − 252 − 207 = 4,400）
assert.deepEqual(matchAmazonCharge(4400, [coupon]), only(['x', 'y', 'z'], { discount: 459 }));

// ---- 送料などの上乗せ（合計が品目の和より高い。残りの全部をまとめた請求に足す）----
const shipping = order({ orderId: 'o1', fee: 500, lines: [line('L', 1000, 0), line('M', 800, 1)] });
assert.deepEqual(matchAmazonCharge(2300, [shipping]), only(['L', 'M'], { withFee: true }));
assert.deepEqual(matchAmazonCharge(1000, [shipping]), only(['L']));
assert.deepEqual(matchAmazonCharge(1800, [shipping]), only(['L', 'M']));
assert.equal(matchAmazonCharge(2300, [{ ...shipping, feeOpen: false }]), null);

// ---- 古い注文から・同額の品目 ----
const older = order({ orderId: 'old', orderedOn: '2026-10-01', lines: [line('p', 300, 0), line('q', 300, 1)] });
const newer = order({ orderId: 'new', orderedOn: '2026-10-05', lines: [line('r', 300, 0)] });
assert.deepEqual(matchAmazonCharge(300, [newer, older]), only(['p'], { orderId: 'old' }));
assert.deepEqual(matchAmazonCharge(600, [newer, older]), only(['p', 'q'], { orderId: 'old' }));
// 注文をまたぐ組み合わせは当てない
assert.equal(matchAmazonCharge(900, [newer, older]), null);
// 同じ額の品目どうしなら、紛れない（先に並んだ方）
assert.deepEqual(matchAmazonCharge(290, [older]), only(['p'], { orderId: 'old', discount: 10 }));

// 品目が多い注文は、残りの全部だけを当てる
const many = order({ orderId: 'many', lines: Array.from({ length: 20 }, (_, i) => line(`m${i}`, 10, i)) });
assert.equal(matchAmazonCharge(10, [many]), null);
assert.equal(matchAmazonCharge(200, [many])?.lineIds.length, 20);
assert.equal(matchAmazonCharge(195, [many])?.discount, 5);

// ---- 種類の答えを読む ----
const ids = new Set(['c1', 'c2']);
assert.deepEqual(
  readCategoryPicks({ items: [{ index: 0, category_id: 'c1' }, { index: 1, category_id: 'zzz' }, { index: 5, category_id: 'c2' }] }, 3, ids),
  ['c1', null, null],
);
assert.deepEqual(readCategoryPicks(null, 2, ids), [null, null]);

console.log('amazonOrder: ok');
