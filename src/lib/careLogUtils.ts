// 育児記録の選択肢・表示整形をまとめたユーティリティ。
// 記録の種類ごとに項目が違うため、表示用の見出し・バッジもここで組み立てる。

import type {
  BreastSide,
  CareLog,
  DiaperKind,
  MilkLog,
  PoopColor,
  PoopConsistency,
  SleepLog,
} from '@/types/app';
import { formatTimeString } from '@/lib/dateUtils';

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

/** 計測中（起床時刻が未確定）の睡眠記録。 */
export const findActiveSleepLog = (logs: CareLog[]): SleepLog | undefined =>
  logs.find((log): log is SleepLog => log.type === 'sleep' && log.endedAt === null);

// --- 表示整形 ---

/** ミリ秒を「2時間15分」「45分」の形に。 */
export const formatDuration = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}分`;
  if (minutes === 0) return `${hours}時間`;
  return `${hours}時間${minutes}分`;
};

/** 計測中の経過時間を 01:23:45 の形に。 */
export const formatStopwatch = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(totalSeconds / 3600))}:${pad(Math.floor(totalSeconds / 60) % 60)}:${pad(totalSeconds % 60)}`;
};

/** タイムラインカードの見出し。 */
export const getLogTitle = (log: CareLog): string => {
  switch (log.type) {
    case 'milk':
      return log.method === 'breast' ? '母乳' : 'ミルク';
    case 'diaper':
      if (log.kind === 'pee') return 'おしっこ';
      if (log.kind === 'poop') return 'うんち';
      return 'うんち＋おしっこ';
    case 'sleep':
      return '睡眠';
  }
};

/** タイムラインカードの時刻表示。睡眠だけ「開始 → 起床」。 */
export const getLogTimeText = (log: CareLog): string => {
  if (log.type === 'sleep') {
    if (!log.endedAt) return `${formatTimeString(log.startedAt)} 〜 計測中`;
    return `${formatTimeString(log.startedAt)} → ${formatTimeString(log.endedAt)}`;
  }
  return formatTimeString(log.time);
};

export type BadgeTone = 'milk' | 'diaper' | 'sleep' | 'alert' | 'neutral';

export interface LogBadge {
  text: string;
  tone: BadgeTone;
  /** 色見本を伴うバッジ（うんちの色）。 */
  swatch?: string;
}

/** カードに並べるバッジ。記録の種類ごとに中身が変わる。 */
export const getLogBadges = (log: CareLog): LogBadge[] => {
  switch (log.type) {
    case 'milk': {
      if (log.method === 'formula') {
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
    case 'sleep': {
      if (!log.endedAt) return [{ text: 'ねんね中', tone: 'sleep' }];
      return [{ text: formatDuration(log.endedAt.getTime() - log.startedAt.getTime()), tone: 'sleep' }];
    }
  }
};

/** カード全体を強調するか（白・赤・黒の便）。 */
export const isAlertLog = (log: CareLog): boolean =>
  log.type === 'diaper' && needsMedicalAttention(log.poopColor);
