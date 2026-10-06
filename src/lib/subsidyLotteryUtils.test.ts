// 補助くじの決まりごと（docs/home.md §9）。
// 実行: npm run test:lottery
import assert from 'node:assert/strict';

import {
  MONTHLY_LIMIT,
  PRIZES,
  currentWeights,
  groupByMonth,
  missStreak,
  monthKey,
  oddsPercent,
  parsePrice,
  pickPrize,
  priceError,
  remainingDraws,
  subsidyFor,
  type DrawLike,
} from './subsidyLotteryUtils.ts';

// 補助の額: 玉の額が商品代を超えるときは商品代まで、金玉は全額。
assert.equal(subsidyFor('white', 2500), 0);
assert.equal(subsidyFor('blue', 2500), 1000);
assert.equal(subsidyFor('red', 2500), 2000);
assert.equal(subsidyFor('gold', 2500), 2500);
assert.equal(subsidyFor('blue', 800), 800);
assert.equal(subsidyFor('red', 1500), 1500);
assert.equal(subsidyFor('gold', 1), 1);

// 価格の読み取り。
assert.equal(parsePrice('2480'), 2480);
assert.equal(parsePrice(' ¥2,480 '), 2480);
assert.equal(parsePrice('２４８０円'), 2480);
assert.equal(parsePrice(''), null);
assert.equal(parsePrice('24.8'), null);
assert.equal(parsePrice('abc'), null);

// 対象は税込3,000円未満。
assert.equal(priceError(2999), null);
assert.equal(priceError(1), null);
assert.notEqual(priceError(3000), null);
assert.notEqual(priceError(0), null);
assert.notEqual(priceError(null), null);

// 重みの合計と確率の合計（丸めても100）。
assert.deepEqual(
  PRIZES.map((prize) => prize.weight),
  [40, 30, 20, 10],
);
for (const streak of [0, 1, 2, 5]) {
  const total = oddsPercent(streak).reduce((sum, entry) => sum + entry.percent, 0);
  assert.equal(total, 100, `streak ${streak}`);
}
assert.deepEqual(
  oddsPercent(0).map((entry) => entry.percent),
  [40, 30, 20, 10],
);

// 乱数の位置と玉の対応。
assert.equal(pickPrize(() => 0, 0).id, 'white');
assert.equal(pickPrize(() => 0.39, 0).id, 'white');
assert.equal(pickPrize(() => 0.4, 0).id, 'blue');
assert.equal(pickPrize(() => 0.69, 0).id, 'blue');
assert.equal(pickPrize(() => 0.7, 0).id, 'red');
assert.equal(pickPrize(() => 0.89, 0).id, 'red');
assert.equal(pickPrize(() => 0.9, 0).id, 'gold');
assert.equal(pickPrize(() => 0.999999, 0).id, 'gold');
// 範囲外の乱数でも落ちない。
assert.equal(pickPrize(() => 1, 0).id, 'gold');
assert.equal(pickPrize(() => -1, 0).id, 'white');

// 救済: 白玉が2回続いたら、次は白玉が出ない。
assert.equal(currentWeights(2).find((entry) => entry.prize.id === 'white')?.weight, 0);
assert.equal(currentWeights(1).find((entry) => entry.prize.id === 'white')?.weight, 40);
for (let step = 0; step < 1000; step += 1) {
  assert.notEqual(pickPrize(() => step / 1000, 2).id, 'white');
}
assert.equal(pickPrize(() => 0, 2).id, 'blue');
assert.deepEqual(
  oddsPercent(2).map((entry) => entry.percent),
  [0, 50, 33, 17],
);

// 回数と救済の数え方。
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString();
const draw = (drawnBy: string, drawnAt: string, prize: DrawLike['prize'], subsidy = 0): DrawLike => ({
  drawnBy,
  drawnAt,
  prize,
  subsidy,
});
const now = new Date(2026, 9, 6, 9); // 2026-10-06

assert.equal(monthKey(now), '2026-10');
assert.equal(remainingDraws([], 'a', now), MONTHLY_LIMIT);
assert.equal(remainingDraws([draw('a', at(2026, 10, 1), 'blue', 1000)], 'a', now), 1);
assert.equal(
  remainingDraws([draw('a', at(2026, 10, 1), 'white'), draw('a', at(2026, 10, 5), 'red', 2000)], 'a', now),
  0,
);
// 先月の分は数えない。ほかの人の分も数えない。
assert.equal(
  remainingDraws(
    [
      draw('a', at(2026, 9, 30, 23), 'gold', 900),
      draw('b', at(2026, 10, 2), 'white'),
      draw('b', at(2026, 10, 3), 'white'),
    ],
    'a',
    now,
  ),
  2,
);
// 月初の0時（端末の時間）から新しい月。
assert.equal(remainingDraws([draw('a', new Date(2026, 9, 1, 0, 0).toISOString(), 'white')], 'a', now), 1);

const history = [
  draw('a', at(2026, 8, 3), 'blue', 1000),
  draw('a', at(2026, 9, 3), 'white'),
  draw('a', at(2026, 9, 20), 'white'),
  draw('b', at(2026, 9, 21), 'red', 2000),
];
// a は直近の白玉が2回続いている（b の分は混ぜない）。
assert.equal(missStreak(history, 'a'), 2);
assert.equal(missStreak(history, 'b'), 0);
assert.equal(missStreak([...history, draw('a', at(2026, 10, 2), 'blue', 1000)], 'a'), 0);
assert.equal(missStreak([], 'a'), 0);

// 月ごとのまとめ: 新しい月から、家族のお金から出た額の合計。
const groups = groupByMonth([
  draw('a', at(2026, 9, 3), 'blue', 1000),
  draw('b', at(2026, 10, 2), 'red', 2000),
  draw('a', at(2026, 10, 5), 'gold', 1800),
]);
assert.deepEqual(
  groups.map((group) => [group.month, group.draws.length, group.subsidyTotal]),
  [
    ['2026-10', 2, 3800],
    ['2026-09', 1, 1000],
  ],
);
assert.equal(groups[0].draws[0].drawnAt, at(2026, 10, 5));

// 偏りの確認: 乱数を一様に振ったとき、出る割合が重みどおり。
const counts: Record<string, number> = { white: 0, blue: 0, red: 0, gold: 0 };
for (let step = 0; step < 10000; step += 1) counts[pickPrize(() => step / 10000, 0).id] += 1;
assert.deepEqual(counts, { white: 4000, blue: 3000, red: 2000, gold: 1000 });

console.log('subsidyLotteryUtils: ok');
