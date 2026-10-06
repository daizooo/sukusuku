// 補助くじ（暮らしタブ。docs/home.md §9）の決まりごと。
// mobile版の `mobile/src/lib/subsidyLotteryUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 家のルール: 趣味以外で必要なものを税込500〜3,000円で買うとき、1人あたり月2回（誕生月は3回）まで、
// 家族のお金から補助を出す。補助率はくじ（ガラポン）で決める。はずれはなし。
//
// 玉: 白玉25%（40）／青玉50%（30）／赤玉75%（20）／金玉100%（10）。かっこは出やすさの重み。
// 補助額は、100%は商品代そのもの。それ以外は補助率をかけて100円単位（49円以下は切り下げ、50円以上は切り上げ）。
//
// 救済（どれも自動。確率の重みは変えず、引く前に玉の候補を絞る・補助率を上げることで調整する）
//   - なだらか救済: 25%が続くほど25%が出にくくなる（1連続で半分、2連続でゼロ）
//   - 3連続ブレーカー: 同じ補助率が3連続したら、次は別の補助率
//   - ラッキーカラー: 毎月1色（白・青・赤）が決まり、その色の玉が出たら補助率が1段上がる
//   - ひと押し券: 25%が出るたびに1枚（期限なし）。引く前に使うと、そのガラポンで25%が出なくなる（50%以上）
//   - 貯福: 先月に引かなかった回数があれば、今月の最初の1回の下限が上がる（1回分で50%以上、
//     2回分で75%以上、3回分で100%確定）
//   - 月ならし: 先月に引いた2回以上がすべて50%以下なら、今月の最初の1回は75%以上
// 下限（貯福・月ならし・ひと押し券）が重なったときは、一番高いものだけを使う。

import type { SubsidyBallId, SubsidyRate, LotteryCoupon, LotteryCouponKind } from '@/types/app';

/** 対象は税込でこの金額以上・以下の商品。 */
export const PRICE_MIN = 500;
export const PRICE_MAX = 3000;

/** 1人あたり、1か月に引ける回数（誕生月は+1回）。DBのトリガー（0059_subsidy_draws.sql）と合わせる。 */
export const MONTHLY_LIMIT = 2;

/** 貯福・月ならしは、この月より前には数えない（くじを始める前の月に権利が付かないように）。 */
export const FEATURE_START_MONTH = '2026-10';

export const RATES: SubsidyRate[] = [25, 50, 75, 100];

export interface Ball {
  id: SubsidyBallId;
  /** 玉の呼び名。 */
  ball: string;
  /** 賞の名前。 */
  name: string;
  /** 玉の補助率（％）。 */
  rate: SubsidyRate;
  /** 当たりやすさの重み。 */
  weight: number;
  /** 出たときの一言。 */
  message: string;
}

export const BALLS: Ball[] = [
  { id: 'white', ball: '白玉', name: 'ちょこっと賞', rate: 25, weight: 40, message: 'ちょこっと助かります。次はきっといいことが' },
  { id: 'blue', ball: '青玉', name: 'はんぶん賞', rate: 50, weight: 30, message: '半分は家族のお金から。ありがたい' },
  { id: 'red', ball: '赤玉', name: 'たっぷり賞', rate: 75, weight: 20, message: '大当たり！ ほとんど家族のお金です' },
  { id: 'gold', ball: '金玉', name: 'まんがく賞', rate: 100, weight: 10, message: '金玉！ 福の神が満額払ってくれます' },
];

export const ballOf = (id: SubsidyBallId): Ball => BALLS.find((ball) => ball.id === id) ?? BALLS[0];

/** 補助率を1段上げる（100%の上は無い）。 */
export const upRate = (rate: SubsidyRate): SubsidyRate => (rate >= 100 ? 100 : ((rate + 25) as SubsidyRate));

/**
 * 家族のお金から出る額（円）。100%は商品代そのもの（計算しない）。
 * それ以外は補助率をかけて100円単位（49円以下は切り下げ、50円以上は切り上げ）。
 * DBのcheck制約（0059_subsidy_draws.sql）と同じ式。
 */
export const subsidyFor = (rate: SubsidyRate, price: number): number =>
  rate === 100 ? price : Math.floor((price * rate + 5000) / 10000) * 100;

/** 入力の文字から税込価格を読む。「¥2,480」「2480円」「２４８０」を受ける。読めなければ null。 */
export const parsePrice = (text: string): number | null => {
  const digits = text.normalize('NFKC').replace(/[¥￥,\s円]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
};

/** 価格が対象でなければ、その理由。対象なら null。 */
export const priceError = (price: number | null): string | null => {
  if (price === null) return '税込の価格を入れてください';
  if (price < PRICE_MIN || price > PRICE_MAX) {
    return `対象は税込${PRICE_MIN.toLocaleString('ja-JP')}〜${PRICE_MAX.toLocaleString('ja-JP')}円です`;
  }
  return null;
};

/** 引いた記録のうち、回数・救済・集計に使う部分。 */
export interface DrawLike {
  drawnBy: string | null;
  drawnAt: string;
  rate: SubsidyRate;
}

/** 日付を 'YYYY-MM'（端末の時間）にする。月の回数の数え方の単位。 */
export const monthKey = (value: string | Date): string => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
};

/** 1か月前の日（その月の1日）。 */
const previousMonth = (now: Date): Date => new Date(now.getFullYear(), now.getMonth() - 1, 1);

/** その月に引ける回数。誕生月は+1回。birthMonth は 1〜12、分からなければ null。 */
export const allowanceFor = (birthMonth: number | null, month: Date): number =>
  MONTHLY_LIMIT + (birthMonth !== null && birthMonth === month.getMonth() + 1 ? 1 : 0);

const mine = (draws: DrawLike[], userId: string) => draws.filter((draw) => draw.drawnBy === userId);

/** now の月に、その人が引いた回数。 */
export const usedDraws = (draws: DrawLike[], userId: string, now: Date): number => {
  const month = monthKey(now);
  return mine(draws, userId).filter((draw) => monthKey(draw.drawnAt) === month).length;
};

/** now の月に、その人があと何回引けるか。 */
export const remainingDraws = (draws: DrawLike[], userId: string, now: Date, birthMonth: number | null): number =>
  Math.max(0, allowanceFor(birthMonth, now) - usedDraws(draws, userId, now));

/** 文字から決まる整数（FNV-1a）。毎月のラッキーカラーを、保存せずに決めるのに使う。 */
const hash = (text: string): number => {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value >>> 0;
};

/** ラッキーカラーになる玉。金玉は上がらないので、白・青・赤から。 */
const LUCKY_CANDIDATES: SubsidyBallId[] = ['white', 'blue', 'red'];

/** 今月のラッキーカラー。seed は「家族のid:YYYY-MM」など、月ごとに変わる文字。 */
export const luckyBallFor = (seed: string): SubsidyBallId => LUCKY_CANDIDATES[hash(seed) % LUCKY_CANDIDATES.length];

/** 救済のうち、いま効いているもの（画面に出す）。 */
export type PlanNote = 'savings' | 'smoothing' | 'push' | 'pity' | 'breaker';

export interface Candidate {
  ball: Ball;
  /** この玉が出たときの補助率（ラッキーカラーなら1段上がる）。 */
  rate: SubsidyRate;
  luckyUp: boolean;
  weight: number;
}

export interface DrawPlan {
  luckyBall: SubsidyBallId;
  candidates: Candidate[];
  /** 今回の補助率の下限（なければ25）。 */
  floor: SubsidyRate;
  notes: PlanNote[];
  /** 今回の補助率ごとの確率（％、整数。合計は100）。 */
  odds: { rate: SubsidyRate; percent: number }[];
}

export interface PlanInput {
  draws: DrawLike[];
  userId: string;
  now: Date;
  /** 誕生月（1〜12）。分からなければ null。 */
  birthMonth: number | null;
  luckyBall: SubsidyBallId;
  /** ひと押し券を使うか。 */
  usePush: boolean;
}

const maxRate = (a: SubsidyRate, b: SubsidyRate): SubsidyRate => (a >= b ? a : b);

/** 先月に引かなかった回数から、今月の最初の1回の下限（貯福）。 */
const savingsFloor = (unused: number): SubsidyRate => (unused >= 3 ? 100 : unused === 2 ? 75 : unused === 1 ? 50 : 25);

/**
 * いま引いたときの玉の候補と、効いている救済を決める。
 * 玉ごとの「出たときの補助率」で、下限・ブレーカー・なだらか救済をかけ、候補が無くなるときは
 * ブレーカー→なだらか救済の順にゆるめる。
 */
export const planDraw = ({ draws, userId, now, birthMonth, luckyBall, usePush }: PlanInput): DrawPlan => {
  const own = mine(draws, userId).sort((a, b) => b.drawnAt.localeCompare(a.drawnAt));
  const thisMonth = monthKey(now);
  const isFirstOfMonth = own.every((draw) => monthKey(draw.drawnAt) !== thisMonth);

  // 下限（貯福・月ならし・ひと押し券）。重なったら一番高いものだけ。
  let floor: SubsidyRate = 25;
  const notes: PlanNote[] = [];
  if (isFirstOfMonth) {
    const prev = previousMonth(now);
    const prevKey = monthKey(prev);
    const prevDraws = own.filter((draw) => monthKey(draw.drawnAt) === prevKey);
    if (prevKey >= FEATURE_START_MONTH) {
      const unused = Math.max(0, allowanceFor(birthMonth, prev) - prevDraws.length);
      const savings = savingsFloor(unused);
      if (savings > 25) {
        floor = maxRate(floor, savings);
        notes.push('savings');
      }
    }
    if (prevDraws.length >= 2 && prevDraws.every((draw) => draw.rate <= 50)) {
      floor = maxRate(floor, 75);
      notes.push('smoothing');
    }
  }
  if (usePush) {
    floor = maxRate(floor, 50);
    notes.push('push');
  }

  // 25%の連続（なだらか救済）と、同じ補助率の3連続（ブレーカー）。
  let streak25 = 0;
  for (const draw of own) {
    if (draw.rate !== 25) break;
    streak25 += 1;
  }
  const lastThree = own.slice(0, 3);
  const breakerRate: SubsidyRate | null =
    lastThree.length === 3 && lastThree.every((draw) => draw.rate === lastThree[0].rate) ? lastThree[0].rate : null;

  const build = (useBreaker: boolean, usePity: boolean): Candidate[] =>
    BALLS.map((ball) => {
      const luckyUp = ball.id === luckyBall;
      const rate = luckyUp ? upRate(ball.rate) : ball.rate;
      let weight = ball.weight;
      if (rate < floor) weight = 0;
      if (useBreaker && breakerRate !== null && rate === breakerRate) weight = 0;
      if (usePity && rate === 25) weight *= streak25 === 0 ? 1 : streak25 === 1 ? 0.5 : 0;
      return { ball, rate, luckyUp: luckyUp && rate !== ball.rate, weight };
    }).filter((candidate) => candidate.weight > 0);

  let useBreaker = true;
  let usePity = true;
  let candidates = build(useBreaker, usePity);
  if (candidates.length === 0) {
    useBreaker = false;
    candidates = build(useBreaker, usePity);
  }
  if (candidates.length === 0) {
    usePity = false;
    candidates = build(useBreaker, usePity);
  }
  if (usePity && streak25 > 0) notes.push('pity');
  if (useBreaker && breakerRate !== null) notes.push('breaker');

  const total = candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  const odds = RATES.map((rate) => ({
    rate,
    percent: Math.round(
      (candidates.filter((candidate) => candidate.rate === rate).reduce((sum, candidate) => sum + candidate.weight, 0) / total) * 100,
    ),
  }));
  // 丸めで合計が100からずれたぶんは、一番確率の高い補助率で合わせる。
  const gap = 100 - odds.reduce((sum, entry) => sum + entry.percent, 0);
  if (gap !== 0) {
    const top = odds.reduce((best, entry) => (entry.percent > best.percent ? entry : best), odds[0]);
    top.percent += gap;
  }
  return { luckyBall, candidates, floor, notes, odds };
};

/** 玉を1つ引く。random は 0 以上 1 未満の乱数（テストで差し替える）。 */
export const pickCandidate = (plan: DrawPlan, random: () => number): Candidate => {
  const total = plan.candidates.reduce((sum, candidate) => sum + candidate.weight, 0);
  let point = Math.min(Math.max(random(), 0), 1 - Number.EPSILON) * total;
  for (const candidate of plan.candidates) {
    if (point < candidate.weight) return candidate;
    point -= candidate.weight;
  }
  return plan.candidates[plan.candidates.length - 1];
};

// ---------------------------------------------------------------------------
// 券
// ---------------------------------------------------------------------------

export interface CouponInfo {
  name: string;
  description: string;
}

export const COUPON_INFO: Record<LotteryCouponKind, CouponInfo> = {
  push: { name: 'ひと押し券', description: '引く前に使うと、そのガラポンで25%が出なくなります（50%以上）' },
  rate_up: {
    name: '補助率アップ券',
    description: '25%か50%の結果を1段上げます（75%・100%には使えません）。くじの結果の画面で使います。期限なし',
  },
  snack: { name: '休日のお菓子・アイス＋1個券', description: '休日のお菓子やアイスを、1個多く買えます' },
  movie: { name: '映画デート券', description: '好きな映画を見に行けます' },
  cafe: { name: 'カフェデート券', description: 'カフェでデートできます' },
  picnic: { name: 'ピクニックデート券', description: 'ピクニックデートに行けます' },
  trip: { name: '日帰り旅行券', description: '6つ集めたごほうび。日帰り旅行に行けます（期限なし）' },
};

/** 図鑑の6つの枠（1〜6）。5と6は同じ補助率アップ券。 */
export const COLLECTION_SLOTS: { slot: number; kind: LotteryCouponKind }[] = [
  { slot: 1, kind: 'snack' },
  { slot: 2, kind: 'movie' },
  { slot: 3, kind: 'cafe' },
  { slot: 4, kind: 'picnic' },
  { slot: 5, kind: 'rate_up' },
  { slot: 6, kind: 'rate_up' },
];

/** くじの画面で使う券（引く前・結果を見たあと）。そのほかは「使った」にする。 */
export const isLotteryCoupon = (kind: LotteryCouponKind): boolean => kind === 'push' || kind === 'rate_up';

/** まだ使えるか（未使用で、期限が過ぎていない）。 */
export const isCouponUsable = (coupon: LotteryCoupon, now: Date): boolean =>
  coupon.usedAt === null && (coupon.expiresAt === null || new Date(coupon.expiresAt) > now);

/** 期限までの日数（切り上げ）。期限なしは null。 */
export const daysLeft = (coupon: LotteryCoupon, now: Date): number | null =>
  coupon.expiresAt === null ? null : Math.max(0, Math.ceil((new Date(coupon.expiresAt).getTime() - now.getTime()) / 86400000));

/** 図鑑の進み具合。cycle は何周目か、collected は今の周で集めた枠（使った券も数える）。 */
export const collectionProgress = (coupons: LotteryCoupon[]): { cycle: number; collected: number[] } => {
  const cycle = 1 + coupons.filter((coupon) => coupon.kind === 'trip').length;
  const collected = coupons
    .filter((coupon) => coupon.cycle === cycle && coupon.slot !== null)
    .map((coupon) => coupon.slot as number);
  return { cycle, collected: [...new Set(collected)].sort((a, b) => a - b) };
};

// ---------------------------------------------------------------------------
// 履歴・画面の文言
// ---------------------------------------------------------------------------

export interface MonthGroup<T extends { drawnAt: string }> {
  month: string;
  draws: T[];
}

/** 新しい月から順に、月ごとにまとめる（月の中は新しい順）。 */
export const groupByMonth = <T extends { drawnAt: string }>(draws: T[]): MonthGroup<T>[] => {
  const sorted = [...draws].sort((a, b) => b.drawnAt.localeCompare(a.drawnAt));
  const groups: MonthGroup<T>[] = [];
  for (const draw of sorted) {
    const month = monthKey(draw.drawnAt);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.draws.push(draw);
    else groups.push({ month, draws: [draw] });
  }
  return groups;
};

/** 'YYYY-MM' を「10月」（今年以外は「2025年12月」）にする。 */
export const formatMonth = (month: string, now: Date): string => {
  const [year, mon] = month.split('-').map(Number);
  return year === now.getFullYear() ? `${mon}月` : `${year}年${mon}月`;
};

/** 救済の説明（画面の「今回の救済」）。 */
export const NOTE_TEXT: Record<PlanNote, string> = {
  savings: '貯福: 先月に引かなかった分、今回は補助率が上がります',
  smoothing: '月ならし: 先月は低めだったので、今回は75%以上です',
  push: 'ひと押し券: 今回は25%が出ません',
  pity: 'なだらか救済: 25%が出にくくなっています',
  breaker: '3連続ブレーカー: 同じ補助率は続きません',
};

// ---------------------------------------------------------------------------
// くじ画面の「？」（ルール説明）
// ---------------------------------------------------------------------------

export interface HelpSection {
  heading: string;
  lines: string[];
}

const yen = (value: number) => value.toLocaleString('ja-JP');

/** くじ画面の「？」で読めるルール説明。mobile・PWAで同じ文言を使う（数字は決まりごとの定数から作る）。 */
export const lotteryHelp = (): HelpSection[] => [
  {
    heading: '対象と回数',
    lines: [
      `趣味以外で必要なもので、税込${yen(PRICE_MIN)}〜${yen(PRICE_MAX)}円の買い物が対象です。`,
      `1人あたり月${MONTHLY_LIMIT}回まで（誕生月は${MONTHLY_LIMIT + 1}回）。月は日本時間で数えます。`,
      '回数は繰り越せません。ただし、引かなかった分は「貯福」で、次の月の最初の1回が良くなります。',
    ],
  },
  {
    heading: '玉と補助率',
    lines: [
      ...BALLS.map((ball) => `${ball.ball}：補助率${ball.rate}%（${ball.name}）`),
      'はずれはありません。',
    ],
  },
  {
    heading: '補助額',
    lines: [
      '補助額＝価格×補助率。100円単位に四捨五入します（49円以下は切り下げ、50円以上は切り上げ）。',
      '例：2,480円の25%は620円 → 600円。',
      '100%（満額）は計算しません。全額、家族のお金で買えます。',
      '残りは自分のお小遣いから払います。',
    ],
  },
  {
    heading: '救済（すべて自動）',
    lines: [
      'なだらか救済：25%が続くほど、次も25%が出にくくなります（1連続で半分、2連続でゼロ）。',
      '3連続ブレーカー：同じ補助率が3連続したら、次は別の補助率になります。',
      'ラッキーカラー：毎月1色（白・青・赤）が決まり、その色の玉が出たら補助率が1段上がります。',
      'ひと押し券：25%が出るたびに1枚もらえます。引く前に使うと、そのガラポンは50%以上になります。',
      '貯福：先月に引かなかった回数があれば、今月の最初の1回の下限が上がります（1回分で50%以上、2回分で75%以上、誕生月の3回分で100%確定）。',
      '月ならし：先月に2回以上引いて、すべて50%以下だったら、今月の最初の1回は75%以上になります。',
      '下限が重なったときは、一番高いものだけが効きます。',
    ],
  },
  {
    heading: '券と図鑑',
    lines: [
      '100%（金玉）が出ると、3つの箱から1つ選んで開けます。中身は図鑑でまだ集めていない特典です（重複なし）。',
      '図鑑の6つ：休日のお菓子・アイス＋1個券、映画デート券、カフェデート券、ピクニックデート券、補助率アップ券×2。',
      '6つ集めると日帰り旅行券がもらえます。そのあと図鑑は2周目に進みます。',
      '補助率アップ券は、くじの結果の画面で使います。25%か50%の結果だけ、1段上がります（75%・100%には使えません）。',
      '期限：お菓子・映画・カフェ・ピクニックの券は、手に入れた日から1か月。ひと押し券・補助率アップ券・日帰り旅行券は期限なしです。',
      '使った券・期限切れの券も、図鑑には残ります。',
    ],
  },
  {
    heading: '注意',
    lines: ['ガラポンを回すと、引き直しはできません。結果は記録されます。', '過去のくじは「履歴」で、家族ごとに見られます。'],
  },
];
