// 年の振り返りの「推移」グラフの計算（docs/kakei.md §4.8）。PWA版の `src/lib/yearTrend.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 棒＝月ごとの収支、折れ線＝年初からの累計。数え方は年末の着地見込み（buildYearLanding。§4.6）と同じで、
// 締めた月は実額、締めていない月と先の月は見込み。見込みの月は点線・薄い棒にして、年末まで伸ばす。
import type { LandingMonth } from '@/lib/moneyUtils';

export interface YearTrendPoint {
  monthKey: string;
  /** 1〜12。 */
  month: number;
  /** 締めた月（実額）。false は見込み。 */
  closed: boolean;
  balance: number;
  cumulative: number;
}

export interface TrendAxis {
  min: number;
  max: number;
  step: number;
}

export interface YearTrendAxes {
  /** 棒（月の収支）の軸。 */
  balance: TrendAxis;
  /** 折れ線（累計）の軸。0 の高さは balance と同じ。 */
  cumulative: TrendAxis;
  /** 目盛りの間の数（目盛りは n + 1 本）。 */
  intervals: number;
}

/**
 * 着地見込みの月のうち、数える月（使い始めた月から12月）だけをグラフの点にする。
 * 今月（締める前）と締め忘れた過去の月は、月の振り返りの収支と合わせて収支・累計とも実績で出す（2026-10-24。先の月は着地見込みのまま）。
 */
export function yearTrendPoints(months: readonly LandingMonth[]): YearTrendPoint[] {
  return months
    .filter((row) => row.counted)
    .map((row) => ({
      monthKey: row.monthKey,
      month: Number(row.monthKey.slice(5, 7)),
      closed: row.closed,
      balance: row.actualBalance ?? row.balance,
      cumulative: row.actualCumulative ?? row.cumulative,
    }));
}

/** 見やすい目盛りの間隔（1・2・2.5・5 × 10のべき乗）のうち、target 以上で最小のもの。 */
function niceStep(target: number): number {
  const base = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 2.5, 5, 10].map((unit) => unit * base).find((step) => step >= target) ?? base * 10;
}

/** 目盛りの数字（万円の数だけ。「万」は付けない。2026-10-18）。例: 300000 → 「30」、−200000 → 「−20」。 */
export function formatTrendAxis(value: number): string {
  if (value === 0) return '0';
  return `${value < 0 ? '−' : ''}${(Math.abs(value) / 10_000).toLocaleString('ja-JP')}`;
}

/** 目盛りの間隔のはじめ（10万円）。0 より上・下の目盛りがこれより多くなるときは、間隔を広げる。 */
const TICK_YEN = 100_000;
const MAX_HALF_TICKS = 6;

/**
 * 棒（左軸）と折れ線（右軸）の軸。0 をいつも真ん中に置き、上下の幅をそろえる（2026-10-18。プラス・マイナスの大きさで 0 の高さが動かない）。
 * 目盛りは10万円ごと（0 より上・下に6本を超えるときは、間隔を広げる）。左右とも同じ目盛りにする。
 * 上端は、棒と累計の絶対値のいちばん大きい値を目盛りの間隔で切り上げたもの（下端はそのマイナス）。
 */
export function yearTrendAxes(points: readonly YearTrendPoint[]): YearTrendAxes {
  const largest = Math.max(1, ...points.flatMap((point) => [Math.abs(point.balance), Math.abs(point.cumulative)]));
  const step = largest / TICK_YEN <= MAX_HALF_TICKS ? TICK_YEN : niceStep(largest / MAX_HALF_TICKS);
  const half = Math.max(1, Math.ceil(largest / step));
  const axis = { min: -half * step, max: half * step, step };
  return { balance: axis, cumulative: { ...axis }, intervals: half * 2 };
}

export interface TrendBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type BubbleSide = 'above' | 'below' | 'left' | 'right';

/**
 * 月を押したときの吹き出しを置く側。その月の棒と点（mark）の上・下・左・右のうち、
 * グラフの中に収まり、ほかの月の折れ線・棒をいちばん隠さない側を選ぶ（上に余白を取らず、折れ線が上がっても下がっても点を隠さない）。
 * 同じなら 上 → 下 → 左 → 右。obstacles は避けたい線上の点と棒の箱。
 */
export function pickBubble(options: {
  mark: TrendBox;
  bubble: { width: number; height: number };
  bounds: TrendBox;
  gap: number;
  line: readonly (readonly [number, number])[];
  bars: readonly TrendBox[];
  ownBar: number;
}): { side: BubbleSide; x: number; y: number } {
  const { mark, bubble, bounds, gap, line, bars, ownBar } = options;
  const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
  const left = bounds.x;
  const right = bounds.x + bounds.width;
  const top = bounds.y;
  const bottom = bounds.y + bounds.height;
  const centerX = mark.x + mark.width / 2;
  const centerY = mark.y + mark.height / 2;
  const candidates: { side: BubbleSide; x: number; y: number; fits: boolean }[] = [
    { side: 'above', x: clamp(centerX - bubble.width / 2, left, right - bubble.width), y: mark.y - gap - bubble.height, fits: mark.y - gap - bubble.height >= top },
    { side: 'below', x: clamp(centerX - bubble.width / 2, left, right - bubble.width), y: mark.y + mark.height + gap, fits: mark.y + mark.height + gap + bubble.height <= bottom },
    { side: 'left', x: mark.x - gap - bubble.width, y: clamp(centerY - bubble.height / 2, top, bottom - bubble.height), fits: mark.x - gap - bubble.width >= left },
    { side: 'right', x: mark.x + mark.width + gap, y: clamp(centerY - bubble.height / 2, top, bottom - bubble.height), fits: mark.x + mark.width + gap + bubble.width <= right },
  ];
  const hidden = (x: number, y: number): number => {
    let cost = 0;
    for (const [px, py] of line) {
      if (px > x - 3 && px < x + bubble.width + 3 && py > y - 3 && py < y + bubble.height + 3) cost += 1;
    }
    bars.forEach((bar, index) => {
      if (index === ownBar) return;
      const overlapX = Math.min(x + bubble.width, bar.x + bar.width) - Math.max(x, bar.x);
      const overlapY = Math.min(y + bubble.height, bar.y + bar.height) - Math.max(y, bar.y);
      if (overlapX > 0 && overlapY > 0) cost += (overlapX * overlapY) / 60;
    });
    return cost;
  };
  let best: { side: BubbleSide; x: number; y: number; cost: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate.fits) continue;
    const cost = hidden(candidate.x, candidate.y);
    if (best === null || cost < best.cost - 0.01) best = { side: candidate.side, x: candidate.x, y: candidate.y, cost };
  }
  // どこにも収まらないとき（グラフが極端に小さい）は、上の候補をグラフの中に寄せる。
  return best ?? { side: 'above', x: candidates[0].x, y: clamp(candidates[0].y, top, bottom - bubble.height) };
}
