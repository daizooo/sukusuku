// 防災備蓄（暮らしタブ）の期限の扱い。docs/home.md §3。
// mobile版の `mobile/src/lib/stockUtils.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
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
