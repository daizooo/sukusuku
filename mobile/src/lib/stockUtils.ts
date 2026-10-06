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
