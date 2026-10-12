// 実行: npm run test:zaim-mail
import assert from 'node:assert/strict';

import { parseZaimMail } from './zaimMail.ts';

// 2026-10-12に届いた2通の形（名前は伏せた）。本文はプレーンテキストにしたもの（表の罫線が入る）
const outSubject =
  '楽天銀行にて出金がありました（肥後銀行 某支店 普通預金 ヤマダ タロウ（依頼人名:ヤマダ ハナコ 振込予定日:2026年10月12日 管理番号:20261012-00000000））';
const outBody =
  ' Zaim\n\n| |\n| 新着の出金 10 月 12 日（月） ￥20,000 楽天銀行 肥後銀行 某支店 普通預金 ヤマダ タロウ（依頼人名:ヤマダ ハナコ 振込予定日:2026年10月12日 管理番号:20261012-00000000） |\n\n| |\n| Zaim 運営事務局です。 連携先として登録している楽天銀行にて 1 円以上の出金がありました。 |';
assert.deepEqual(parseZaimMail(outSubject, outBody, '2026-10-12T02:27:02Z'), {
  direction: 'out',
  accountName: '楽天銀行',
  occurredOn: '2026-10-12',
  amount: 20000,
  description:
    '肥後銀行 某支店 普通預金 ヤマダ タロウ（依頼人名:ヤマダ ハナコ 振込予定日:2026年10月12日 管理番号:20261012-00000000）',
});

const inSubject = '肥後銀行にて入金がありました（振込 ヤマダ ハナコ）';
const inBody = '| 新着の入金 10 月 12 日（月） ￥20,000 肥後銀行 振込 ヤマダ ハナコ |';
assert.deepEqual(parseZaimMail(inSubject, inBody, '2026-10-12T02:42:55Z'), {
  direction: 'in',
  accountName: '肥後銀行',
  occurredOn: '2026-10-12',
  amount: 20000,
  description: '振込 ヤマダ ハナコ',
});

// 年をまたぐ: 12月の明細が1月に届く
assert.equal(
  parseZaimMail('楽天銀行にて入金がありました（利息）', '新着の入金 12 月 31 日（木） ￥3 楽天銀行 利息', '2027-01-02T00:00:00Z')
    ?.occurredOn,
  '2026-12-31',
);
// 日本時間で日付を見る（UTC では前の日）
assert.equal(
  parseZaimMail('楽天銀行にて入金がありました（利息）', '新着の入金 1 月 1 日（金） ￥3 楽天銀行 利息', '2026-12-31T16:00:00Z')
    ?.occurredOn,
  '2027-01-01',
);
// 内容のかっこが無い件名
assert.equal(parseZaimMail('肥後銀行にて出金がありました', '新着の出金 10 月 1 日（木） ￥1,000 肥後銀行', '2026-10-01T03:00:00Z')?.description, '');
// 読めない: 件名と本文の向きが違う・形が違う・金額が0
assert.equal(parseZaimMail(inSubject, outBody, '2026-10-12T02:42:55Z'), null);
assert.equal(parseZaimMail('お知らせ', inBody, '2026-10-12T02:42:55Z'), null);
assert.equal(parseZaimMail(inSubject, '新着の入金 10 月 12 日（月） ￥0 肥後銀行', '2026-10-12T02:42:55Z'), null);
assert.equal(parseZaimMail(inSubject, '新着の入金 2 月 30 日（月） ￥10 肥後銀行', '2026-10-12T02:42:55Z'), null);

console.log('zaimMail: ok');
