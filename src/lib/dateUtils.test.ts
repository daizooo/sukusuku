// サーバー側の「今日」がUTCで出てしまい、日本の 0:00〜9:00 の間だけ前の日に
// なっていた不具合の再発を防ぐためのテスト。
// 実行: npm run test:date
import assert from 'node:assert/strict';

import { toDateStringInTimeZone } from './dateUtils.ts';

// 日本時間 9/15 5:00 ＝ UTC 9/14 20:00。UTC基準だと「9月14日」になってしまう場面。
const earlyMorningJst = new Date('2026-09-14T20:00:00Z');
assert.equal(toDateStringInTimeZone(earlyMorningJst), '2026-09-15');

// 日本時間 9/15 23:59 ＝ UTC 9/15 14:59。まだ15日。
assert.equal(toDateStringInTimeZone(new Date('2026-09-15T14:59:00Z')), '2026-09-15');

// 日本時間 9/16 0:00 ＝ UTC 9/15 15:00。日付が変わる。
assert.equal(toDateStringInTimeZone(new Date('2026-09-15T15:00:00Z')), '2026-09-16');

// 月・年をまたぐところ（0埋めもあわせて確認する）。
assert.equal(toDateStringInTimeZone(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
assert.equal(toDateStringInTimeZone(new Date('2026-01-31T15:00:00Z')), '2026-02-01');

// タイムゾーンを指定すればその基準になる。
assert.equal(toDateStringInTimeZone(earlyMorningJst, 'UTC'), '2026-09-14');

console.log('dateUtils: OK');
