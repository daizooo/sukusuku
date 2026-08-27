// すくすく手帳 - 共有ドメイン型定義
// 将来的に src/lib/supabase から取得するデータもこの形に正規化して扱う。

// 予定に付けるラベル
export type Label = 'パパ' | 'ママ' | '家族';

export const LABELS: Label[] = ['パパ', 'ママ', '家族'];

// 日付の決まり方。
// - absolute:       start_date を直接指定する
// - birth_relative: 子の誕生日 + daysAfterBirth で決まる
export type AnchorType = 'absolute' | 'birth_relative';

export interface Task {
  id: string;
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
}

// UI表示用に実際の日付を解決して付与したタスク
export interface DynamicTask extends Task {
  targetDateObj: Date | null;
  targetDate: string;
}

export type LogType = 'milk' | 'diaper' | 'pumping' | 'temperature' | 'spitup';

// 記録の種類ごとに必要な項目が違うため、type で判別する共用体として持つ。
// DBでは種類ごとの項目を care_logs.details (jsonb) に入れ、読み込み時にこの形へ復元する。

/**
 * 授乳のしかた。
 * - breast:  直接飲ませた母乳（左右の時間で記録する）
 * - pumped:  搾乳しておいた母乳を飲ませた（量で記録し、搾乳ストックから減る）
 * - formula: 粉ミルク（量で記録する）
 */
export type FeedingMethod = 'breast' | 'pumped' | 'formula';
export type BreastSide = 'left' | 'right';
export type DiaperKind = 'pee' | 'poop' | 'both';
/** うんちの色。white / red / black は受診の目安（母子手帳の便色カードと同じ考え方）。 */
export type PoopColor = 'yellow' | 'green' | 'brown' | 'white' | 'red' | 'black';
export type PoopConsistency = 'loose' | 'normal' | 'hard';
/**
 * 吐き戻した量。見た目で決まるので3つに絞ってある。
 * projectile（噴水のように勢いよく飛んだ）は受診の目安。
 */
export type SpitupAmount = 'little' | 'lot' | 'projectile';

interface CareLogBase {
  id: string;
  /** タイムラインの並び順に使う時刻。 */
  time: Date;
  note: string;
  createdBy: string | null;
  /**
   * 種類別の項目が入る前に記録された分の「量・時間など」。
   * この値が入っている記録は種類別の項目を持たないため、表示は文字列のまま行う。
   */
  legacyAmount?: string;
}

export interface MilkLog extends CareLogBase {
  type: 'milk';
  method: FeedingMethod;
  /** ミルク(formula)・搾乳した母乳(pumped)の量。実際に飲んだ量を入れる。 */
  amountMl?: number;
  /**
   * method: 'pumped' のとき、飲ませた搾乳の記録(PumpingLog)のid。
   * ここに挙がっている搾乳は「使用済み」として搾乳ストックから外れる。
   */
  pumpedFrom?: string[];
  /**
   * method: 'pumped' で飲みきれず捨てた量(ml)。
   * 用意した搾乳（pumpedFrom の合計）から amountMl を引いた分。捨てた分がなければ持たない。
   * 飲み残しは取っておけないため、用意した搾乳は飲みきれなくてもストックから外れる。
   */
  discardedMl?: number;
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

/**
 * 搾乳した母乳を「ためた」1回ぶんの記録。搾乳ストックの1パックにあたる。
 * 飲ませるときは、ミルクの記録(method: 'pumped')でこの記録を選ぶ。
 */
export interface PumpingLog extends CareLogBase {
  type: 'pumping';
  /** 搾乳した量(ml)。自由入力。 */
  amountMl: number;
}

/**
 * 体温の記録。受診したときに必ず「いつから・何度か」を聞かれるため、
 * 記録の中で唯一「時系列に並べて読む」ことに意味がある（docs/what-to-record.md §4-1）。
 */
export interface TemperatureLog extends CareLogBase {
  type: 'temperature';
  /** 測った体温(℃)。小数第1位まで。 */
  celsius: number;
}

/**
 * 吐き戻しの記録。メモ欄にいちばん多く書かれていた中身をそのまま形にしたもの
 * （docs/what-to-record.md §11-3）。押すのは量の3択ひとつだけ。
 */
export interface SpitupLog extends CareLogBase {
  type: 'spitup';
  amount: SpitupAmount;
  /**
   * 直前の授乳からの間隔(分)。授乳と関係ないときは持たない。
   * 記録したときに数えた値をそのまま入れる（授乳の記録を指すidは持たない）。
   */
  minutesAfterMilk?: number;
}

export type CareLog = MilkLog | DiaperLog | PumpingLog | TemperatureLog | SpitupLog;

/**
 * 搾乳ストックの1パック。搾乳の記録に「どの授乳で使ったか」を添えたもの。
 * 使い切ったぶんも含めて持ち、まだ使っていないパックの合計が「残り」になる。
 */
export interface PumpedBatch {
  /** もとになった PumpingLog の id。 */
  id: string;
  /** 搾乳した日時。 */
  time: Date;
  amountMl: number;
  /** この搾乳を飲ませた MilkLog の id。まだ使っていなければ null。 */
  usedBy: string | null;
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

/** 見学チェックリストの1項目の状態。項目の定義は src/lib/nurseryChecklist.ts にある。 */
export interface NurseryCheckState {
  checked: boolean;
  memo: string;
}

/** 見学チェックリストの状態。キーは NurseryCheckItem の id。 */
export type NurseryChecklist = Record<string, NurseryCheckState>;

export interface Nursery {
  id: string;
  name: string;
  address: string;
  status: NurseryStatus | string;
  phone: string;
  /** 見学日 'YYYY-MM-DD'。未定なら null。 */
  visitDate: string | null;
  /** 見学の時刻 'HH:mm'。未定なら null。 */
  visitTime: string | null;
  memo: string;
  /** 見学チェックリストの状態。未チェックの項目はキー自体を持たない。 */
  checklist: NurseryChecklist;
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
  // 1つの見出しに複数の内容を並べられる（例: 「祖父母の連絡先」に2件の電話番号）。
  // 空配列にはせず、内容が未入力でも空文字を1つ持たせる。
  // keyを持つ項目(生後日数やクイック発信が参照する項目)は先頭の1件だけを使う。
  values: string[];
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

// スケジュールタブの表示切り替え。既定は月（カレンダー）。
export type ScheduleView = 'month' | 'week' | 'day' | 'list';

// ログイン中のユーザーの役割。users.role (Supabase) に対応。未設定の場合はnull。
export type LoginRole = 'papa' | 'mama' | null;
