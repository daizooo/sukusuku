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
  id: string;
  type: LogType;
  label: string;
  amount: string;
  time: Date;
  note: string;
  createdBy: string | null;
}

export type ReturnStatus = '未完了' | '済' | '不要';

export interface Gift {
  id: string;
  from: string;
  item: string;
  date: string;
  returnStatus: ReturnStatus | string;
  returnItem: string;
  note: string;
}

export interface GrowthRecord {
  id: string;
  month: number | null;
  height: number | null;
  weight: number | null;
  recordedDate: string;
}

export interface DocumentItem {
  id: string;
  title: string;
  date: string;
  type: 'image';
  filePath: string;
}

export type NurseryStatus = '未見学' | '見学予約済' | '見学済';

export interface Nursery {
  id: string;
  name: string;
  distance: string;
  status: NurseryStatus | string;
  phone: string;
  memo: string;
}

// familyメンバー(パパ/ママ)の表示名解決用
export interface FamilyMember {
  id: string;
  name: string;
  role: string | null;
}

// 設定タブの1項目（見出し + 内容）。各セクションでユーザーが自由に追加・削除できる。
// keyは特定の機能(生後日数の計算やホーム画面のクイック発信など)からこの項目の値を
// 参照するための予約識別子。ユーザーが追加した項目には付与されない。
export interface ProfileField {
  id: string;
  label: string;
  value: string;
  key?: ProfileFieldKey;
}

export type ProfileFieldKey =
  | 'babyName'
  | 'birthDate'
  | 'hospitalPhone'
  | 'pediatricPhone'
  | 'papaCompanyPhone'
  | 'papaContactPhone'
  | 'mamaCompanyPhone'
  | 'mamaContactPhone';

export interface UserProfile {
  // お子様の情報
  childFields: ProfileField[];
  // パパ・ママ情報
  familyFields: ProfileField[];
  // 緊急連絡先（産院・小児科・パパママの連絡先）
  emergencyFields: ProfileField[];
  // どのセクションにも属さない、ユーザーが自由に追加・削除できるカスタム項目
  customFields: ProfileField[];
}

export type TabId = 'home' | 'schedule' | 'log' | 'memo' | 'info';

// ログイン中のユーザーの役割。users.role (Supabase) に対応。未設定の場合はnull。
export type LoginRole = 'papa' | 'mama' | null;
