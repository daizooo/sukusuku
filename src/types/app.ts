// かぞく手帳 - 共有ドメイン型定義
// 将来的に src/lib/supabase から取得するデータもこの形に正規化して扱う。

// 予定・タスクの参加者（家族の各人）。以前は「パパ/ママ/家族」という
// 役割ラベルの単一選択だったが、Googleカレンダーのゲストにならい、
// 実際の名前を複数選択できる「参加者」に一本化した。
// 名前は家族メンバーの表示名（family_members.display_name）。選べる名前の並びと色は
// lib/familyRoster.ts が家族メンバーから決める（docs/family-app.md §3.2）。
export type Participant = string;

// 日付の決まり方。
// - absolute:       start_date を直接指定する
// - birth_relative: 子の誕生日 + daysAfterBirth で決まる
export type AnchorType = 'absolute' | 'birth_relative';

// 予定タブに追加する項目の種類。
// - event: 日時範囲・場所・参加者を持つ「予定」（Googleカレンダーのイベントに相当）
// - task:  日付とタイトルだけの軽い「タスク」（Googleカレンダーのタスクに相当。場所・参加者は持たない）
export type TaskKind = 'event' | 'task';

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  place: string;
  note: string;
  // 日付・時刻
  anchorType: AnchorType;
  startDate: string | null; // 'YYYY-MM-DD'
  startTime: string | null; // 'HH:mm' / null なら終日
  endTime: string | null; // 'HH:mm'
  daysAfterBirth: number; // anchorType === 'birth_relative' のときのみ意味を持つ
  // 主体・参加者
  // owner: 色分けの基準になる「主体」(1人だけ、または未設定)。
  // participants: 主体を含む、関わる全員（複数選択）。
  owner: Participant | null;
  participants: Participant[];
  // 完了。繰り返さない予定・タスクはこれが完了状態。繰り返すものは回ごとに完了にするため
  // 使わず（常に false）、完了にした回の日付を doneDates に持つ。
  done: boolean;
  doneDates: string[]; // 'YYYY-MM-DD'。繰り返すものだけ
  // 既存機能
  timing: string;
  // 共有設定。true は自分だけに見える（作成した本人以外には表示されない）。
  isPrivate: boolean;
  // 繰り返し設定。null なら繰り返さない単発の予定・タスク。
  recurrence: Recurrence | null;
}

// 繰り返し設定（Googleカレンダーの「カスタムの繰り返し」と同じ形）。
// iCalendarのRRULEに相当する最小限の情報だけを持つ、このアプリ独自のJSON。
//
// 注意（スコープ）: これは「繰り返しのルール」を保存・表示するためだけの型。
// 1件のタスクを実際に複数の日付へ展開してカレンダー上に並べる処理は別途必要で、
// 現時点ではまだ実装していない。
//
// 毎月・毎年の「何日か」は開始日（start_date）から決まるので持たない
// （Googleカレンダーと同じ）。毎月を「第n曜日」で数えるときだけ byNthWeekday を持つ。
export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type RecurrenceEnd =
  | { type: 'never' }
  | { type: 'until'; date: string } // 'YYYY-MM-DD'
  | { type: 'count'; count: number }; // 1以上

export interface Recurrence {
  freq: RecurrenceFreq;
  interval: number; // 1以上（「2週間ごと」なら freq: 'weekly', interval: 2）
  // freq === 'weekly' のときだけ意味を持つ。0=日 ... 6=土（Date#getDayと同じ）。
  byWeekday?: number[];
  // freq === 'monthly' のときだけ意味を持つ。無ければ「毎月その日」（開始日の日付）。
  // あれば「毎月 第n曜日」。nth は 1〜4、最終週は -1。weekday は 0=日 ... 6=土。
  byNthWeekday?: { nth: number; weekday: number };
  end: RecurrenceEnd;
}

// UI表示用に実際の日付を解決して付与したタスク
//
// 繰り返す予定・タスクは、回ごとに1件の DynamicTask に展開する（scheduleUtils の expandOccurrences）。
// id は元の予定のまま（編集・削除は全部の回に効く）で、回を見分けるのは occurrenceKey。
// 展開した回の done は、その回の日付が doneDates に入っているか。
export interface DynamicTask extends Task {
  targetDateObj: Date | null;
  targetDate: string;
  /** 回の日付 'YYYY-MM-DD'。日付が決まらない（生後日数で誕生日が未登録）ときは null。 */
  occurrenceDate: string | null;
  /** 一覧の key などに使う、回ごとに一意な値（繰り返さないものは id と同じ）。 */
  occurrenceKey: string;
}

export type LogType = 'milk' | 'diaper' | 'pumping' | 'temperature';

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
/**
 * 授乳1セットの区切り。左5分 → 右5分 → ゲップ5分で1セット。
 * ゲップは飲ませた時間ではないので記録には残さず、計測とお知らせにだけ使う。
 */
export type NursingPhase = BreastSide | 'burp';
export type DiaperKind = 'pee' | 'poop' | 'both';
/** うんちの色。white / red / black は受診の目安（母子手帳の便色カードと同じ考え方）。 */
export type PoopColor = 'yellow' | 'green' | 'brown' | 'white' | 'red' | 'black';
export type PoopConsistency = 'loose' | 'normal' | 'hard';

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
  /**
   * 飲ませずに丸ごと捨てたときの日時。捨てていなければ持たない。
   * 置きすぎた分を処分したときのためのもので、この印が付いた搾乳はストックから外れる。
   * 搾った事実そのものは残るので、その日の搾乳量には今までどおり入る。
   */
  discardedAt?: Date;
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

export type CareLog = MilkLog | DiaperLog | PumpingLog | TemperatureLog;

/**
 * 搾乳ストックの1パック。搾乳の記録に「どの授乳で使ったか」を添えたもの。
 * 使い切ったぶんも含めて持ち、飲ませても捨ててもいないパックの合計が「残り」になる。
 */
export interface PumpedBatch {
  /** もとになった PumpingLog の id。 */
  id: string;
  /** 搾乳した日時。 */
  time: Date;
  amountMl: number;
  /** この搾乳を飲ませた MilkLog の id。まだ使っていなければ null。 */
  usedBy: string | null;
  /** 飲ませずに丸ごと捨てた日時。捨てていなければ null。 */
  discardedAt: Date | null;
}

export interface GrowthRecord {
  id: string;
  month: number | null;
  height: number | null;
  weight: number | null;
  recordedDate: string;
}

export type NurseryStatus = '未見学' | '見学予約済' | '見学済';

/** 「見る」項目の3段階評価。A=良い / B=ふつう / C=気になる。 */
export type NurseryCheckGrade = 'A' | 'B' | 'C';

/** 見学チェックリストの1項目の状態。項目の定義は src/lib/nurseryChecklist.ts にある。 */
export interface NurseryCheckState {
  checked: boolean;
  memo: string;
  /** 3段階で評価する項目だけが持つ。評価を選ぶと checked も true になる。 */
  grade?: NurseryCheckGrade;
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

/**
 * リスト（買い出し・やりたいこと・やること）。
 * 予定(Task)との違いは「日付を持たないこと」。日付のある用件は予定に置く。
 */
export interface ListBoard {
  id: string;
  name: string;
  /**
   * 項目を束ねる軸の呼び名。「お店」「ジャンル」「担当」など自由入力。
   * 見出しと絞り込みの文言に使う。
   */
  groupLabel: string;
  /** 一覧の先頭に固定するか（Google Keepのピン止めと同じ）。 */
  pinned: boolean;
  position: number;
  /**
   * 自分だけのリストか。trueのリストは作成者（createdBy）以外には見えない。
   * 中のグループ・項目もまとめて見えなくなる（予定の isPrivate と同じ考え方）。
   */
  isPrivate: boolean;
  /** 作成者。「自分だけ」の判定に使う。古いリストは持っていないのでnullになりうる。 */
  createdBy: string | null;
}

/**
 * リストの中の区切り。買い出しなら「イオン」「ドラッグストア」。
 * 1件も作らなければ、そのリストはただのチェックリストとして振る舞う。
 */
export interface ListGroup {
  id: string;
  listId: string;
  name: string;
  position: number;
}

/**
 * リストの項目。数量はタイトルに書く（「牛乳2本」）。
 * 場所は項目ではなくグループで表すため、項目そのものは場所を持たない。
 * メモも持たない（Keepと同じく、行にあるのは内容だけ）。
 */
export interface ListItem {
  id: string;
  listId: string;
  /** どのグループに入っているか。null は未分類。 */
  groupId: string | null;
  title: string;
  done: boolean;
  /** 完了した時刻。完了した項目は消さずに残す。 */
  doneAt: Date | null;
  position: number;
}

// 予定・リスト・育児・設定の4つ（docs/family-app.md §4.1）。
export type TabId = 'schedule' | 'list' | 'care' | 'living' | 'info';

// スケジュールタブの表示切り替え。既定は月（カレンダー）。
export type ScheduleView = 'month' | 'day' | 'list';

// ログイン中のユーザーの役割。users.role (Supabase) に対応。未設定の場合はnull。
export type LoginRole = 'papa' | 'mama' | null;


// ---- かぞく手帳: 家族メンバー・世帯情報（docs/family-app.md §3） ----

/** 続柄。family_members.relation に対応。 */
export type MemberRelation = 'husband' | 'wife' | 'child';

/** 予定などの色分けに使う色の組の名前。family_members.color に対応。 */
export type MemberColor = 'blue' | 'pink' | 'emerald' | 'gray';

/** 家族1人1人。アカウントを持たない子もここにいる（userId が null）。 */
export interface Member {
  id: string;
  userId: string | null;
  relation: MemberRelation;
  /** 保護者（家族全員の情報と世帯情報を編集できる）。 */
  isGuardian: boolean;
  /** 画面に出す短い名前（予定の参加者・主体と同じ値）。 */
  displayName: string;
  familyName: string;
  givenName: string;
  familyNameKana: string;
  givenNameKana: string;
  /** 'YYYY-MM-DD'。未設定なら空文字。年齢・生後日数はここから計算する。 */
  birthDate: string;
  phone: string;
  email: string;
  /** 勤務先。子は所属（保育園・学校）として使う。 */
  workplace: string;
  workplacePhone: string;
  color: MemberColor;
  sortOrder: number;
}

/** メンバーのうち、設定タブで編集できる項目。 */
export type MemberDraft = Pick<
  Member,
  | 'displayName'
  | 'familyName'
  | 'givenName'
  | 'familyNameKana'
  | 'givenNameKana'
  | 'birthDate'
  | 'phone'
  | 'email'
  | 'workplace'
  | 'workplacePhone'
>;

/** 世帯情報。families に対応。 */
export interface Household {
  id: string;
  name: string;
  postalCode: string;
  address: string;
  homePhone: string;
}

export type HouseholdDraft = Omit<Household, 'id'>;

export const RELATION_LABEL: Record<MemberRelation, string> = {
  husband: '夫',
  wife: '妻',
  child: '子',
};

/** 防災備蓄の1行（品名×期限）。stock_items に対応（docs/home.md §3）。 */
export interface StockItem {
  id: string;
  category: string;
  name: string;
  quantity: number;
  unit: string;
  /** YYYY-MM-DD。期限なしは null。月までのものはその月の末日。 */
  expiresOn: string | null;
  expiresMonthOnly: boolean;
  note: string;
  position: number;
  /** 数える必要数（目標）。null なら数えない。 */
  targetId: string | null;
  /** 目標の単位に直した1つあたりの量（500mlの本を L の目標に数えるなら 0.5）。 */
  amountPerUnit: number;
  /** 保管場所。home＝寝室、carry＝持ち出し用バックパック（docs/home.md §3.6）。 */
  storage: 'home' | 'carry';
}

export type StockItemDraft = Omit<StockItem, 'id' | 'position'>;

/** 防災備蓄の必要数（目標）。stock_targets に対応（docs/home.md §3.5）。 */
export interface StockTarget {
  id: string;
  category: string;
  name: string;
  /** perPersonDay なら1人1日あたり、そうでなければ必要数そのもの。 */
  quantity: number;
  perPersonDay: boolean;
  /** 持ち出し用バックパックにも入れる品目か。 */
  carry: boolean;
  unit: string;
  note: string;
  position: number;
}

export type StockTargetDraft = Omit<StockTarget, 'id' | 'position'>;

/** 日用品の台帳（よく買うもの）の1品。household_products に対応（docs/home.md §4）。 */
export interface HouseholdProduct {
  id: string;
  name: string;
  category: string;
  /** いつも買うお店。買い出しリストに同じ名前のグループがあればそこへ入れる。 */
  store: string;
  /** いつもの値段（円・税込）。 */
  price: number | null;
  note: string;
  /** 最後に買い出しリストへ送った時刻（ISO）。 */
  lastAddedAt: string | null;
}

export type HouseholdProductDraft = Omit<HouseholdProduct, 'id' | 'lastAddedAt'>;

/** 特別費の種類。支出と、特別収入（賞与など）。docs/home.md §5.4。 */
export type SpecialKind = 'expense' | 'income';

/** 特別費の予定（1回ぶん）。special_plans に対応。 */
export interface SpecialPlan {
  id: string;
  /** 発生する月（1〜12）。月が決まっていないものは null。 */
  month: number | null;
  amount: number;
  /** 月がまだ仮のもの。 */
  tentative: boolean;
}

/** 特別費の項目。special_items に対応（予定は special_plans から集めて持つ）。 */
export interface SpecialItem {
  id: string;
  kind: SpecialKind;
  category: string;
  name: string;
  /** 周期。1=毎年、n=n年おき、0=1回きり。 */
  cycleYears: number;
  /** 周期の起点の年度（4月始まり。2026年4月〜2027年3月なら 2026）。毎年なら null でよい。 */
  baseYear: number | null;
  note: string;
  position: number;
  plans: SpecialPlan[];
}

/** 特別費の実績。special_actuals に対応。planId があれば予定の実績、無ければ予定外。 */
export interface SpecialActual {
  id: string;
  itemId: string;
  planId: string | null;
  /** YYYY-MM-DD。年度はここから決める。 */
  occurredOn: string;
  amount: number;
  note: string;
}

/** 項目の編集内容。plans の id は既存の予定を残すためのもの（新しい予定は無い）。 */
export interface SpecialItemDraft {
  kind: SpecialKind;
  category: string;
  name: string;
  cycleYears: number;
  baseYear: number | null;
  note: string;
  plans: { id: string | null; month: number | null; amount: number; tentative: boolean }[];
}

export type SpecialActualDraft = Omit<SpecialActual, 'id' | 'itemId' | 'planId'>;

/** 補助くじの玉。white＝25%、blue＝50%、red＝75%、gold＝100%（docs/home.md §9）。 */
export type SubsidyBallId = 'white' | 'blue' | 'red' | 'gold';

/** 補助率（％）。 */
export type SubsidyRate = 25 | 50 | 75 | 100;

/** 補助くじを引いた記録の1回。subsidy_draws に対応。 */
export interface SubsidyDraw {
  id: string;
  /** 引いた人のアカウントid。アカウントが無くなっていれば null。 */
  drawnBy: string | null;
  /** 買うもの。 */
  itemName: string;
  /** 商品の税込価格（円）。 */
  price: number;
  /** 出た玉。 */
  ball: SubsidyBallId;
  /** 補助率。玉の率から、ラッキーカラー・補助率アップ券で上がっていることがある。 */
  rate: SubsidyRate;
  /** 補助率アップ券を使ったか。 */
  rateUpUsed: boolean;
  /** 家族のお金から出る額（円）。 */
  subsidy: number;
  /** 引いた時刻（ISO）。 */
  drawnAt: string;
  /** 確認用のテストのくじ。月の回数・集計に入らず、引いた本人にだけ見える。 */
  isTest: boolean;
}

export interface SubsidyDrawDraft {
  itemName: string;
  price: number;
  ball: SubsidyBallId;
  rate: SubsidyRate;
  /** 使うひと押し券（引く前に使う）。 */
  pushCouponId: string | null;
  /** テストモードで引くか。 */
  isTest: boolean;
}

/**
 * 補助くじで手に入る券の種類。push＝ひと押し券、rate_up＝補助率アップ券、
 * snack・movie・cafe・picnic＝100%の箱の小さな特典、trip＝6つ集めたときの日帰り旅行券。
 */
export type LotteryCouponKind = 'push' | 'rate_up' | 'snack' | 'movie' | 'cafe' | 'picnic' | 'trip';

/** 補助くじで手に入る券。lottery_coupons に対応。アカウントごとに持つ。 */
export interface LotteryCoupon {
  id: string;
  ownerId: string;
  kind: LotteryCouponKind;
  /** 100%の箱で出た券だけ。何周目か。 */
  cycle: number | null;
  /** 100%の箱で出た券だけ。図鑑の枠（1〜6）。 */
  slot: number | null;
  obtainedAt: string;
  /** 期限（ISO）。ひと押し券・日帰り旅行券は null（期限なし）。 */
  expiresAt: string | null;
  usedAt: string | null;
  /** 確認用のテストで出た券。本物のくじには使えない。 */
  isTest: boolean;
}
