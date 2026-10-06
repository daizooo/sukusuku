// 実行: npm run test:stock-expiry
import assert from 'node:assert/strict';

import {
  addDays,
  addMonths,
  buildMessage,
  collectNotices,
  formatExpiry,
  hasNotice,
  todayJst,
  type StockLot,
} from './stockExpiry.ts';

const lot = (name: string, expires_on: string | null, extra: Partial<StockLot> = {}): StockLot => ({
  name,
  quantity: 1,
  expires_on,
  expires_month_only: false,
  ...extra,
});

// ---- 日付の計算 ----
assert.equal(addMonths('2027-06-30', -3), '2027-03-30');
assert.equal(addMonths('2027-05-31', -1), '2027-04-30', '前の月に無い日は末日にそろえる');
assert.equal(addMonths('2027-03-31', -1), '2027-02-28');
assert.equal(addMonths('2028-03-31', -1), '2028-02-29', 'うるう年');
assert.equal(addMonths('2027-02-15', -3), '2026-11-15', '年をまたぐ');
assert.equal(addDays('2026-10-01', -1), '2026-09-30');
assert.equal(addDays('2026-12-31', 1), '2027-01-01');
assert.equal(todayJst(new Date('2026-10-05T15:30:00Z').getTime()), '2026-10-06', 'UTCの夕方は日本の翌日');
assert.equal(todayJst(new Date('2026-10-06T00:00:00Z').getTime()), '2026-10-06');
assert.equal(formatExpiry(lot('a', '2031-08-25')), '2031.08.25');
assert.equal(formatExpiry(lot('a', '2027-06-30', { expires_month_only: true })), '2027.06');

// ---- 知らせる日に当たったものだけが入る ----
// 今日 2026-10-06、前回は昨日まで知らせ済み
const today = '2026-10-06';
const since = '2026-10-05';
{
  const n = collectNotices(
    [
      lot('3か月前の日', '2027-01-06'), // 3か月前 = 今日
      lot('1か月前の日', '2026-11-06'), // 1か月前 = 今日
      lot('まだ先', '2027-01-07'), // 3か月前 = 明日
      lot('もう知らせた', '2027-01-05'), // 3か月前 = 昨日（前回の窓）
      lot('期限なし', null),
      lot('期限切れ', '2026-10-05'),
      lot('数が0', '2026-11-06', { quantity: 0 }),
    ],
    since,
    today,
  );
  assert.deepEqual(n.oneMonth.map((l) => l.name), ['1か月前の日']);
  assert.deepEqual(n.threeMonths.map((l) => l.name), ['3か月前の日']);
  assert.equal(hasNotice(n), true);
}

// 月までしか無い期限は、月末日から数える（2027.06 → 2027-06-30）
{
  const n = collectNotices([lot('月だけ', '2027-06-30', { expires_month_only: true })], '2027-03-29', '2027-03-30');
  assert.deepEqual(n.threeMonths.map((l) => l.name), ['月だけ']);
}

// 窓の境界: since は含まず today は含む
assert.equal(hasNotice(collectNotices([lot('a', '2027-01-06')], '2026-10-06', '2026-10-06')), false, 'since当日は済み');
assert.equal(hasNotice(collectNotices([lot('a', '2027-01-06')], '2026-10-05', '2026-10-06')), true);

// 前回の実行が飛んだ日があっても、次の実行で拾える
{
  const n = collectNotices([lot('飛んだ日', '2027-01-04')], '2026-10-02', '2026-10-06'); // 3か月前 = 10/04
  assert.deepEqual(n.threeMonths.map((l) => l.name), ['飛んだ日']);
}

// 3か月前も1か月前も窓に入ったら、1か月前として1回だけ
{
  const n = collectNotices([lot('長く飛んだ', '2026-11-06')], '2026-07-01', '2026-10-06');
  assert.deepEqual(n.oneMonth.map((l) => l.name), ['長く飛んだ']);
  assert.equal(n.threeMonths.length, 0);
}

// 行を直した・持ち出しへ移した（同じ期限の新しい行ができた）だけでは、翌日以降に再び知らせない
{
  const n = collectNotices([lot('移した', '2027-01-06')], today, '2026-10-07');
  assert.equal(hasNotice(n), false);
}

// 期限の近い順→品名の順
{
  const n = collectNotices(
    [lot('B', '2026-11-06'), lot('A', '2026-11-06'), lot('C', '2026-11-05')],
    '2026-10-01',
    '2026-10-06',
  );
  assert.deepEqual(n.oneMonth.map((l) => l.name), ['C', 'A', 'B']);
}

// ---- 文面 ----
{
  const msg = buildMessage({
    oneMonth: [lot('水 500ml', '2026-11-06')],
    threeMonths: [
      lot('やきとり缶', '2027-01-31'),
      lot('スープ', '2027-01-31'),
      lot('えいようかん', '2027-06-30', { expires_month_only: true }),
      lot('トイレ', '2027-01-06'),
      lot('防臭袋', '2027-01-06'),
    ],
  });
  assert.equal(msg.title, '備蓄の期限が近づいています（6件）');
  assert.equal(
    msg.body,
    '1か月以内: 水 500ml（2026.11.06）\n3か月以内: やきとり缶（2027.01.31）、スープ（2027.01.31）、えいようかん（2027.06）、ほか2件',
  );
}
assert.equal(
  buildMessage({ oneMonth: [], threeMonths: [lot('a', '2027-01-06')] }).body,
  '3か月以内: a（2027.01.06）',
  '片方だけのときはその行だけ',
);

console.log('stockExpiry: all passed');
