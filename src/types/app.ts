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

// パパ・ママ情報の1項目（見出し + 内容）。ユーザーが自由に追加・削除できる。
export interface ProfileField {
  id: string;
  label: string;
  value: string;
}

export interface UserProfile {
  babyName: string;
  birthDate: string;
  familyFields: ProfileField[];
}

export type TabId = 'home' | 'schedule' | 'log' | 'gift' | 'info';
