// すくすく手帳 - 共有ドメイン型定義
// 将来的に src/lib/supabase から取得するデータもこの形に正規化して扱う。

// 予定に付けるラベル
export type Label = 'パパ' | 'ママ' | '家族';

export const LABELS: Label[] = ['パパ', 'ママ', '家族'];

export type TaskCategory = '手続き' | '健診' | 'イベント' | 'お買い物';

// 日付の決まり方。
// - absolute:       start_date を直接指定する
// - birth_relative: 子の誕生日 + daysAfterBirth で決まる
export type AnchorType = 'absolute' | 'birth_relative';

export interface Task {
  id: string;
  category: TaskCategory | string;
  title: string;
  place: string;
  note: string;
  // 日付・時刻
  anchorType: AnchorType;
  startDate: string | null; // 'YYYY-MM-DD'
  startTime: string | null; // 'HH:mm' / null なら終日
  endTime: string | null; // 'HH:mm'
  daysAfterBirth: number; // anchorType === 'birth_relative' のときのみ意味を持つ
  // ラベル・リマインダー
  label: Label;
  remindMinutesBefore: number | null; // null は通知なし
  done: boolean;
  // 既存機能
  timing: string;
  belongings: string;
}

// UI表示用に実際の日付を解決して付与したタスク
export interface DynamicTask extends Task {
  targetDateObj: Date | null;
  targetDate: string;
}

export type LogType = 'milk' | 'diaper' | 'sleep';

export interface CareLog {
  id: number;
  type: LogType;
  label: string;
  amount: string;
  time: Date;
  note: string;
  user: string;
}

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
