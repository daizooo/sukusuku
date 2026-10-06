// 補助くじの決まりごと（docs/home.md §9）。
// 実行: npm run test:lottery
import assert from 'node:assert/strict';

import {
  BALLS,
  COLLECTION_SLOTS,
  FEATURE_START_MONTH,
  MONTHLY_LIMIT,
  allowanceFor,
  collectionProgress,
  daysLeft,
  groupByMonth,
  isCouponUsable,
  lotteryHelp,
  luckyBallFor,
  monthKey,
  parsePrice,
  pickCandidate,
  planDraw,
  priceError,
  remainingDraws,
  subsidyFor,
  upRate,
  type DrawLike,
} from './subsidyLotteryUtils.ts';

// 補助額: 100%は商品代そのもの。ほかは補助率×価格を100円単位（49円以下切り下げ・50円以上切り上げ）。
assert.equal(subsidyFor(100, 2480), 2480);
assert.equal(subsidyFor(100, 501), 501);
assert.equal(subsidyFor(25, 2480), 600); // 620
assert.equal(subsidyFor(50, 2480), 1200); // 1240
assert.equal(subsidyFor(75, 2480), 1900); // 1860
assert.equal(subsidyFor(25, 2600), 700); // 650 は切り上げ
assert.equal(subsidyFor(25, 2596), 600); // 649 は切り下げ
assert.equal(subsidyFor(25, 500), 100); // 125
assert.equal(subsidyFor(75, 3000), 2300); // 2250 は切り上げ
assert.equal(subsidyFor(75, 2999), 2200); // 2249.25
assert.equal(upRate(25), 50);
assert.equal(upRate(75), 100);
assert.equal(upRate(100), 100);

// 価格の読み取りと対象（税込500〜3,000円。両端を含む）。
assert.equal(parsePrice(' ¥2,480 '), 2480);
assert.equal(parsePrice('２４８０円'), 2480);
assert.equal(parsePrice('24.8'), null);
assert.equal(priceError(500), null);
assert.equal(priceError(3000), null);
assert.notEqual(priceError(499), null);
assert.notEqual(priceError(3001), null);
assert.notEqual(priceError(null), null);

// 重みは 25/50/75/100% = 40/30/20/10。
assert.deepEqual(
  BALLS.map((ball) => [ball.rate, ball.weight]),
  [[25, 40], [50, 30], [75, 20], [100, 10]],
);

const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString();
const draw = (drawnBy: string, drawnAt: string, rate: DrawLike['rate']): DrawLike => ({ drawnBy, drawnAt, rate });
const none: DrawLike[] = [];
const NOW = new Date(2027, 2, 6, 9); // 2027-03-06（くじの開始より後）
// 先月に2回引いた（75%）人。貯福も月ならしも効かない、ふつうの状態。
const NORMAL = [draw('a', at(2027, 2, 1), 75), draw('a', at(2027, 2, 2), 75)];
const plan = (overrides: Partial<Parameters<typeof planDraw>[0]> = {}) =>
  planDraw({ draws: NORMAL, userId: 'a', now: NOW, birthMonth: null, luckyBall: 'white', usePush: false, ...overrides });
const percent = (p: ReturnType<typeof planDraw>) => Object.fromEntries(p.odds.map((entry) => [entry.rate, entry.percent]));

// --- 月の回数（誕生月は+1回） ---
assert.equal(monthKey(NOW), '2027-03');
assert.equal(allowanceFor(null, NOW), MONTHLY_LIMIT);
assert.equal(allowanceFor(3, NOW), MONTHLY_LIMIT + 1);
assert.equal(allowanceFor(4, NOW), MONTHLY_LIMIT);
assert.equal(remainingDraws(none, 'a', NOW, null), 2);
assert.equal(remainingDraws(none, 'a', NOW, 3), 3);
assert.equal(remainingDraws([draw('a', at(2027, 3, 1), 50), draw('a', at(2027, 3, 2), 50)], 'a', NOW, null), 0);
assert.equal(remainingDraws([draw('a', at(2027, 3, 1), 50), draw('a', at(2027, 3, 2), 50)], 'a', NOW, 3), 1);
// 先月の分・ほかの人の分は数えない。
assert.equal(remainingDraws([draw('a', at(2027, 2, 28, 23), 50), draw('b', at(2027, 3, 2), 50)], 'a', NOW, null), 2);

// --- 何も効いていないときの確率（ラッキーカラーの白は50%になるので、白→50%に寄る） ---
{
  const p = plan({ luckyBall: 'gold' as never });
  assert.deepEqual(percent(p), { 25: 40, 50: 30, 75: 20, 100: 10 });
  assert.equal(p.floor, 25);
  assert.deepEqual(p.notes, []);
}
// ラッキーカラー: その色の玉が出たら1段上がる（候補の補助率が変わる）。
{
  const p = plan({ luckyBall: 'blue' });
  assert.deepEqual(percent(p), { 25: 40, 50: 0, 75: 50, 100: 10 });
  assert.equal(p.candidates.find((candidate) => candidate.ball.id === 'blue')?.luckyUp, true);
  assert.deepEqual(percent(plan({ luckyBall: 'red' })), { 25: 40, 50: 30, 75: 0, 100: 30 });
  assert.deepEqual(percent(plan({ luckyBall: 'white' })), { 25: 0, 50: 70, 75: 20, 100: 10 });
}

// --- ひと押し券: 25%が出ない ---
{
  const p = plan({ luckyBall: 'red', usePush: true });
  assert.equal(percent(p)[25], 0);
  assert.equal(p.floor, 50);
  assert.ok(p.notes.includes('push'));
}

// --- なだらか救済: 25%が続くほど出にくい（1連続で半分、2連続でゼロ） ---
{
  const one = plan({ luckyBall: 'red', draws: [draw('a', at(2027, 3, 1), 25)] });
  assert.equal(percent(one)[25], 25); // 白玉の重み 40→20。残りは 青30・赤→100%20・金10 で合計80（20/80=25%）
  const two = plan({ luckyBall: 'red', draws: [draw('a', at(2027, 3, 1), 25), draw('a', at(2027, 2, 20), 25)] });
  assert.equal(percent(two)[25], 0);
  // 月をまたいで数える。途中に別の補助率があれば途切れる。
  const broken = plan({ luckyBall: 'red', draws: [draw('a', at(2027, 3, 1), 50), draw('a', at(2027, 2, 20), 25)] });
  assert.equal(percent(broken)[25], 40);
  // ほかの人の履歴は混ざらない。
  assert.equal(percent(plan({ luckyBall: 'red', draws: [...NORMAL, draw('b', at(2027, 3, 1), 25)] }))[25], 40);
}

// --- 3連続ブレーカー: 同じ補助率が3連続したら、次は別の補助率 ---
{
  const three = plan({
    luckyBall: 'red',
    draws: [draw('a', at(2027, 3, 3), 50), draw('a', at(2027, 3, 2), 50), draw('a', at(2027, 3, 1), 50)],
  });
  assert.equal(percent(three)[50], 0);
  assert.ok(three.notes.includes('breaker'));
  const two = plan({
    luckyBall: 'red',
    draws: [draw('a', at(2027, 3, 3), 50), draw('a', at(2027, 3, 2), 50), draw('a', at(2027, 3, 1), 75)],
  });
  assert.equal(percent(two)[50], 30);
}

// --- 貯福: 先月に引かなかった回数で、今月の最初の1回の下限が上がる ---
{
  const lastMonthDraw = (day: number) => draw('a', at(2027, 2, day), 75);
  // 先月に1回だけ引いた（1回分残し）→ 50%以上。
  assert.equal(plan({ draws: [lastMonthDraw(1)] }).floor, 50);
  // 先月に引かなかった（2回分残し）→ 75%以上。
  assert.equal(plan({ draws: none }).floor, 75);
  // 先月に2回引いた → なし。
  assert.equal(plan({ draws: [lastMonthDraw(1), lastMonthDraw(2)] }).floor, 25);
  // 誕生月の先月（3回分）に1回も引かなかった → 100%確定。
  const birthdayLastMonth = plan({ draws: none, birthMonth: 2, luckyBall: 'blue' });
  assert.equal(birthdayLastMonth.floor, 100);
  assert.deepEqual(percent(birthdayLastMonth), { 25: 0, 50: 0, 75: 0, 100: 100 });
  // 翌月の最初の1回だけ。今月すでに引いていれば、貯福は効かない。
  assert.equal(plan({ draws: [draw('a', at(2027, 3, 1), 75)] }).floor, 25);
  // くじの開始より前の月には権利が付かない。
  const early = planDraw({ draws: none, userId: 'a', now: new Date(2026, 9, 6), birthMonth: null, luckyBall: 'white', usePush: false });
  assert.equal(FEATURE_START_MONTH, '2026-10');
  assert.equal(early.floor, 25);
}

// --- 月ならし: 先月に引いた2回以上がすべて50%以下なら、今月の最初の1回は75%以上 ---
{
  const low = [draw('a', at(2027, 2, 1), 25), draw('a', at(2027, 2, 2), 50)];
  const smoothing = plan({ draws: low });
  assert.equal(smoothing.floor, 75);
  assert.ok(smoothing.notes.includes('smoothing'));
  // 1回でも75%以上なら、月ならしは効かない（先月2回引いたので貯福もなし）。
  assert.equal(plan({ draws: [draw('a', at(2027, 2, 1), 25), draw('a', at(2027, 2, 2), 75)] }).floor, 25);
  // 先月に1回しか引かなかった場合は月ならしの対象外（貯福の50%以上だけ）。
  assert.equal(plan({ draws: [draw('a', at(2027, 2, 1), 25)] }).floor, 50);
}

// --- 下限が重なったら、一番高いものだけ ---
{
  const both = plan({ draws: [draw('a', at(2027, 2, 1), 25)], usePush: true }); // 貯福50 + ひと押し50
  assert.equal(both.floor, 50);
  const noDraws = plan({ draws: none, usePush: true }); // 貯福75 + ひと押し50
  assert.equal(noDraws.floor, 75);
}

// --- 候補が無くなるときは、ブレーカー→なだらか救済の順にゆるめる ---
{
  const hundreds = plan({
    luckyBall: 'white',
    birthMonth: 2,
    draws: [draw('a', at(2027, 3, 1), 100), draw('a', at(2027, 2, 3), 100), draw('a', at(2027, 2, 2), 100)],
  });
  // 3連続の100%でも、貯福の100%確定（誕生月の先月に引いた回数は2回=1回分残し→50%以上）…候補は残る。
  assert.ok(hundreds.candidates.length > 0);
}

// --- 乱数の位置と玉の対応 ---
{
  const p = plan({ luckyBall: 'gold' as never });
  assert.equal(pickCandidate(p, () => 0).ball.id, 'white');
  assert.equal(pickCandidate(p, () => 0.39).ball.id, 'white');
  assert.equal(pickCandidate(p, () => 0.4).ball.id, 'blue');
  assert.equal(pickCandidate(p, () => 0.7).ball.id, 'red');
  assert.equal(pickCandidate(p, () => 0.9).ball.id, 'gold');
  assert.equal(pickCandidate(p, () => 1).ball.id, 'gold');
  assert.equal(pickCandidate(p, () => -1).ball.id, 'white');
}

// --- ラッキーカラーは、同じ月・同じ家族なら同じ。金玉にはならない ---
{
  assert.equal(luckyBallFor('fam:2027-03'), luckyBallFor('fam:2027-03'));
  const seen = new Set<string>();
  for (let month = 1; month <= 120; month += 1) seen.add(luckyBallFor(`fam:${2000 + Math.floor(month / 12)}-${month % 12}`));
  assert.deepEqual([...seen].sort(), ['blue', 'red', 'white']);
}

// --- 券 ---
{
  const coupon = (overrides: Partial<Parameters<typeof collectionProgress>[0][number]> = {}) => ({
    id: 'c',
    ownerId: 'a',
    kind: 'snack' as const,
    cycle: 1,
    slot: 1,
    obtainedAt: at(2027, 3, 1),
    expiresAt: at(2027, 4, 1),
    usedAt: null,
    isTest: false,
    ...overrides,
  });
  assert.equal(isCouponUsable(coupon(), NOW), true);
  assert.equal(isCouponUsable(coupon({ usedAt: at(2027, 3, 2) }), NOW), false);
  assert.equal(isCouponUsable(coupon({ expiresAt: at(2027, 3, 5) }), NOW), false);
  assert.equal(isCouponUsable(coupon({ kind: 'push', cycle: null, slot: null, expiresAt: null }), NOW), true);
  assert.equal(daysLeft(coupon({ kind: 'trip', expiresAt: null }), NOW), null);
  assert.equal(daysLeft(coupon({ expiresAt: at(2027, 3, 16, 9) }), NOW), 10);
  // 図鑑: 使った券も数える。日帰り旅行券が出たら次の周。
  const progress = collectionProgress([coupon({ slot: 1, usedAt: at(2027, 3, 2) }), coupon({ slot: 2 }), coupon({ kind: 'push', cycle: null, slot: null, expiresAt: null })]);
  assert.deepEqual(progress, { cycle: 1, collected: [1, 2] });
  const next = collectionProgress([coupon({ slot: 1 }), coupon({ kind: 'trip', slot: null, expiresAt: null }), coupon({ cycle: 2, slot: 4, kind: 'picnic' })]);
  assert.deepEqual(next, { cycle: 2, collected: [4] });
  assert.deepEqual(COLLECTION_SLOTS.map((entry) => entry.kind), ['snack', 'movie', 'cafe', 'picnic', 'rate_up', 'rate_up']);
}

// --- 履歴: 新しい月から、月の中は新しい順 ---
{
  const groups = groupByMonth([draw('a', at(2027, 2, 3), 25), draw('a', at(2027, 3, 2), 50), draw('a', at(2027, 3, 5), 75)]);
  assert.deepEqual(groups.map((group) => [group.month, group.draws.length]), [['2027-03', 2], ['2027-02', 1]]);
  assert.equal(groups[0].draws[0].drawnAt, at(2027, 3, 5));
}

// --- くじ画面の「？」: 数字は決まりごとの定数から作る ---
{
  const text = lotteryHelp().flatMap((section) => [section.heading, ...section.lines]).join('\n');
  assert.ok(text.includes('税込500〜3,000円'));
  assert.ok(text.includes('月2回まで（誕生月は3回）'));
  assert.ok(text.includes('まんがく賞'));
  assert.ok(lotteryHelp().every((section) => section.lines.length > 0));
}

// --- 年間の100%が、1人あたり5〜6回になる（確率の重みは変えず、救済で調整する） ---
{
  // 小さな乱数（再現できるように）。
  let seed = 20270306;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const players = 30000;
  let hundred = 0;
  let total = 0;
  let rateSum = 0;
  for (let player = 0; player < players; player += 1) {
    const draws: DrawLike[] = [];
    let tickets = 0;
    // 1か月目は貯福・月ならしの前提（先月の記録）が無いので、13か月回して2か月目からの12か月を数える。
    for (let month = 1; month <= 13; month += 1) {
      const now = new Date(2027, month - 1, 5, 12);
      const luckyBall = luckyBallFor(`${player}:${monthKey(now)}`);
      for (let time = 0; time < 2; time += 1) {
        const drawAt = new Date(2027, month - 1, time === 0 ? 5 : 20, 12);
        const usePush = tickets > 0;
        const p = planDraw({ draws, userId: 'a', now: drawAt, birthMonth: null, luckyBall, usePush });
        const result = pickCandidate(p, random);
        if (usePush) tickets -= 1;
        draws.push({ drawnBy: 'a', drawnAt: drawAt.toISOString(), rate: result.rate });
        if (result.rate === 25) tickets += 1;
        if (month === 1) continue;
        total += 1;
        rateSum += result.rate;
        if (result.rate === 100) hundred += 1;
      }
    }
  }
  const perYear = hundred / players;
  const average = rateSum / total;
  console.log(`1人あたり年間の100%: ${perYear.toFixed(2)}回 / 平均の補助率: ${average.toFixed(1)}%`);
  assert.ok(perYear >= 5.0 && perYear <= 6.2, `100%は年5〜6回のはず: ${perYear}`);
  assert.ok(average >= 60 && average <= 70, `平均の補助率: ${average}`);
}

console.log('subsidyLotteryUtils: ok');
