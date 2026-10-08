// 証券の価格・為替の取得元の応答を読む（docs/kakei.md §9.2.1）。
//
// Edge Function fetch-security-prices から使う。試せるよう、通信と切り離して外に出してある。
//   米国株・米国ETF  Alpha Vantage（GLOBAL_QUOTE・TIME_SERIES_DAILY・TIME_SERIES_WEEKLY）。JSON
//   国内の投資信託  投資信託協会「投信総合検索ライブラリー」の基準価額CSV。Shift_JIS（読む前に文字に直しておく）
//   為替            Frankfurter（ECB の参照レート）。JSON
// どれも「日付（YYYY-MM-DD）と値」の並びにして返す。読めないときは空の並び。

export interface DatedValue {
  on: string;
  value: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const toNumber = (text: unknown): number | null => {
  if (typeof text !== 'string' && typeof text !== 'number') return null;
  const n = Number(String(text).replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Alpha Vantage の GLOBAL_QUOTE。終値（05. price）と取引日（07. latest trading day）。 */
export const parseGlobalQuote = (body: unknown): DatedValue[] => {
  const quote = (body as { 'Global Quote'?: Record<string, string> } | null)?.['Global Quote'];
  if (!quote) return [];
  const on = quote['07. latest trading day'];
  const value = toNumber(quote['05. price']);
  return on && ISO_DATE.test(on) && value !== null ? [{ on, value }] : [];
};

/** Alpha Vantage の TIME_SERIES_DAILY・TIME_SERIES_WEEKLY。日付ごとの終値（4. close）を古い順に。 */
export const parseTimeSeries = (body: unknown): DatedValue[] => {
  if (!body || typeof body !== 'object') return [];
  const key = Object.keys(body).find((k) => k.startsWith('Time Series') || k.endsWith('Time Series'));
  if (!key) return [];
  const series = (body as Record<string, Record<string, Record<string, string>>>)[key];
  const out: DatedValue[] = [];
  for (const [on, row] of Object.entries(series ?? {})) {
    const value = toNumber(row?.['4. close']);
    if (ISO_DATE.test(on) && value !== null) out.push({ on, value });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
};

/** Alpha Vantage が値の代わりに返す知らせ（回数の上限・有料の機能など）。無ければ null。 */
export const alphaVantageNotice = (body: unknown): string | null => {
  if (!body || typeof body !== 'object') return '応答が読めない';
  const b = body as Record<string, unknown>;
  for (const key of ['Note', 'Information', 'Error Message']) {
    if (typeof b[key] === 'string') return b[key] as string;
  }
  return null;
};

/**
 * 投資信託協会の基準価額CSV（文字に直したもの）。1行目は見出し、2行目から
 * 「2018年10月31日,10000,…」（年月日・基準価額（円、1万口あたり）・純資産総額・分配金・決算期）。古い順に。
 */
export const parseFundCsv = (text: string): DatedValue[] => {
  const out: DatedValue[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [date, price] = line.split(',');
    const m = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec((date ?? '').trim());
    const value = toNumber(price);
    if (!m || value === null) continue;
    out.push({ on: `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`, value });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
};

/** Frankfurter の最新（/latest）と期間（/YYYY-MM-DD..YYYY-MM-DD）。1単位あたりの円を古い順に。 */
export const parseFrankfurter = (body: unknown, currency = 'JPY'): DatedValue[] => {
  if (!body || typeof body !== 'object') return [];
  const b = body as { date?: string; rates?: Record<string, unknown> };
  const rates = b.rates ?? {};
  // 最新: { date, rates: { JPY: 158.2 } } / 期間: { rates: { '2025-10-01': { JPY: 147.1 } } }
  if (typeof b.date === 'string') {
    const value = toNumber(rates[currency] as number);
    return ISO_DATE.test(b.date) && value !== null ? [{ on: b.date, value }] : [];
  }
  const out: DatedValue[] = [];
  for (const [on, row] of Object.entries(rates)) {
    const value = toNumber((row as Record<string, number> | null)?.[currency]);
    if (ISO_DATE.test(on) && value !== null) out.push({ on, value });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on));
};

/** 日本時間の今日（YYYY-MM-DD）。 */
export const todayJst = (nowMs: number): string =>
  new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

/** YYYY-MM-DD に日数を足す。 */
export const addDays = (on: string, days: number): string => {
  const d = new Date(`${on}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
