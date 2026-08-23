// 育児記録の選択肢・表示整形をまとめたユーティリティ。
// 記録の種類ごとに項目が違うため、表示用の見出し・バッジもここで組み立てる。

import type {
  BreastSide,
  CareLog,
  DiaperKind,
  MilkLog,
  PoopColor,
  PoopConsistency,
} from '@/types/app';
import { formatTimeString } from '@/lib/dateUtils';

// --- 選択肢 ---

/** ミルク・搾乳した母乳の量(ml)。20〜200mlを20刻みで。 */
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

// --- 判定 ---

/** 白・赤・黒の便は受診の目安。 */
export const needsMedicalAttention = (color?: PoopColor): boolean =>
  POOP_COLOR_OPTIONS.some((c) => c.value === color && c.needsAttention);

export const getPoopColorOption = (color?: PoopColor): PoopColorOption | undefined =>
  POOP_COLOR_OPTIONS.find((c) => c.value === color);

export const getSideLabel = (side: BreastSide): string => (side === 'left' ? '左' : '右');

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
  }
};

/** タイムラインカードの時刻表示。 */
export const getLogTimeText = (log: CareLog): string => formatTimeString(log.time);

export type BadgeTone = 'milk' | 'diaper' | 'pumping' | 'alert' | 'neutral';

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
        return log.amountMl ? [{ text: `${log.amountMl} ml`, tone: 'milk' }] : [];
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
    case 'pumping':
      return [{ text: `${log.amountMl} ml`, tone: 'pumping' }];
  }
};

/** バッジの配色。記録タブとカレンダーの日表示で共通して使う。 */
export const BADGE_TONE_CLASS: Record<BadgeTone, string> = {
  milk: 'bg-amber-100 text-amber-800 font-bold',
  diaper: 'bg-blue-100 text-blue-700',
  pumping: 'bg-rose-100 text-rose-700 font-bold',
  alert: 'bg-red-100 text-red-700 font-bold',
  neutral: 'bg-gray-100 text-gray-600',
};

/** カード全体を強調するか（白・赤・黒の便）。 */
export const isAlertLog = (log: CareLog): boolean =>
  log.type === 'diaper' && needsMedicalAttention(log.poopColor);

export interface DailySummary {
  milk: { count: number; ml: number; breastMinutes: number };
  diaper: { count: number; poopCount: number };
  pumping: { count: number; ml: number };
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
    } else {
      summary.pumping.count += 1;
      summary.pumping.ml += legacy !== undefined ? parseLegacyMl(legacy) : log.amountMl;
    }
  }

  return summary;
};
