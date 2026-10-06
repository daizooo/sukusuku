// 補助くじ（暮らしタブ。docs/home.md §9）の決まりごと。
// PWA版の `src/lib/subsidyLotteryUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 家のルール: 趣味以外で必要なものを税込3,000円未満で買うとき、1人あたり月2回まで、
// 家族のお金から補助を出す。補助の額はくじで決める（0円・1,000円・2,000円・全額）。
//
// 福引のガラポン抽選機をイメージして、玉の色を賞にしている。
//   白玉＝ティッシュ賞（0円）／青玉＝ちょい助け賞（1,000円）／赤玉＝大助かり賞（2,000円）／金玉＝福の神賞（全額）
// 玉の額が商品代を超えるときは商品代まで（800円のものに青玉が出たら800円＝全額）。
//
// 救済: 白玉が続いて PITY_STREAK 回になると、次は白玉を抜いて引く（外れ続きで嫌にならないように）。

import type { SubsidyPrizeId } from '@/types/app';

/** 対象は税込でこの金額「未満」の商品。 */
export const PRICE_LIMIT = 3000;

/** 1人あたり、1か月に引ける回数。DBのトリガー（0059_subsidy_draws.sql）と合わせる。 */
export const MONTHLY_LIMIT = 2;

/** 白玉（外れ）がこの回数続いたら、次は白玉を抜く。 */
export const PITY_STREAK = 2;

export interface Prize {
  id: SubsidyPrizeId;
  /** 玉の呼び名。 */
  ball: string;
  /** 賞の名前。 */
  name: string;
  /** 補助の額（円）。null は全額。 */
  amount: number | null;
  /** 当たりやすさの重み。 */
  weight: number;
  /** 出たときの一言。 */
  message: string;
}

export const PRIZES: Prize[] = [
  { id: 'white', ball: '白玉', name: 'ティッシュ賞', amount: 0, weight: 40, message: '今回は自腹。お小遣いの底力を見せるとき！' },
  { id: 'blue', ball: '青玉', name: 'ちょい助け賞', amount: 1000, weight: 30, message: 'ちょっと助かった。家族のお金がそっと支えます' },
  { id: 'red', ball: '赤玉', name: '大助かり賞', amount: 2000, weight: 20, message: '大当たり！ かなり助かりました' },
  { id: 'gold', ball: '金玉', name: '福の神賞', amount: null, weight: 10, message: '金玉！ 福の神が全額払ってくれます' },
];

export const prizeOf = (id: SubsidyPrizeId): Prize => PRIZES.find((prize) => prize.id === id) ?? PRIZES[0];

/** 玉が出たときに、家族のお金から出る額（円）。玉の額が商品代を超えるときは商品代まで。 */
export const subsidyFor = (id: SubsidyPrizeId, price: number): number => {
  const amount = prizeOf(id).amount;
  return amount === null ? price : Math.min(amount, price);
};

/** 入力の文字から税込価格を読む。「¥2,480」「2480円」「２４８０」を受ける。読めなければ null。 */
export const parsePrice = (text: string): number | null => {
  const digits = text.normalize('NFKC').replace(/[¥￥,\s円]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
};

/** 価格が対象でなければ、その理由。対象なら null。 */
export const priceError = (price: number | null): string | null => {
  if (price === null || price < 1) return '税込の価格を入れてください';
  if (price >= PRICE_LIMIT) return `対象は税込${PRICE_LIMIT.toLocaleString('ja-JP')}円未満です`;
  return null;
};

/** 引いた記録のうち、回数・救済・集計に使う部分。 */
export interface DrawLike {
  drawnBy: string | null;
  drawnAt: string;
  prize: SubsidyPrizeId;
  subsidy: number;
}

/** 日付を 'YYYY-MM'（端末の時間）にする。月2回の数え方の単位。 */
export const monthKey = (value: string | Date): string => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/** now の月に、その人が引いた回数。 */
export const usedDraws = (draws: DrawLike[], userId: string, now: Date): number => {
  const month = monthKey(now);
  return draws.filter((draw) => draw.drawnBy === userId && monthKey(draw.drawnAt) === month).length;
};

/** now の月に、その人があと何回引けるか。 */
export const remainingDraws = (draws: DrawLike[], userId: string, now: Date): number =>
  Math.max(0, MONTHLY_LIMIT - usedDraws(draws, userId, now));

/** その人が、直近で白玉を何回続けて引いているか（月をまたいで数える）。 */
export const missStreak = (draws: DrawLike[], userId: string): number => {
  const mine = draws
    .filter((draw) => draw.drawnBy === userId)
    .sort((a, b) => b.drawnAt.localeCompare(a.drawnAt));
  let streak = 0;
  for (const draw of mine) {
    if (draw.prize !== 'white') break;
    streak += 1;
  }
  return streak;
};

/** 白玉が続いているとき、白玉を抜くか。 */
export const isPity = (streak: number): boolean => streak >= PITY_STREAK;

/** いま引いたときの玉ごとの重み。救済のときは白玉が0になる。 */
export const currentWeights = (streak: number): { prize: Prize; weight: number }[] =>
  PRIZES.map((prize) => ({ prize, weight: prize.id === 'white' && isPity(streak) ? 0 : prize.weight }));

/** いま引いたときの玉ごとの確率（％、整数。合計は100に合わせる）。 */
export const oddsPercent = (streak: number): { prize: Prize; percent: number }[] => {
  const weights = currentWeights(streak);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  const raw = weights.map((entry) => ({ prize: entry.prize, percent: Math.round((entry.weight / total) * 100) }));
  // 丸めで合計が100からずれたぶんは、一番確率の高い玉で合わせる。
  const gap = 100 - raw.reduce((sum, entry) => sum + entry.percent, 0);
  if (gap !== 0) {
    const top = raw.reduce((best, entry) => (entry.percent > best.percent ? entry : best), raw[0]);
    top.percent += gap;
  }
  return raw;
};

/** 玉を1つ引く。random は 0 以上 1 未満の乱数（テストで差し替える）。 */
export const pickPrize = (random: () => number, streak: number): Prize => {
  const weights = currentWeights(streak).filter((entry) => entry.weight > 0);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let point = Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * total;
  for (const entry of weights) {
    if (point < entry.weight) return entry.prize;
    point -= entry.weight;
  }
  return weights[weights.length - 1].prize;
};

export interface MonthGroup<T extends DrawLike> {
  month: string;
  draws: T[];
  /** 家族のお金から出た額の合計（円）。 */
  subsidyTotal: number;
}

/** 新しい月から順に、月ごとにまとめる（月の中は新しい順）。 */
export const groupByMonth = <T extends DrawLike>(draws: T[]): MonthGroup<T>[] => {
  const sorted = [...draws].sort((a, b) => b.drawnAt.localeCompare(a.drawnAt));
  const groups: MonthGroup<T>[] = [];
  for (const draw of sorted) {
    const month = monthKey(draw.drawnAt);
    const last = groups[groups.length - 1];
    if (last && last.month === month) {
      last.draws.push(draw);
      last.subsidyTotal += draw.subsidy;
    } else {
      groups.push({ month, draws: [draw], subsidyTotal: draw.subsidy });
    }
  }
  return groups;
};

/** 'YYYY-MM' を「10月」（今年以外は「2025年12月」）にする。 */
export const formatMonth = (month: string, now: Date): string => {
  const [year, mon] = month.split('-').map(Number);
  return year === now.getFullYear() ? `${mon}月` : `${year}年${mon}月`;
};
