// 防災備蓄（暮らしタブ）の期限の扱い。docs/home.md §3。
// PWA版の `src/lib/stockUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 期限は「2031.08.25」のように日まであるものと、「2027.06」のように月までしか無いものがある
// （元の「災害備蓄品一覧」の書き方そのまま）。月までのものはその月の末日で持ち、
// expiresMonthOnly で見分ける。入力・表示もこの書き方にそろえる。

/** 期限の近さ。色分けと、上の要約の数え方に使う。 */
export type ExpiryLevel = 'expired' | 'soon' | 'year' | 'ok' | 'none';

/** 「3か月以内」を赤、「1年以内」を橙にする（docs/home.md §3.2）。 */
const SOON_MONTHS = 3;
const YEAR_MONTHS = 12;

export interface ExpiryValue {
  /** YYYY-MM-DD。期限なしは null。 */
  expiresOn: string | null;
  expiresMonthOnly: boolean;
}

const pad2 = (value: number) => String(value).padStart(2, '0');

const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * 期限の入力を読む。「2031.08.25」「2031/8/25」「2031-08-25」「2027.06」を受け付ける。
 * 空なら期限なし。読めない・存在しない日付なら null。
 */
export function parseExpiryInput(text: string): ExpiryValue | null {
  const trimmed = text.trim();
  if (trimmed === '') return { expiresOn: null, expiresMonthOnly: false };
  const match = /^(\d{4})[./-](\d{1,2})(?:[./-](\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const last = lastDayOfMonth(year, month);
  if (match[3] === undefined) {
    return { expiresOn: `${year}-${pad2(month)}-${pad2(last)}`, expiresMonthOnly: true };
  }
  const day = Number(match[3]);
  if (day < 1 || day > last) return null;
  return { expiresOn: `${year}-${pad2(month)}-${pad2(day)}`, expiresMonthOnly: false };
}

/** 期限を「2031.08.25」「2027.06」の形で出す。期限なしは空文字。入力欄の初期値にも使う。 */
export function formatExpiry({ expiresOn, expiresMonthOnly }: ExpiryValue): string {
  if (!expiresOn) return '';
  const [year, month, day] = expiresOn.split('-');
  return expiresMonthOnly ? `${year}.${month}` : `${year}.${month}.${day}`;
}

/** YYYY-MM-DD に月を足す。月末を越える日はその月の末日にそろえる。 */
function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const nextDay = Math.min(day, lastDayOfMonth(nextYear, nextMonth));
  return `${nextYear}-${pad2(nextMonth)}-${pad2(nextDay)}`;
}

/** today は YYYY-MM-DD（日本時間の今日）。期限当日まではまだ切れていない扱い。 */
export function expiryLevel(expiresOn: string | null, today: string): ExpiryLevel {
  if (!expiresOn) return 'none';
  if (expiresOn < today) return 'expired';
  if (expiresOn <= addMonths(today, SOON_MONTHS)) return 'soon';
  if (expiresOn <= addMonths(today, YEAR_MONTHS)) return 'year';
  return 'ok';
}

export const EXPIRY_LEVEL_LABEL: Record<ExpiryLevel, string> = {
  expired: '期限切れ',
  soon: '3か月以内',
  year: '1年以内',
  ok: '',
  none: '',
};

interface SortableStock {
  expiresOn: string | null;
  category: string;
  name: string;
  position: number;
}

/** 期限の近い順。期限なしは末尾にまとめ、その中はカテゴリ→品名の順。 */
export function sortStockItems<T extends SortableStock>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.expiresOn !== b.expiresOn) {
      if (a.expiresOn === null) return 1;
      if (b.expiresOn === null) return -1;
      return a.expiresOn < b.expiresOn ? -1 : 1;
    }
    return (
      a.category.localeCompare(b.category, 'ja') ||
      a.position - b.position ||
      a.name.localeCompare(b.name, 'ja')
    );
  });
}

/** 上の要約に出す件数（期限切れ・3か月以内・1年以内）。 */
export function countByLevel(items: { expiresOn: string | null }[], today: string) {
  const counts = { expired: 0, soon: 0, year: 0 };
  for (const item of items) {
    const level = expiryLevel(item.expiresOn, today);
    if (level === 'expired' || level === 'soon' || level === 'year') counts[level] += 1;
  }
  return counts;
}

/** 数の表示。小数は要るときだけ出す（「1.5」「48」）。 */
export const formatQuantity = (quantity: number) =>
  Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100);

/** カテゴリの候補。既にある値を、初めて出てきた順に重ねずに並べる。 */
export function categoryOptions(items: { category: string }[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    const category = item.category.trim();
    if (category) seen.add(category);
  }
  return [...seen];
}

// ---- 必要数（docs/home.md §3.5）・保管場所（§3.6） ----

/** 何人の何日分を備えるか（families.stock_people / stock_days）と、持ち出しを何日分にするか（stock_carry_days）。 */
export interface StockPlan {
  people: number;
  days: number;
  carryDays: number;
}

export const DEFAULT_STOCK_PLAN: StockPlan = { people: 3, days: 7, carryDays: 1 };

/** ロットの保管場所。home＝寝室（家に置く分）、carry＝持ち出し用バックパック。 */
export type StockStorage = 'home' | 'carry';

export const STORAGE_LABEL: Record<StockStorage, string> = {
  home: '寝室',
  carry: '持ち出し',
};

interface TargetLike {
  id: string;
  quantity: number;
  perPersonDay: boolean;
  /** 持ち出しにも入れる品目か。 */
  carry?: boolean;
}

interface CountableStock {
  targetId: string | null;
  quantity: number;
  amountPerUnit: number;
  expiresOn: string | null;
  storage?: StockStorage;
}

/** 必要数。1人1日あたりなら人数×日数を掛ける。 */
export const requiredQuantity = (target: TargetLike, plan: Pick<StockPlan, 'people' | 'days'>) =>
  target.perPersonDay ? target.quantity * plan.people * plan.days : target.quantity;

/** 端数を出さないための丸め（0.5L × 48本 などの浮動小数の誤差を消す）。 */
const round2 = (value: number) => Math.round(value * 100) / 100;

export interface TargetStatus<T extends TargetLike> {
  target: T;
  required: number;
  /** 期限切れでないロットの「数 × 1つあたりの量」の合計（寝室と持ち出しの両方）。 */
  have: number;
  /** 足りない量。足りていれば0。 */
  shortage: number;
  /** 持ち出しの確かめ。持ち出しに入れない品目なら null。 */
  carry: { required: number; have: number; shortage: number } | null;
}

/**
 * 目標ごとの必要数・持っている量・不足。期限切れのロットは数えない（使えないため）。
 * 持ち出しに入れる品目は、持ち出しにあるロットだけで「持ち出しの日数」分あるかも出す
 * （決まった数の品目は、その数を全部持ち出しに入れる）。
 */
export function targetStatuses<T extends TargetLike>(
  targets: T[],
  items: CountableStock[],
  plan: StockPlan,
  today: string,
): TargetStatus<T>[] {
  return targets.map((target) => {
    const usable = items.filter(
      (item) => item.targetId === target.id && expiryLevel(item.expiresOn, today) !== 'expired',
    );
    const sum = (rows: CountableStock[]) =>
      round2(rows.reduce((total, item) => total + item.quantity * item.amountPerUnit, 0));
    const required = round2(requiredQuantity(target, plan));
    const have = sum(usable);
    let carry: TargetStatus<T>['carry'] = null;
    if (target.carry) {
      const carryRequired = round2(requiredQuantity(target, { people: plan.people, days: plan.carryDays }));
      const carryHave = sum(usable.filter((item) => item.storage === 'carry'));
      carry = { required: carryRequired, have: carryHave, shortage: round2(Math.max(0, carryRequired - carryHave)) };
    }
    return { target, required, have, shortage: round2(Math.max(0, required - have)), carry };
  });
}

/** 全体か持ち出しのどちらかが足りていない。 */
export const isShort = (status: { shortage: number; carry: { shortage: number } | null }) =>
  status.shortage > 0 || (status.carry?.shortage ?? 0) > 0;

// ---- 点検・要対応（docs/home.md §10.2） ----

/** 点検の間隔の既定（月）と、画面で選べる間隔。間隔が null の備品は点検しない。 */
export const DEFAULT_INSPECT_MONTHS = 6;
export const INSPECT_INTERVAL_OPTIONS = [3, 6, 12] as const;

/** timestamptz（ISO文字列）を日本時間の YYYY-MM-DD にする。 */
export function jstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

interface InspectableStock {
  expiresOn: string | null;
  quantity: number;
  inspectedOn: string | null;
  inspectIntervalMonths: number | null;
  /** 追加した日（日本時間）。点検日がまだ無い備品は、ここから数える。 */
  createdOn: string;
}

/** 次の点検の日。点検の対象でない（期限がある・間隔が無い・数が0）なら null。 */
export function nextInspectionOn(item: InspectableStock): string | null {
  if (item.expiresOn !== null || item.inspectIntervalMonths == null || item.quantity <= 0) return null;
  return addMonths(item.inspectedOn ?? item.createdOn, item.inspectIntervalMonths);
}

/** 点検の時期が来ている（次の点検の日を、今日を含めて過ぎた）。 */
export function inspectionDue(item: InspectableStock, today: string): boolean {
  const next = nextInspectionOn(item);
  return next !== null && next <= today;
}

/**
 * 持ち出しバッグ全体の点検（半年ごと）。バッグの中のロットの点検日のうち一番新しい日を「最後の点検」とし、
 * 一度も点検していなければ、バッグの中で一番古い追加日から数える。バッグが空なら null。
 */
export function carryInspection(
  items: (Pick<InspectableStock, 'quantity' | 'inspectedOn' | 'createdOn'> & { storage: StockStorage })[],
  today: string,
): { lastOn: string | null; nextOn: string; due: boolean } | null {
  const bag = items.filter((item) => item.storage === 'carry' && item.quantity > 0);
  if (bag.length === 0) return null;
  const inspected = bag.map((item) => item.inspectedOn).filter((on): on is string => on !== null);
  const lastOn = inspected.length > 0 ? inspected.reduce((a, b) => (a > b ? a : b)) : null;
  const base = lastOn ?? bag.map((item) => item.createdOn).reduce((a, b) => (a < b ? a : b));
  const nextOn = addMonths(base, DEFAULT_INSPECT_MONTHS);
  return { lastOn, nextOn, due: nextOn <= today };
}

interface ExpiringStock {
  quantity: number;
  expiresOn: string | null;
}

/** 「確認が必要なもの」に出す、期限切れ・3か月以内のロットの1行。 */
export interface ReplacementLot<T extends ExpiringStock> {
  item: T;
  level: 'expired' | 'soon';
}

/** 期限切れ・3か月以内のロット（数が0のものは除く）。期限の近い順。 */
export function replacementLots<T extends ExpiringStock>(items: T[], today: string): ReplacementLot<T>[] {
  const lots: ReplacementLot<T>[] = [];
  for (const item of [...items].sort((a, b) => (a.expiresOn ?? '').localeCompare(b.expiresOn ?? ''))) {
    if (item.quantity <= 0) continue;
    const level = expiryLevel(item.expiresOn, today);
    if (level === 'expired' || level === 'soon') lots.push({ item, level });
  }
  return lots;
}

// ---- 点検盤の見た目に使う小さな計算（docs/home.md §10.2） ----

/** 2つの日付（YYYY-MM-DD）の日数の差（to − from）。 */
export function daysBetween(from: string, to: string): number {
  const parse = (key: string) => {
    const [year, month, day] = key.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

/** 日数を「3日」「2か月」のように短く言う。 */
export function spanText(days: number): string {
  const abs = Math.abs(days);
  if (abs < 60) return `${abs}日`;
  if (abs < 730) return `${Math.floor(abs / 30)}か月`;
  return `${Math.floor(abs / 365)}年`;
}

/** 期限までの言い方。「あと18日」「切れて12日」「今日まで」。 */
export function expiryCountdown(expiresOn: string, today: string): string {
  const days = daysBetween(today, expiresOn);
  if (days < 0) return `切れて${spanText(days)}`;
  if (days === 0) return '今日まで';
  return `あと${spanText(days)}`;
}

/** 品名・カテゴリに合う絵柄（アイコン）の名前。画面側でアイコンに対応づける。 */
export type StockIconKey =
  | 'water'
  | 'drink'
  | 'rice'
  | 'meat'
  | 'soup'
  | 'snack'
  | 'toilet'
  | 'trash'
  | 'radio'
  | 'light'
  | 'battery'
  | 'baby'
  | 'care'
  | 'warm'
  | 'bag'
  | 'other';

const ICON_RULES: [StockIconKey, RegExp][] = [
  ['toilet', /トイレ/],
  ['trash', /防臭|ゴミ|ごみ|ポリ袋/],
  ['bag', /ウォーターバッグ|給水|リュック|バッグ/],
  ['water', /水|ウォーター/],
  ['drink', /アクエリ|飲料|ジュース|お茶|茶|スポーツドリンク|コーヒー/],
  ['rice', /米|ご飯|ごはん|アルファ|おかゆ|パスタ|麺|パン|食料|食品/],
  ['soup', /スープ|味噌汁|みそ汁/],
  ['snack', /ようかん|羊羹|ビスケット|クッキー|おやつ|お菓子|チョコ|飴|あめ|ゼリー|栄養/],
  ['meat', /缶|肉|魚|やきとり|焼き鳥|サバ|さば|ツナ|レトルト|カレー/],
  ['radio', /ラジオ/],
  ['light', /ライト|ランタン|懐中|照明|ろうそく|ヘッド/],
  ['battery', /電池|バッテリー|電源|充電|ソーラー|発電/],
  ['baby', /ミルク|おむつ|オムツ|ベビー|離乳|哺乳|粉/],
  ['care', /衛生|ウェット|マスク|ティッシュ|絆創膏|救急|消毒|薬|歯|生理/],
  ['warm', /毛布|寝袋|防寒|カイロ|ブランケット|雨具|レイン|軍手|手袋/],
];

export function stockIconKey(name: string, category = ''): StockIconKey {
  const hit = ICON_RULES.find(([, pattern]) => pattern.test(name));
  if (hit) return hit[0];
  const byCategory = ICON_RULES.find(([key, pattern]) => key !== 'water' && pattern.test(category));
  return byCategory ? byCategory[0] : 'other';
}

// ---- 点検盤（画面の作り直し。docs/home.md §10.2）の表示用のまとめ ----

type BoardItem = CountableStock &
  SortableStock &
  ExpiringStock &
  InspectableStock & { id: string; storage: StockStorage; amountPerUnit: number; targetId: string | null; unit: string };

/** 画面で使う目標（必要数）。 */
type BoardTarget = TargetLike & { category: string; name: string; position: number; unit: string };

export interface StockBoard<I extends BoardItem, T extends BoardTarget> {
  /** 目標ごとの塊。lots は、その目標に数えるロット（寝室・持ち出しの両方）を期限の近い順に並べたもの。 */
  blocks: { status: TargetStatus<T>; lots: I[] }[];
  /** 目標に数えていない、期限のあるロット（「その他の備品」）。 */
  others: I[];
  /** 目標に数えていない、期限の無いロット（「備品（期限なし）」）。 */
  equipment: I[];
  /** 「要対応」。 */
  attention: {
    /** 全体か持ち出しが足りない目標。 */
    short: { status: TargetStatus<T> }[];
    /** 期限切れ・3か月以内のロット。 */
    replacement: ReturnType<typeof replacementLots<I>>;
    /** 点検の時期が来ている備品。 */
    inspect: I[];
    /** 持ち出しバッグ全体の点検。バッグが空なら null。 */
    bag: ReturnType<typeof carryInspection>;
  };
  /** 「備えの状況」の件数。year は3か月より先〜1年以内、ok は1年より先（数が0のロットは数えない）。 */
  counts: {
    short: number;
    carryShort: number;
    expired: number;
    soon: number;
    year: number;
    ok: number;
    inspect: number;
  };
  /** カテゴリごと・品目ごとのまとめ（画面の主役）。 */
  categories: StockCategory<I, T>[];
  /** 備え度（0〜100）。目標ごとの「持っている / 必要」（最大1）の平均。目標が無ければ100。 */
  readiness: number;
}

export function buildStockBoard<I extends BoardItem, T extends BoardTarget>(
  items: I[],
  targets: T[],
  plan: StockPlan,
  today: string,
): StockBoard<I, T> {
  const statuses = targetStatuses(targets, items, plan, today);
  const blocks = statuses.map((status) => ({
    status,
    lots: sortStockItems(items.filter((item) => item.targetId === status.target.id)),
  }));
  const targetIds = new Set(targets.map((target) => target.id));
  const loose = items.filter((item) => item.targetId === null || !targetIds.has(item.targetId));
  const replacement = replacementLots(items, today);
  const inspect = items.filter((item) => inspectionDue(item, today));
  const stocked = items.filter((item) => item.quantity > 0);
  const counts = countByLevel(stocked, today);
  const ok = stocked.filter((item) => expiryLevel(item.expiresOn, today) === 'ok').length;
  const readiness =
    blocks.length === 0
      ? 100
      : Math.round(
          (blocks.reduce((sum, { status }) => sum + (status.required > 0 ? Math.min(1, status.have / status.required) : 1), 0) /
            blocks.length) *
            100,
        );
  return {
    blocks,
    others: sortStockItems(loose.filter((item) => item.expiresOn !== null)),
    equipment: sortStockItems(loose.filter((item) => item.expiresOn === null)),
    attention: {
      short: blocks.filter((block) => isShort(block.status)),
      replacement,
      inspect: sortStockItems(inspect),
      bag: carryInspection(items, today),
    },
    counts: {
      short: statuses.filter((status) => status.shortage > 0).length,
      carryShort: statuses.filter((status) => (status.carry?.shortage ?? 0) > 0).length,
      expired: counts.expired,
      soon: counts.soon,
      year: counts.year,
      ok,
      inspect: inspect.length,
    },
    categories: groupStockProducts(items, blocks, today),
    readiness,
  };
}

// ---- カテゴリ別・品目別のまとめ（画面の主役。docs/home.md §10.2） ----

/** 画面に出す1品目。同じ目標に数えるロット、または同じ品名のロットをまとめたもの。 */
export interface StockProduct<I, T extends TargetLike> {
  key: string;
  name: string;
  category: string;
  /** 目標（必要数）に数えている品目なら、その進み具合。 */
  target: { status: TargetStatus<T> } | null;
  /** 期限の近い順のロット。 */
  lots: I[];
  /** どれぐらいあるか。目標があれば目標の単位の「持っている量」（期限切れを除く）、無ければロットの数の合計。 */
  total: number;
  unit: string;
  /** うち持ち出しバッグにある量（同じ単位）。無ければ 0。 */
  carryTotal: number;
  /** いちばん近い期限と、その近さ。期限のあるロットが無ければ null。 */
  nearest: { on: string; level: ExpiryLevel } | null;
  /** 点検が要る備品なら、次の点検の日と、時期が来ているか。 */
  inspect: { next: string; due: boolean } | null;
}

export interface StockCategory<I, T extends TargetLike> {
  category: string;
  products: StockProduct<I, T>[];
}

/** 空のカテゴリ名の呼び方。 */
export const NO_CATEGORY = 'その他';

/**
 * カテゴリごと・品目ごとにまとめる。カテゴリは、目標→ロットの順に最初に出てきた順。
 * 品目は、目標のある品（目標の並び順）→目標の無い品（品名順）。
 */
export function groupStockProducts<I extends BoardItem, T extends BoardTarget>(
  items: I[],
  blocks: { status: TargetStatus<T> }[],
  today: string,
): StockCategory<I, T>[] {
  const products: StockProduct<I, T>[] = [];
  const toProduct = (
    key: string,
    name: string,
    category: string,
    lots: I[],
    target: StockProduct<I, T>['target'],
  ): StockProduct<I, T> => {
    const sorted = sortStockItems(lots);
    const stocked = sorted.filter((lot) => lot.quantity > 0);
    const dated = stocked.filter((lot) => lot.expiresOn !== null);
    const next = stocked.map((lot) => nextInspectionOn(lot)).filter((on): on is string => on !== null);
    const usable = stocked.filter((lot) => expiryLevel(lot.expiresOn, today) !== 'expired');
    const unit = target ? target.status.target.unit : (sorted.find((lot) => lot.unit !== '')?.unit ?? '');
    const sum = (rows: I[]) => round2(rows.reduce((total, lot) => total + lot.quantity * (target ? lot.amountPerUnit : 1), 0));
    return {
      key,
      name,
      category: category.trim() || NO_CATEGORY,
      target,
      lots: sorted,
      total: target ? target.status.have : sum(stocked),
      unit,
      carryTotal: sum(usable.filter((lot) => lot.storage === 'carry')),
      nearest: dated.length > 0 ? { on: dated[0].expiresOn as string, level: expiryLevel(dated[0].expiresOn, today) } : null,
      inspect:
        next.length > 0
          ? (() => {
              const first = next.reduce((a, b) => (a < b ? a : b));
              return { next: first, due: first <= today };
            })()
          : null,
    };
  };

  const targetIds = new Set(blocks.map((block) => block.status.target.id));
  const ordered = [...blocks].sort((a, b) => a.status.target.position - b.status.target.position);
  for (const block of ordered) {
    const { target } = block.status;
    const lots = items.filter((item) => item.targetId === target.id);
    const category = target.category.trim() || lots[0]?.category || '';
    products.push(toProduct(`target:${target.id}`, target.name, category, lots, block));
  }
  const loose = items.filter((item) => item.targetId === null || !targetIds.has(item.targetId));
  const byName = new Map<string, I[]>();
  for (const item of loose) {
    const key = `${item.category.trim()}\u0000${item.name.trim()}`;
    byName.set(key, [...(byName.get(key) ?? []), item]);
  }
  const looseProducts = [...byName.values()]
    .map((lots) => toProduct(`name:${lots[0].category.trim()}:${lots[0].name.trim()}`, lots[0].name.trim(), lots[0].category, lots, null))
    .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  products.push(...looseProducts);

  const categories: StockCategory<I, T>[] = [];
  for (const product of products) {
    let entry = categories.find((row) => row.category === product.category);
    if (!entry) {
      entry = { category: product.category, products: [] };
      categories.push(entry);
    }
    entry.products.push(product);
  }
  // 「その他」は最後に。
  return [...categories.filter((row) => row.category !== NO_CATEGORY), ...categories.filter((row) => row.category === NO_CATEGORY)];
}

// ---- 品目の数の内訳（寝室・持ち出し用。docs/home.md §10.2.2） ----

/** 1つの保管場所の数。required は、その場所に要る量（目標が無い・持ち出しに入れない品目なら null）。 */
export interface StorageShare {
  have: number;
  required: number | null;
  /** 足りない量（足りていれば0）。 */
  shortage: number;
  /** 要る量より多い分（required が null なら0）。 */
  surplus: number;
}

/**
 * 品目の数を寝室・持ち出し用に分ける。数え方は品目の total と同じ（目標があれば期限切れを除いた
 * 目標の単位の量、無ければロットの数）。持ち出しに入れる目標なら、持ち出し用の要る量は
 * 「人数×バッグの日数」分、寝室の要る量は全体の必要数からそれを引いた分。
 */
export function storageShares<I extends BoardItem, T extends TargetLike>(
  product: Pick<StockProduct<I, T>, 'target' | 'lots'>,
  today: string,
): Record<StockStorage, StorageShare> {
  const status = product.target?.status ?? null;
  const have = (storage: StockStorage) =>
    round2(
      product.lots
        .filter(
          (lot) => lot.storage === storage && lot.quantity > 0 && (!status || expiryLevel(lot.expiresOn, today) !== 'expired'),
        )
        .reduce((total, lot) => total + lot.quantity * (status ? lot.amountPerUnit : 1), 0),
    );
  const share = (amount: number, required: number | null): StorageShare => ({
    have: amount,
    required,
    shortage: required === null ? 0 : round2(Math.max(0, required - amount)),
    surplus: required === null ? 0 : round2(Math.max(0, amount - required)),
  });
  const carryRequired = status?.carry ? status.carry.required : null;
  const homeRequired = status ? round2(Math.max(0, status.required - (carryRequired ?? 0))) : null;
  return { home: share(have('home'), homeRequired), carry: share(have('carry'), carryRequired) };
}
