// 育児記録の選択肢・表示整形をまとめたユーティリティ。
// 記録の種類ごとに項目が違うため、表示用の見出し・バッジもここで組み立てる。

import type {
  BreastSide,
  CareLog,
  DiaperKind,
  MilkLog,
  NursingPhase,
  PoopColor,
  PoopConsistency,
  PumpedBatch,
  TemperatureLog,
} from '@/types/app';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';

// --- 選択肢 ---

/** ミルクの量(ml)。20〜200mlを20刻みで。 */
export const MILK_AMOUNT_OPTIONS = [20, 40, 60, 80, 100, 120, 140, 160, 180, 200];

/** 母乳の授乳時間(分)。0〜30分を5分刻みで。 */
export const BREAST_MINUTE_OPTIONS = [0, 5, 10, 15, 20, 25, 30];

export const DIAPER_KIND_OPTIONS: { value: DiaperKind; label: string; hasPoop: boolean }[] = [
  { value: 'pee', label: 'おしっこ', hasPoop: false },
  { value: 'poop', label: 'うんち', hasPoop: true },
  { value: 'both', label: '両方', hasPoop: true },
];

export interface PoopColorOption {
  value: PoopColor;
  label: string;
  /** 色見本の背景色。 */
  swatch: string;
  /** 白・赤・黒は受診の目安。 */
  needsAttention: boolean;
}

export const POOP_COLOR_OPTIONS: PoopColorOption[] = [
  { value: 'yellow', label: '黄', swatch: '#f0c04a', needsAttention: false },
  { value: 'green', label: '緑', swatch: '#7d9e57', needsAttention: false },
  { value: 'brown', label: '茶', swatch: '#8a5c34', needsAttention: false },
  { value: 'white', label: '白', swatch: '#f6f3ea', needsAttention: true },
  { value: 'red', label: '赤', swatch: '#bf3535', needsAttention: true },
  { value: 'black', label: '黒', swatch: '#2f2f2f', needsAttention: true },
];

export const NORMAL_POOP_COLORS = POOP_COLOR_OPTIONS.filter((c) => !c.needsAttention);
export const ATTENTION_POOP_COLORS = POOP_COLOR_OPTIONS.filter((c) => c.needsAttention);

export const POOP_CONSISTENCY_OPTIONS: { value: PoopConsistency; label: string }[] = [
  { value: 'loose', label: 'ゆるめ' },
  { value: 'normal', label: 'ふつう' },
  { value: 'hard', label: 'かため' },
];

// --- 体温 ---
//
// 目安の値。低月齢の発熱はそれ自体が受診の判断につながるので、記録したその場で
// 「これは様子見か、いま連れて行くか」が分かるところまで出す（docs/what-to-record.md §4-1）。

/** 発熱として扱う体温(℃)。 */
export const FEVER_CELSIUS = 37.5;
/** 生後3か月未満では、すぐに受診の目安になる体温(℃)。 */
export const URGENT_FEVER_CELSIUS = 38.0;
/** 低すぎる体温(℃)。測り直しても低ければ受診の目安。 */
export const LOW_CELSIUS = 35.0;
/** 入力できる体温の範囲(℃)。体温計が出さない値は打ち間違いとして弾く。 */
export const MIN_CELSIUS = 30.0;
export const MAX_CELSIUS = 43.0;
/** 記録が1件も無いときの初期値(℃)。 */
export const DEFAULT_CELSIUS = 37.0;
/** ボタンで上げ下げする幅(℃)。 */
export const CELSIUS_STEP = 0.1;

// --- 判定 ---

/** 白・赤・黒の便は受診の目安。 */
export const needsMedicalAttention = (color?: PoopColor): boolean =>
  POOP_COLOR_OPTIONS.some((c) => c.value === color && c.needsAttention);

export const getPoopColorOption = (color?: PoopColor): PoopColorOption | undefined =>
  POOP_COLOR_OPTIONS.find((c) => c.value === color);

/** 発熱か。 */
export const isFever = (celsius: number): boolean => celsius >= FEVER_CELSIUS;

/** 受診の目安か（38.0℃以上、または35.0℃未満）。 */
export const needsTemperatureAttention = (celsius: number): boolean =>
  celsius >= URGENT_FEVER_CELSIUS || celsius < LOW_CELSIUS;

/** 体温は小数第1位まで。0.1刻みの足し引きで誤差が出ないよう、そこで丸める。 */
export const roundCelsius = (celsius: number): number => Math.round(celsius * 10) / 10;

/** 表示用の体温。「37.2 ℃」の形。 */
export const formatCelsius = (celsius: number): string => `${celsius.toFixed(1)} ℃`;

/** いちばん新しい体温の記録。まだ無ければ null。 */
export const getLatestTemperature = (logs: CareLog[]): TemperatureLog | null =>
  logs
    .filter((log): log is TemperatureLog => log.type === 'temperature')
    .sort((a, b) => b.time.getTime() - a.time.getTime())[0] ?? null;

export const getSideLabel = (side: BreastSide): string => (side === 'left' ? '左' : '右');

/** 授乳1セットの区切りの呼び名。 */
export const getNursingPhaseLabel = (phase: NursingPhase): string =>
  phase === 'burp' ? 'ゲップ' : getSideLabel(phase);

/**
 * 次にどちらの乳首から授乳すればよいか。
 * 直近の母乳の記録で最後に飲ませた側の反対側を返す。判断材料がなければ null。
 */
export const getNextBreastSide = (logs: CareLog[]): BreastSide | null => {
  const latest = logs
    .filter((log): log is MilkLog => log.type === 'milk' && log.method === 'breast' && !!log.lastSide)
    .sort((a, b) => b.time.getTime() - a.time.getTime())[0];
  if (!latest?.lastSide) return null;
  return latest.lastSide === 'left' ? 'right' : 'left';
};

/** 丸ごと捨てたパックか。捨てた分はもう冷蔵庫に無いので、ストックからは外す。 */
export const isDiscardedBatch = (batch: PumpedBatch): boolean => batch.discardedAt !== null;

/** いま残っている搾乳ストック。飲ませた分と捨てた分を除いたパック。 */
export const stockPumpedBatches = (batches: PumpedBatch[]): PumpedBatch[] =>
  batches.filter((batch) => batch.usedBy === null && !isDiscardedBatch(batch));

/**
 * いま選べる搾乳ストック。残っているパックと、編集中の記録が使っているパックを返す。
 * （編集中の記録が使っているパックは「使用済み」だが、選び直せるよう外さない）
 */
export const selectablePumpedBatches = (batches: PumpedBatch[], editingLogId?: string): PumpedBatch[] =>
  batches.filter(
    (batch) => batch.usedBy === editingLogId || (batch.usedBy === null && !isDiscardedBatch(batch)),
  );

/** 搾乳ストックの残り(ml)。飲ませても捨ててもいないパックの合計。 */
export const pumpedStockMl = (batches: PumpedBatch[]): number =>
  sumBatchesMl(stockPumpedBatches(batches));

/** 渡された搾乳の合計(ml)。 */
export const sumBatchesMl = (batches: PumpedBatch[]): number =>
  batches.reduce((total, batch) => total + batch.amountMl, 0);

/** 搾乳ストックの1パックを指す日時。「8/23 14:30」の形。 */
export const formatBatchTime = (batch: PumpedBatch): string =>
  `${batch.time.getMonth() + 1}/${batch.time.getDate()} ${formatTimeString(batch.time)}`;

/** 種類別の項目が入る前に記録された分か。 */
export const isLegacyLog = (log: CareLog): boolean => log.legacyAmount !== undefined;

// --- 表示整形 ---

/** 計測中の経過時間を 01:23:45 の形に。 */
export const formatStopwatch = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
};

const LOG_TYPE_LABEL: Record<CareLog['type'], string> = {
  milk: 'ミルク',
  diaper: 'おむつ',
  pumping: '搾乳',
  temperature: '体温',
};

/** タイムラインカードの見出し。 */
export const getLogTitle = (log: CareLog): string => {
  // 種類別の項目を持たない記録は、種類名だけを見出しにする。
  if (isLegacyLog(log)) return LOG_TYPE_LABEL[log.type];

  switch (log.type) {
    case 'milk':
      if (log.method === 'breast') return '母乳';
      return log.method === 'pumped' ? '搾乳母乳' : 'ミルク';
    case 'diaper':
      if (log.kind === 'pee') return 'おしっこ';
      if (log.kind === 'poop') return 'うんち';
      return 'うんち＋おしっこ';
    case 'pumping':
      return '搾乳';
    case 'temperature':
      return '体温';
  }
};

/** タイムラインカードの時刻表示。 */
export const getLogTimeText = (log: CareLog): string => formatTimeString(log.time);

export type BadgeTone = 'milk' | 'diaper' | 'pumping' | 'temperature' | 'alert' | 'neutral';

export interface LogBadge {
  text: string;
  tone: BadgeTone;
  /** 色見本を伴うバッジ（うんちの色）。 */
  swatch?: string;
}

/** カードに並べるバッジ。記録の種類ごとに中身が変わる。 */
export const getLogBadges = (log: CareLog): LogBadge[] => {
  // 種類別の項目を持たない記録は、当時入力された文字列をそのまま出す。
  if (isLegacyLog(log)) return log.legacyAmount ? [{ text: log.legacyAmount, tone: 'neutral' }] : [];

  switch (log.type) {
    case 'milk': {
      if (log.method !== 'breast') {
        const badges: LogBadge[] = log.amountMl ? [{ text: `${log.amountMl} ml`, tone: 'milk' }] : [];
        // 搾乳は何パックぶんを飲ませたかも出す（1パック=1回の搾乳）。
        if (log.pumpedFrom?.length) badges.push({ text: `搾乳${log.pumpedFrom.length}パック`, tone: 'pumping' });
        // 飲みきれずに捨てた分。用意した量 = 飲んだ量 + 捨てた量になる。
        if (log.discardedMl) badges.push({ text: `残り ${log.discardedMl} ml 廃棄`, tone: 'neutral' });
        return badges;
      }
      const badges: LogBadge[] = [];
      if (log.leftMinutes) badges.push({ text: `左 ${log.leftMinutes}分`, tone: 'neutral' });
      if (log.rightMinutes) badges.push({ text: `右 ${log.rightMinutes}分`, tone: 'neutral' });
      if (log.lastSide) badges.push({ text: `最後は${getSideLabel(log.lastSide)}`, tone: 'milk' });
      return badges;
    }
    case 'diaper': {
      const badges: LogBadge[] = [];
      const color = getPoopColorOption(log.poopColor);
      if (color) {
        badges.push({
          text: color.label,
          tone: color.needsAttention ? 'alert' : 'diaper',
          swatch: color.swatch,
        });
      }
      const consistency = POOP_CONSISTENCY_OPTIONS.find((c) => c.value === log.poopConsistency);
      if (consistency) badges.push({ text: consistency.label, tone: 'diaper' });
      if (needsMedicalAttention(log.poopColor)) badges.push({ text: '要受診', tone: 'alert' });
      return badges;
    }
    case 'pumping': {
      const badges: LogBadge[] = [{ text: `${log.amountMl} ml`, tone: 'pumping' }];
      // 飲ませずに丸ごと捨てた分。搾った量はそのままに、ストックから外れたことを出す。
      if (log.discardedAt) badges.push({ text: '破棄', tone: 'neutral' });
      return badges;
    }
    case 'temperature': {
      // 体温そのものが主役なので、まず値を出す。熱があればそこで色が変わる。
      const badges: LogBadge[] = [
        { text: formatCelsius(log.celsius), tone: isFever(log.celsius) ? 'alert' : 'temperature' },
      ];
      if (log.celsius >= URGENT_FEVER_CELSIUS) badges.push({ text: '要受診', tone: 'alert' });
      else if (log.celsius < LOW_CELSIUS) badges.push({ text: '低体温', tone: 'alert' });
      return badges;
    }
  }
};

/**
 * バッジの配色。記録タブとカレンダーの日表示で共通して使う。
 * Web版はTailwindのクラス名を持っていたが、React Nativeにクラス名は無いので色そのものを持つ。
 */
export const BADGE_TONE_COLORS: Record<BadgeTone, { background: string; text: string }> = {
  milk: { background: colors.milkSurface, text: colors.milkText },
  diaper: { background: colors.diaperSurface, text: colors.diaperText },
  pumping: { background: colors.pumpingSurface, text: colors.pumpingText },
  temperature: { background: colors.temperatureSurface, text: colors.temperatureText },
  alert: { background: colors.alertSurface, text: colors.alertText },
  neutral: { background: colors.neutralSurface, text: colors.textMuted },
};

/** カード全体を強調するか（白・赤・黒の便、受診の目安になる体温）。 */
export const isAlertLog = (log: CareLog): boolean => {
  if (log.type === 'diaper') return needsMedicalAttention(log.poopColor);
  if (log.type === 'temperature') return needsTemperatureAttention(log.celsius);
  return false;
};

export interface DailySummary {
  milk: { count: number; ml: number; breastMinutes: number };
  diaper: { count: number; poopCount: number };
  pumping: { count: number; ml: number };
  /** 体温は合計に意味が無いので、回数とその日いちばん高かった値を持つ。 */
  temperature: { count: number; maxCelsius: number | null };
}

// 種類別の項目を持たない記録の「量・時間など」は自由入力なので、
// 数値として読めるぶんだけ合計に使う。
const parseLegacyMl = (amount: string): number => {
  const withUnit = amount.match(/(\d+(?:\.\d+)?)\s*(?:ml|ｍｌ|cc)/i);
  if (withUnit) return Number(withUnit[1]);
  const bare = amount.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  return bare ? Number(bare[1]) : 0;
};

/** その日の合計。 */
export const summarizeLogs = (logs: CareLog[]): DailySummary => {
  const summary: DailySummary = {
    milk: { count: 0, ml: 0, breastMinutes: 0 },
    diaper: { count: 0, poopCount: 0 },
    pumping: { count: 0, ml: 0 },
    temperature: { count: 0, maxCelsius: null },
  };

  for (const log of logs) {
    const legacy = log.legacyAmount;

    if (log.type === 'milk') {
      summary.milk.count += 1;
      summary.milk.ml += legacy !== undefined ? parseLegacyMl(legacy) : (log.amountMl ?? 0);
      summary.milk.breastMinutes += (log.leftMinutes ?? 0) + (log.rightMinutes ?? 0);
    } else if (log.type === 'diaper') {
      summary.diaper.count += 1;
      if (legacy === undefined && log.kind !== 'pee') summary.diaper.poopCount += 1;
    } else if (log.type === 'temperature') {
      summary.temperature.count += 1;
      summary.temperature.maxCelsius = Math.max(
        summary.temperature.maxCelsius ?? log.celsius,
        log.celsius,
      );
    } else {
      summary.pumping.count += 1;
      summary.pumping.ml += legacy !== undefined ? parseLegacyMl(legacy) : log.amountMl;
    }
  }

  return summary;
};
