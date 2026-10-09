// 日用品の「品ごとの買った記録」の数え方（docs/home.md §4.6）。
// PWA版の `src/lib/productPurchases.ts` と同じ中身にしてある（片方を直したらもう片方も直す）。
//
// 元になるのは家計の品目（`money_items.product_id` がその品のもの）だけ。品名が同じでも、
// 台帳から選んでいない記録は数えない。見込み・支出以外の記録は読む側（API）で除いてある。
// 1回＝品目の1行（同じ日に2行あれば2回）。日付は 'YYYY-MM-DD'。

export interface PurchaseLine {
  /** 買った日（記録の occurred_on）。 */
  on: string;
  quantity: number;
  /** 品目の金額（円）。 */
  amount: number;
  /** 単価（円）。記録に無ければ 金額 ÷ 個数。 */
  unitPrice: number;
  /** 記録のお店。 */
  store: string;
}

/** 1か月＝30.4日。 */
const DAYS_PER_MONTH = 30.4;
const DAYS_PER_YEAR = 365;

/** 費用の目安を出すのに要る買った回数（1回だけだと1日あたりが買った額そのものになり、数字が嘘になる）。 */
export const MIN_PURCHASES_FOR_COST = 2;

/** 月ごとの棒の数。 */
export const MONTHLY_COUNT = 12;

const dayNumber = (key: string): number => {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
};

/** 単価。記録に無ければ 金額 ÷ 個数（円に丸める）。 */
export const resolveUnitPrice = (amount: number, quantity: number, unitPrice: number | null): number =>
  unitPrice ?? (quantity > 0 ? Math.round(amount / quantity) : amount);

/** 新しい順（同じ日は渡された順のまま）。 */
export function newestFirst(lines: PurchaseLine[]): PurchaseLine[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort((a, b) => (a.line.on === b.line.on ? a.index - b.index : a.line.on < b.line.on ? 1 : -1))
    .map(({ line }) => line);
}

/** n回・合計金額。 */
export function purchaseTotals(lines: PurchaseLine[]): { count: number; amount: number } {
  return { count: lines.length, amount: lines.reduce((sum, line) => sum + line.amount, 0) };
}

export interface CostEstimate {
  perDay: number;
  perMonth: number;
  perYear: number;
}

/**
 * 費用の目安。買った金額の合計 ÷ 最初に買った日から今日までの日数（今日を含む）。
 * 買った記録が2回に満たないときは null（出さない）。円は四捨五入。
 */
export function costEstimate(lines: PurchaseLine[], today: string): CostEstimate | null {
  if (lines.length < MIN_PURCHASES_FOR_COST) return null;
  const first = lines.reduce((min, line) => (line.on < min ? line.on : min), lines[0].on);
  const days = Math.max(1, dayNumber(today) - dayNumber(first) + 1);
  const perDay = purchaseTotals(lines).amount / days;
  return {
    perDay: Math.round(perDay),
    perMonth: Math.round(perDay * DAYS_PER_MONTH),
    perYear: Math.round(perDay * DAYS_PER_YEAR),
  };
}

export interface MonthlyPurchase {
  /** 'YYYY-MM' */
  month: string;
  quantity: number;
  amount: number;
}

/** 直近 count か月（今月まで。古い月が先）の個数と金額。買っていない月は0。 */
export function monthlyPurchases(lines: PurchaseLine[], today: string, count = MONTHLY_COUNT): MonthlyPurchase[] {
  const [year, month] = today.split('-').map(Number);
  const months: MonthlyPurchase[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const index = year * 12 + (month - 1) - back;
    const key = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
    months.push({ month: key, quantity: 0, amount: 0 });
  }
  const byMonth = new Map(months.map((row) => [row.month, row]));
  for (const line of lines) {
    const row = byMonth.get(line.on.slice(0, 7));
    if (!row) continue;
    row.quantity += line.quantity;
    row.amount += line.amount;
  }
  return months;
}

/** 棒の下に小さく出す金額。1万円未満は「1,234」、以上は「1.2万」。 */
export function compactYen(amount: number): string {
  if (amount < 10_000) return amount.toLocaleString('ja-JP');
  return `${(Math.round(amount / 1000) / 10).toString()}万`;
}

// ---- 値段の推移（日付・場所・値段） ----

export interface PricePoint {
  on: string;
  store: string;
  unitPrice: number;
}

/** 値段の推移の点（古い順。同じ日は渡された順）。 */
export function priceTrend(lines: PurchaseLine[]): PricePoint[] {
  return newestFirst(lines)
    .reverse()
    .map(({ on, store, unitPrice }) => ({ on, store, unitPrice }));
}

export interface PriceSummary {
  first: PricePoint;
  latest: PricePoint;
  /** 最初に買った値段から、いまの値段までの差（円）。 */
  change: number;
  /** いちばん安く買ったとき（同じ値段なら新しいほう）。 */
  lowest: PricePoint;
}

/** 値段の要約。買った記録が無いときは null。 */
export function priceSummary(points: PricePoint[]): PriceSummary | null {
  if (points.length === 0) return null;
  const first = points[0];
  const latest = points[points.length - 1];
  const lowest = points.reduce((best, point) => (point.unitPrice <= best.unitPrice ? point : best), first);
  return { first, latest, change: latest.unitPrice - first.unitPrice, lowest };
}

export interface PriceHistoryRow extends PurchaseLine {
  /** 1つ前に買ったときの値段との差（円）。1つ前が無い・同じ値段なら null。 */
  change: number | null;
}

/** 買った記録（新しい順）に、1つ前に買ったときからの値段の差を付ける。 */
export function priceHistory(lines: PurchaseLine[]): PriceHistoryRow[] {
  const sorted = newestFirst(lines);
  return sorted.map((line, index) => {
    const previous = sorted[index + 1];
    const diff = previous ? line.unitPrice - previous.unitPrice : 0;
    return { ...line, change: diff === 0 ? null : diff };
  });
}

/** 値段の差を「+¥50」「−¥20」と書く。 */
export function formatPriceChange(change: number): string {
  return `${change > 0 ? '+' : '−'}¥${Math.abs(change).toLocaleString('ja-JP')}`;
}
