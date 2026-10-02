// recurrenceExpand.ts（繰り返しの展開）の検証。
//
//   npm run test:recurrence
//
// Googleカレンダーと同じ数え方になっているかを、いくつかの例で確かめる。
// あわせて、3か所に置いたコピーが同じ中身のままかを確かめる。
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { occurrencesBetween, type RecurrenceRule } from './recurrenceExpand.ts';

const never = { type: 'never' } as const;
const rule = (r: Partial<RecurrenceRule> & Pick<RecurrenceRule, 'freq'>): RecurrenceRule => ({
  interval: 1,
  end: never,
  ...r,
});
const between = (r: RecurrenceRule, start: string, from: string, to: string) =>
  occurrencesBetween(r, start, from, to);

// --- 毎日 ---
assert.deepEqual(between(rule({ freq: 'daily' }), '2026-10-02', '2026-10-01', '2026-10-05'), [
  '2026-10-02',
  '2026-10-03',
  '2026-10-04',
  '2026-10-05',
]);
// 2日ごと。範囲の手前から数えるので、範囲の頭が回に当たらなくてもずれない。
assert.deepEqual(between(rule({ freq: 'daily', interval: 2 }), '2026-10-02', '2026-10-05', '2026-10-10'), [
  '2026-10-06',
  '2026-10-08',
  '2026-10-10',
]);
// 月をまたぐ・年をまたぐ。
assert.deepEqual(between(rule({ freq: 'daily' }), '2026-12-30', '2026-12-30', '2027-01-02'), [
  '2026-12-30',
  '2026-12-31',
  '2027-01-01',
  '2027-01-02',
]);

// --- 毎週 ---
// 開始日(金)の曜日だけ。
assert.deepEqual(
  between(rule({ freq: 'weekly', byWeekday: [5] }), '2026-10-02', '2026-10-01', '2026-10-31'),
  ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30'],
);
// 平日（月〜金）。開始日(金)の次は翌週の月曜。
assert.deepEqual(
  between(rule({ freq: 'weekly', byWeekday: [1, 2, 3, 4, 5] }), '2026-10-02', '2026-10-01', '2026-10-08'),
  ['2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'],
);
// 2週間ごとの月・水。開始日(金)を含む週(日曜始まり)は1週目だが、開始日より前の月・水は数えない。
assert.deepEqual(
  between(rule({ freq: 'weekly', interval: 2, byWeekday: [1, 3] }), '2026-10-02', '2026-10-01', '2026-11-04'),
  ['2026-10-12', '2026-10-14', '2026-10-26', '2026-10-28'],
);
// 開始日の曜日に当てはまらないルール（開始日は金曜で毎週月曜）は、最初の回が次の月曜になる。
assert.deepEqual(
  between(rule({ freq: 'weekly', byWeekday: [1] }), '2026-10-02', '2026-10-01', '2026-10-13'),
  ['2026-10-05', '2026-10-12'],
);
// 曜日が空なら開始日の曜日。
assert.deepEqual(between(rule({ freq: 'weekly' }), '2026-10-02', '2026-10-01', '2026-10-10'), [
  '2026-10-02',
  '2026-10-09',
]);

// --- 毎月 ---
// 毎月その日。31日は31日のある月だけ。
assert.deepEqual(
  between(rule({ freq: 'monthly' }), '2026-01-31', '2026-01-01', '2026-06-30'),
  ['2026-01-31', '2026-03-31', '2026-05-31'],
);
// 2か月ごと。
assert.deepEqual(
  between(rule({ freq: 'monthly', interval: 2 }), '2026-10-02', '2026-10-01', '2027-04-30'),
  ['2026-10-02', '2026-12-02', '2027-02-02', '2027-04-02'],
);
// 第1金曜日。
assert.deepEqual(
  between(rule({ freq: 'monthly', byNthWeekday: { nth: 1, weekday: 5 } }), '2026-10-02', '2026-10-01', '2027-01-31'),
  ['2026-10-02', '2026-11-06', '2026-12-04', '2027-01-01'],
);
// 最終金曜日。
assert.deepEqual(
  between(rule({ freq: 'monthly', byNthWeekday: { nth: -1, weekday: 5 } }), '2026-10-30', '2026-10-01', '2027-01-31'),
  ['2026-10-30', '2026-11-27', '2026-12-25', '2027-01-29'],
);
// 年をまたいで数える（12月 → 1月）。
assert.deepEqual(between(rule({ freq: 'monthly' }), '2026-12-15', '2026-12-01', '2027-02-28'), [
  '2026-12-15',
  '2027-01-15',
  '2027-02-15',
]);

// --- 毎年 ---
assert.deepEqual(between(rule({ freq: 'yearly' }), '2026-10-02', '2026-01-01', '2029-12-31'), [
  '2026-10-02',
  '2027-10-02',
  '2028-10-02',
  '2029-10-02',
]);
// 2月29日は閏年だけ。
assert.deepEqual(between(rule({ freq: 'yearly' }), '2024-02-29', '2024-01-01', '2033-12-31'), [
  '2024-02-29',
  '2028-02-29',
  '2032-02-29',
]);

// --- 終わり ---
// 終了日はその日を含む。
assert.deepEqual(
  between(rule({ freq: 'daily', end: { type: 'until', date: '2026-10-04' } }), '2026-10-02', '2026-10-01', '2026-12-31'),
  ['2026-10-02', '2026-10-03', '2026-10-04'],
);
// 回数は開始日以降に数えた最初のn回。範囲が後ろでも、数え始めは開始日から。
const threeTimes = rule({ freq: 'weekly', byWeekday: [5], end: { type: 'count', count: 3 } });
assert.deepEqual(between(threeTimes, '2026-10-02', '2026-10-01', '2027-12-31'), [
  '2026-10-02',
  '2026-10-09',
  '2026-10-16',
]);
assert.deepEqual(between(threeTimes, '2026-10-02', '2026-10-10', '2027-12-31'), ['2026-10-16']);
assert.deepEqual(between(threeTimes, '2026-10-02', '2026-11-01', '2027-12-31'), []);

// --- 範囲 ---
// 範囲が開始日より前なら何も出ない。
assert.deepEqual(between(rule({ freq: 'daily' }), '2026-10-02', '2026-09-01', '2026-09-30'), []);
// 何年も前に始まった毎日でも、範囲の分だけ返る。
assert.equal(between(rule({ freq: 'daily' }), '2020-01-01', '2026-10-01', '2026-10-31').length, 31);

// --- 3か所のコピーが同じ ---
const copies = ['src/lib', 'mobile/src/lib', 'supabase/functions/_shared'].map((dir) =>
  readFileSync(new URL(`../../${dir}/recurrenceExpand.ts`, import.meta.url), 'utf8'),
);
assert.equal(copies[1], copies[0], 'mobile/src/lib/recurrenceExpand.ts が src/lib と違う');
assert.equal(copies[2], copies[0], 'supabase/functions/_shared/recurrenceExpand.ts が src/lib と違う');

console.log('recurrenceExpand: OK');
