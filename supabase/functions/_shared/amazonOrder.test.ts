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
  rate: 0,
  rateObserved: false,
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

// ---- クーポン・ポイントの値引き（按分）----
// 実物の注文: 品目の和 4,859円、合計 4,607円（差 −252円）→ 割引率 252/4859。値引きは各品目に価格の比で按分される
const rate = 252 / 4859;
const coupon = order({
  orderId: 'o1',
  rate,
  lines: [line('x', 1100, 0), line('y', 2340, 1), line('z', 1419, 2)],
});
// 全部まとめて請求されると、合計と同じ額
assert.deepEqual(matchAmazonCharge(4607, [coupon]), only(['x', 'y', 'z'], { discount: 252 }));
// 発送が分かれても、品目ごとに同じ割合で割引される（1,100円 → 1,043円、2,340円 → 2,219円、1,419円 → 1,345円）
assert.deepEqual(matchAmazonCharge(1043, [coupon]), only(['x'], { discount: 57 }));
assert.deepEqual(matchAmazonCharge(2219, [coupon]), only(['y'], { discount: 121 }));
assert.deepEqual(matchAmazonCharge(1043 + 1345, [coupon]), only(['x', 'z'], { discount: 1100 + 1419 - 2388 }));
// 按分どおりでない額で、追加の値引きとしても候補が紛れる（x+y の差 8%、y+z の差 16%）→ 当てない
assert.equal(matchAmazonCharge(3000, [coupon]), null);

// さらにポイントを使った（注文メールに出ない値引き）: 全部まとめて 4,400円 → 差の割合が小さい候補が1つなので当てる
assert.deepEqual(matchAmazonCharge(4400, [coupon]), only(['x', 'y', 'z'], { discount: 459 }));
// 割引率を確かめた注文（この注文の最初の請求から）は、按分どおりの請求だけを当てる
const observed = order({ orderId: 'o1', rate: 0.1, rateObserved: true, lines: [line('Q', 1000, 0), line('R', 2000, 1)] });
assert.deepEqual(matchAmazonCharge(900, [observed]), only(['Q'], { discount: 100 }));
assert.deepEqual(matchAmazonCharge(1800, [observed]), only(['R'], { discount: 200 }));
assert.deepEqual(matchAmazonCharge(2700, [observed]), only(['Q', 'R'], { discount: 300 }));
assert.equal(matchAmazonCharge(850, [observed]), null); // 按分どおりでない（確かめた割引率より安い）→ 当てない

// ---- 割引率がまだ分からない注文に、ポイントの値引きだけが乗ったとき ----
// 紛れる候補が無ければ当てる（B+C=550 に対して 540。ほかは差が大きすぎる）
assert.deepEqual(matchAmazonCharge(540, [abc]), only(['B', 'C'], { discount: 10 }));
// 一部の発送で、候補が紛れるとき（A500 の450円は差10%、B+C=550 の差は18%）→ 当てない
assert.equal(matchAmazonCharge(450, [abc]), null);
// 全部まとめて請求（1,050円の注文に、ポイントで50円引かれた1,000円）
assert.deepEqual(matchAmazonCharge(1000, [abc]), only(['A', 'B', 'C'], { discount: 50 }));
// 値引きが大きすぎる（2割を超える）請求は、別の請求とみなして当てない
assert.equal(matchAmazonCharge(400, [order({ orderId: 'big', lines: [line('P', 1000, 0)] })]), null);

// ---- 送料などの上乗せ（合計が品目の和より高い。按分せず、残りの全部をまとめた請求に足す）----
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
