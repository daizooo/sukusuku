// すくすく手帳 - 共有ドメイン型定義
// 将来的に src/lib/supabase から取得するデータもこの形に正規化して扱う。

export type Assignee = 'パパ' | 'ママ' | '二人で' | '未定';

export type TaskCategory = '手続き' | '健診' | 'イベント' | 'お買い物';

export interface Task {
  id: string;
  category: TaskCategory | string;
  title: string;
  place: string;
  timing: string;
  daysAfterBirth: number;
  done: boolean;
  note: string;
  belongings: string;
  assignee: Assignee;
  notification: boolean;
}

// UI表示用に目安日を計算して付与したタスク
export interface DynamicTask extends Task {
  targetDateObj: Date | null;
  targetDate: string;
}

export type LogType = 'milk' | 'diaper' | 'sleep';

// --- 育児記録 ---
// 記録の種類ごとに必要な項目が違うため、type で判別する共用体として持つ。

export type FeedingMethod = 'breast' | 'formula';
export type BreastSide = 'left' | 'right';
export type DiaperKind = 'pee' | 'poop' | 'both';
/** うんちの色。white / red / black は受診の目安（母子手帳の便色カードと同じ考え方）。 */
export type PoopColor = 'yellow' | 'green' | 'brown' | 'white' | 'red' | 'black';
export type PoopConsistency = 'loose' | 'normal' | 'hard';

interface CareLogBase {
  id: number;
  /** タイムラインの並び順に使う時刻。睡眠は寝始めの時刻。 */
  time: Date;
  note: string;
  user: string;
}

export interface MilkLog extends CareLogBase {
  type: 'milk';
  method: FeedingMethod;
  /** ミルク(formula)の量。 */
  amountMl?: number;
  /** 母乳(breast)の左右それぞれの授乳時間（分, 0〜30の5分刻み）。 */
  leftMinutes?: number;
  rightMinutes?: number;
  /** 最後に飲ませた側。次にどちらから授乳するかの判断に使う。 */
  lastSide?: BreastSide;
}

export interface DiaperLog extends CareLogBase {
  type: 'diaper';
  kind: DiaperKind;
  /** うんちを含む場合のみ。未選択のまま保存できる。 */
  poopColor?: PoopColor;
  poopConsistency?: PoopConsistency;
}

export interface SleepLog extends CareLogBase {
  type: 'sleep';
  startedAt: Date;
  /** 計測中は null。起床時に確定する。 */
  endedAt: Date | null;
}

export type CareLog = MilkLog | DiaperLog | SleepLog;

export type ReturnStatus = '未完了' | '済' | '不要';

export interface Gift {
  id: number;
  from: string;
  item: string;
  date: string;
  returnStatus: ReturnStatus | string;
  returnItem: string;
  note: string;
}

export interface GrowthRecord {
  month: number;
  height: number;
  weight: number;
}

export interface DocumentItem {
  id: number;
  title: string;
  date: string;
  type: 'image';
}

export type NurseryStatus = '未見学' | '見学予約済' | '見学済';

export interface Nursery {
  id: number;
  name: string;
  distance: string;
  status: NurseryStatus | string;
  phone: string;
  memo: string;
}

export interface UserProfile {
  babyName: string;
  birthDate: string;
  momName: string;
  momWorkplace: string;
  dadName: string;
  dadWorkplace: string;
  address: string;
}

export type TabId = 'home' | 'schedule' | 'log' | 'gift' | 'info';
