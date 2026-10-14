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
  title: string;
  place: string;
  note: string;
  kind: TaskKind;
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
  // 共有設定。true は自分だけに見える（作成した本人以外には表示されない）。
  isPrivate: boolean;
  // 繰り返し設定。null なら繰り返さない単発の予定・タスク。
  recurrence: Recurrence | null;
  // 既存機能
  timing: string;
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
}

/** 授乳の入力画面で「搾乳」を選んだときの、飲ませた分か搾った分かの切り替え。 */
export type FeedingEntryMode = 'feed' | 'pump';

// 予定・リスト・育児・家計・その他の5つ（docs/family-app.md §4.1）。
export type TabId = 'schedule' | 'list' | 'care' | 'money' | 'info';

// スケジュールタブの表示切り替え。既定は月（カレンダー）。
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

export type ScheduleView = 'month' | 'day' | 'list';


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
  /** 最後に点検した日（YYYY-MM-DD）。未点検は null。期限の無い備品が対象（§10.2）。 */
  inspectedOn: string | null;
  /** 点検の間隔（月）。null は点検しない。 */
  inspectIntervalMonths: number | null;
  /** 追加した日（日本時間のYYYY-MM-DD）。点検日が無い備品は、ここから数える。保存はしない。 */
  createdOn: string;
}

export type StockItemDraft = Omit<StockItem, 'id' | 'position' | 'createdOn'>;

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

/** 家計の種類のまとまり。生活費と収入（docs/kakei.md §3.1）。 */
export type MoneyCategoryKind = 'living' | 'income';

/** 家計の種類。money_categories に対応。parentId が null なら大分類（予算を置く単位）。 */
export interface MoneyCategory {
  id: string;
  kind: MoneyCategoryKind;
  parentId: string | null;
  name: string;
  /** アイコン（moneyUtils の MONEY_ICONS の key）。null は名前から選ぶ。 */
  icon: string | null;
  /** アイコンの色（#rrggbb）。null は標準（アイコンごとの色）。 */
  iconColor: string | null;
  position: number;
  /** 使わなくした（選べないが、記録には残る）。 */
  archived: boolean;
}

/**
 * 家計の予算。大分類・年（暦年）ごとに1月〜12月の月額を持つ。money_budgets に対応（列名は fiscal_year のまま）。
 * 年の途中で直しても、直した月より前の月は変わらない（docs/kakei.md §3.1）。
 */
export interface MoneyBudget {
  id: string;
  categoryId: string;
  year: number;
  /** 1月〜12月の月額（長さ12。null の月は予算なし）。 */
  monthAmounts: (number | null)[];
  /** 固定費から出した行（手入力ではない。保存しない）。fixedBudgetRows。 */
  fixed?: boolean;
}

/** 出金元の種類。 */
export type MoneyWalletType = 'card' | 'cash' | 'bank' | 'prepaid' | 'qr' | 'securities';

/** 出金元。money_wallets に対応。 */
export interface MoneyWallet {
  id: string;
  name: string;
  type: MoneyWalletType;
  /** カードの締め日（31 は末日）。カードだけ。docs/kakei.md §3.4。 */
  closeDay: number | null;
  /** カードの引き落とし日（31 は末日）。締め日のあとの最初のこの日（payMonthOffset があるときは、その月のこの日）。 */
  payDay: number | null;
  /** カードの引き落とし月が、締め日の月の何か月後か（1〜3）。null は締め日のあとに来る最初の引き落とし日。 */
  payMonthOffset: number | null;
  /** カードの引き落とし口座。 */
  payWalletId: string | null;
  /** アイコンの色（#rrggbb）。null は標準（種類ごとの色）。 */
  iconColor: string | null;
  position: number;
  archived: boolean;
}

export type MoneyWalletDraft = Omit<MoneyWallet, 'id' | 'position' | 'archived'>;

/**
 * 確定した残高（通帳・銀行のアプリの残高）。money_wallet_balances に対応。
 * 出金元の残高 = 最後に確定した残高 + その後の記録（docs/kakei.md §9.3）。
 */
export interface MoneyWalletBalance {
  id: string;
  walletId: string;
  /** YYYY-MM-DD。その日の終わりの残高（この日の記録も含む）。 */
  balanceOn: string;
  /** 残高（円）。マイナスもある（カードの未払いなど）。 */
  amount: number;
  /** 口座の履歴に行として出すか。false でも残高の土台としては同じに効く。 */
  showInHistory: boolean;
}

/** 証券の銘柄の種類。米国株・米国ETF / 国内の投資信託 / 預り金（docs/kakei.md §9.2）。 */
export type MoneySecurityKind = 'us_stock' | 'jp_fund' | 'cash';

/** 証券の銘柄。money_securities に対応。価格はサーバーが毎朝取る。 */
export interface MoneySecurity {
  id: string;
  name: string;
  kind: MoneySecurityKind;
  /** 米国株はティッカー、国内投信は ISIN コード。預り金は無し。 */
  code: string | null;
  /** 国内投信の協会コード。 */
  fundCode: string | null;
  currency: 'JPY' | 'USD';
  position: number;
  archived: boolean;
}

/** 預り区分。NISA成長投資枠 / NISAつみたて投資枠 / 特定 / 一般。 */
export type MoneyHoldingAccount = 'nisa' | 'nisa_tsumitate' | 'tokutei' | 'ippan';

/** 保有（証券口座・銘柄・預り区分ごと）。money_holdings に対応。 */
export interface MoneyHolding {
  id: string;
  walletId: string;
  securityId: string;
  account: MoneyHoldingAccount;
  /** 保有数（株数・口数・預り金の額）。 */
  quantity: number;
  /** 取得単価（円。国内投信は1万口あたり）。預り金は無し。 */
  costPrice: number | null;
  archived: boolean;
}

/** 保有ごとの日々の評価額。money_holding_values に対応（サーバーが作る）。 */
export interface MoneyHoldingValue {
  holdingId: string;
  /** YYYY-MM-DD（日本時間）。 */
  valueOn: string;
  quantity: number;
  /** 価格（銘柄の通貨で。国内投信は1万口あたり）。 */
  price: number;
  /** 為替（1単位あたりの円。円建ては 1）。 */
  fx: number;
  /** 評価額（円）。 */
  value: number;
  /** 取得額（円）。 */
  cost: number | null;
}

/** 証券のデータ一式（口座の面で使う）。 */
export interface MoneySecuritiesData {
  securities: MoneySecurity[];
  holdings: MoneyHolding[];
  /** 日々の評価額。historyLoaded が false のうちは、保有ごとの最新の1行だけ（一覧の残高用）。 */
  values: MoneyHoldingValue[];
  /** values に過去の履歴（推移用）まで入っているか。履歴は推移・銘柄の詳細を開いたときに読む。 */
  historyLoaded: boolean;
}

/** 銘柄の追加・編集の入力。保有は預り区分ごと（保有数 0 の区分は使わなくする）。 */
export interface MoneySecurityDraft {
  name: string;
  kind: MoneySecurityKind;
  code: string | null;
  fundCode: string | null;
  currency: 'JPY' | 'USD';
  holdings: { account: MoneyHoldingAccount; quantity: number; costPrice: number | null }[];
}

/** 家計のお店（設定データ）。money_stores に対応。記録は名前の文字列で持つので、直しても過去の記録は変わらない。 */
export interface MoneyStore {
  id: string;
  name: string;
  /** 並び順（小さいほど上。設定「よく行くお店」で並べ替える）。 */
  position: number;
  /** 使わなくした（選択画面に出さないが、記録には残る）。 */
  archived: boolean;
}

/** 記録の種類。支出・収入・振替。 */
export type MoneyRecordKind = 'expense' | 'income' | 'transfer';

/** 品目。money_items に対応。種類（categoryId）を持つ。振替は無い。 */
export interface MoneyItem {
  id: string;
  amount: number;
  categoryId: string | null;
  /** 削除したカテゴリの名前（categoryId が null のとき。名前だけ残す。docs/kakei.md §3.1）。それ以外は ''。 */
  categoryName: string;
  quantity: number;
  /** 単価。個数 × 単価 = 金額。金額だけ入れたものは null。 */
  unitPrice: number | null;
  name: string;
  memo: string;
  /** レシートに印字された品名そのまま（読み取りで入れた品目だけ。docs/kakei.md §10.3）。 */
  receiptName?: string | null;
}

/** 記録（記録の詳細＋品目）。money_records に対応。 */
export interface MoneyRecord {
  id: string;
  kind: MoneyRecordKind;
  /** YYYY-MM-DD。 */
  occurredOn: string;
  /** 出金元（収入は入金先）。 */
  walletId: string | null;
  /** 振替の入金先。 */
  toWalletId: string | null;
  store: string;
  createdBy: string | null;
  /** 見込みの額（毎月の記録・カード代金で自動で作ったもの）。額を直すと確定になる。docs/kakei.md §3.3。 */
  isEstimate: boolean;
  /** この記録を作った毎月の記録のルール。 */
  recurringId: string | null;
  /** 自動で作った記録が、どの月の分か（YYYY-MM）。人が入れた記録は null。 */
  month: string | null;
  items: MoneyItem[];
}

export type MoneyItemDraft = Omit<MoneyItem, 'id'>;

/** 記録の保存内容。id が null なら新しい記録。品目は毎回すべて入れ替える。 */
export interface MoneyRecordDraft {
  id: string | null;
  kind: MoneyRecordKind;
  occurredOn: string;
  walletId: string | null;
  toWalletId: string | null;
  store: string;
  /** お店をお店の設定に登録するか（お店の選択で「お店に登録して使う」を選んだとき。docs/kakei.md §3.5）。 */
  registerStore?: boolean;
  /** 見込みのまま残すか。 */
  isEstimate: boolean;
  items: MoneyItemDraft[];
  /** レシートに印字された店名そのまま（読み取りで入れた記録だけ。docs/kakei.md §10.3）。 */
  receiptStore?: string;
}

/** 休日のとき。翌営業日・前営業日・そのまま。 */
export type MoneyHolidayRule = 'next' | 'prev' | 'none';

/** 毎月の記録のルール（固定費・給料など）。money_recurring に対応。docs/kakei.md §3.3。 */
export interface MoneyRecurring {
  id: string;
  kind: MoneyRecordKind;
  /** 引き落とし日（毎月◯日。31 は末日）。weekOfMonth があるときは使わない（1 を入れる）。 */
  day: number;
  /** 第何週か（1〜4＝第1〜第4、5＝最終）。weekday とセット。null は day で決める。 */
  weekOfMonth: number | null;
  /** 曜日（0＝日〜6＝土）。weekOfMonth とセット。 */
  weekday: number | null;
  /** 記録する月（1〜12）。null は毎月。 */
  months: number[] | null;
  holiday: MoneyHolidayRule;
  /** 固定額（fixed）は amount で確定として作る。見込む（estimate）は過去の記録から出す（無ければ amount）。 */
  amountMode: 'fixed' | 'estimate';
  amount: number;
  /** 出金元（収入は入金先）。 */
  walletId: string | null;
  /** 振替の入金先。 */
  toWalletId: string | null;
  store: string;
  categoryId: string | null;
  /** 品名（任意）。 */
  name: string;
  position: number;
  archived: boolean;
  /** ルールを作った日（YYYY-MM-DD）。固定費を予算に足すのはこの年から（年の中は全部の月）。 */
  createdAt: string;
}

export type MoneyRecurringDraft = Omit<MoneyRecurring, 'id' | 'position' | 'archived' | 'createdAt'>;

// ---- Zaim 取り込み（docs/kakei.md §9.5） ----

/** 取り込んだ明細の状態。pending 未確認 / confirm 手入力との確認 / unreadable 読めない（ほかは片づいたもの）。 */
export type MoneyFeedStatus = 'pending' | 'confirm' | 'linked' | 'created' | 'ignored' | 'unreadable';

/** Zaim の入出金通知メールから取り込んだ明細。money_feed に対応。 */
export interface MoneyFeedItem {
  id: string;
  receivedAt: string;
  toEmail: string | null;
  subject: string;
  /** 'in' 入金 / 'out' 出金。読めないメールは null。 */
  direction: 'in' | 'out' | null;
  /** YYYY-MM-DD。読めないメールは null。 */
  occurredOn: string | null;
  amount: number | null;
  /** Zaim での口座名。 */
  accountName: string | null;
  description: string;
  walletId: string | null;
  status: MoneyFeedStatus;
  /** 振替の相手の明細。 */
  pairId: string | null;
  recordId: string | null;
  /** 確認・候補に出す記録。 */
  candidateRecordIds: string[];
}

/** 取り込みのルールの動き（§9.5.6）。 */
export type MoneyFeedAction = 'record' | 'transfer' | 'link_recurring' | 'adjust_only' | 'ignore';

/** 取り込みのルール。money_feed_rules に対応。上（position の小さい順）から見て、最初に当たったものを使う。 */
export interface MoneyFeedRule {
  id: string;
  position: number;
  name: string;
  /** 条件。null は「どの口座でも」「どちらでも」。 */
  walletId: string | null;
  direction: 'in' | 'out' | null;
  /** contains は内容に含む文字、key は覚えたルール（内容の決まった部分が同じ）。 */
  match: 'contains' | 'key';
  pattern: string;
  amountMin: number | null;
  amountMax: number | null;
  action: MoneyFeedAction;
  recordKind: 'expense' | 'income' | null;
  categoryId: string | null;
  store: string;
  toWalletId: string | null;
  recurringId: string | null;
  /** 「次から同じ内容は自動で」で作ったルール。 */
  learned: boolean;
}

export type MoneyFeedRuleDraft = Omit<MoneyFeedRule, 'id' | 'position' | 'learned'>;

/** 取り込みの設定（家族で1行）。日数は突き合わせの幅。 */
export interface MoneyFeedSettings {
  startAt: string | null;
  pairDays: number;
  estimateDays: number;
  manualDays: number;
}

/** 出金元の、Zaim での口座名と所持者（§9.5.3）。 */
export interface MoneyWalletFeed {
  walletId: string;
  feedName: string | null;
  holderName: string | null;
  holderZaimEmail: string | null;
  holderKana: string | null;
}

/** 届いたことのある Zaim の口座名（宛先ごと）。 */
export interface MoneyFeedAccount {
  accountName: string;
  toEmail: string | null;
  lastReceivedAt: string;
}

export interface MoneyFeedData {
  /** 片づいていない明細（未確認・確認・読めない）。新しい順。 */
  open: MoneyFeedItem[];
  rules: MoneyFeedRule[];
  settings: MoneyFeedSettings;
  walletFeeds: MoneyWalletFeed[];
  accounts: MoneyFeedAccount[];
  /** 明細から来た（結んだ・作った）記録。新しい500件の明細の分。記録の入力の重複の確認に使う。 */
  linkedRecordIds: string[];
  /** 最後に明細が届いた日時。 */
  lastReceivedAt: string | null;
  /** この30日に届いた明細の数。 */
  recentCount: number;
}

/** レシートの読み取りの結果（Edge Function money-receipt-scan。docs/kakei.md §10.4）。記録の入力に入れて開く。 */
export interface ReceiptScan {
  /** 入れるお店（過去の記録・登録したお店に当てたもの。当たらなければ読んだ店名）。 */
  store: string;
  storeRegistered: boolean;
  /** レシートに印字された店名そのまま。 */
  receiptStore: string;
  occurredOn: string;
  /** 支払いの欄から当てた出金元。当たらなければ null（前回の出金元を使う）。 */
  walletId: string | null;
  items: ReceiptScanItem[];
  /** レシートの合計。品目の和と比べる（§10.5）。 */
  receiptTotal: number;
}

export interface ReceiptScanItem {
  receiptName: string;
  name: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  categoryId: string | null;
  /** 種類をどこから決めたか。none は「種類を選んでください」。 */
  categorySource: 'history' | 'ai' | 'none';
}

// --- 契約（賃貸・保険・サブスクなどの控え。docs/contracts.md）---

/** 契約の種類。一覧の絞り込みに使う。 */
export type ContractKind = 'rent' | 'insurance' | 'subscription' | 'other';

/** 金額の周期。年間の目安は 月払い×12 + 年払い（1回は数えない）。 */
export type ContractAmountCycle = 'monthly' | 'yearly' | 'once';

/** 契約の自由項目（「ラベル: 値」の1行）。 */
export interface ContractField {
  id: string;
  label: string;
  value: string;
  position: number;
}

/** 契約。contracts に対応。自由項目は開いたときに読むので、一覧では持たない。 */
export interface Contract {
  id: string;
  kind: ContractKind;
  title: string;
  company: string;
  /** 契約者（family_members.id）。 */
  contractorId: string | null;
  /** 'YYYY-MM-DD'。無ければ null。 */
  startedOn: string | null;
  /** 満了日・更新日・次の請求日。県民共済のように無い契約は null（お知らせもバッジも出ない）。 */
  renewsOn: string | null;
  /** 「更新した」で更新日を進める月数。県民共済のように期間の無い契約は null。 */
  termMonths: number | null;
  amount: number | null;
  amountCycle: ContractAmountCycle | null;
  /** 更新日の何日前にお知らせするか。空ならお知らせなし。 */
  notifyDays: number[];
  memo: string;
  /** 見せる相手（family_members.id）。作った本人は含まれていなくても見える。 */
  visibleMemberIds: string[];
  /** 作った本人（users.id）。 */
  createdBy: string | null;
}

/** 追加・編集の入力。自由項目も一緒に保存する。 */
export type ContractDraft = Omit<Contract, 'id' | 'createdBy'> & {
  fields: Pick<ContractField, 'label' | 'value'>[];
};
