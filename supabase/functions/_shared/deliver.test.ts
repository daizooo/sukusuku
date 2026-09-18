// deliver.ts の宛先の絞り込み(preferNative)の検証。
//
//   npm run test:deliver
//
// 移行の途中は1人が宛先を複数持つ。実際に 2026-09-18 の予定のお知らせは、
// ネイティブ版を入れた1人へ3通(fcm 1 + webpush 2)出ていた。
// ここでは「同じ人ならネイティブ版だけに送る」「家族の他の人は巻き込まない」を確かめる。
import assert from 'node:assert';
import { preferNative } from './deliver.ts';

const target = (id: string, kind: string, user_id: string) => ({ id, kind, user_id });

// ---- 同じ人がネイティブ版とPWA版の両方を持つ ----
const mixed = [
  target('a', 'webpush', 'u1'),
  target('b', 'webpush', 'u1'),
  target('c', 'fcm', 'u1'),
];
assert.deepEqual(
  preferNative(mixed).map((t) => t.id),
  ['c'],
  'ネイティブ版の宛先だけが残る',
);

// ---- 家族の中で移行が済んでいない人がいる ----
// ここを家族単位でまとめると、まだPWA版のu2へお知らせが行かなくなる。
const family = [
  target('a', 'webpush', 'u1'),
  target('c', 'fcm', 'u1'),
  target('d', 'webpush', 'u2'),
];
assert.deepEqual(
  preferNative(family).map((t) => t.id),
  ['c', 'd'],
  'まだPWA版の人の宛先は残る',
);

// ---- 誰もネイティブ版を入れていない ----
const webOnly = [target('a', 'webpush', 'u1'), target('d', 'webpush', 'u2')];
assert.deepEqual(
  preferNative(webOnly).map((t) => t.id),
  ['a', 'd'],
  '絞り込む理由が無ければそのまま',
);

// ---- 同じ人がネイティブ版を2台持つ ----
const twoPhones = [
  target('c', 'fcm', 'u1'),
  target('e', 'fcm', 'u1'),
  target('a', 'webpush', 'u1'),
];
assert.deepEqual(
  preferNative(twoPhones).map((t) => t.id),
  ['c', 'e'],
  'ネイティブ版が複数あればどちらにも送る',
);

// ---- 元の配列を書き換えない ----
assert.equal(mixed.length, 3, '渡された配列はそのまま');

console.log('OK: 宛先の絞り込み（ネイティブ版を優先、人ごとに判断）');
