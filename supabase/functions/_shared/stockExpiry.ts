// 備蓄の期限のお知らせ（暮らしタブ。docs/home.md §3.3）で、「いつ・何を知らせるか」を決める部分。
//
// 期限の3か月前・1か月前に、毎朝1回まとめて送る。呼び出し側（send-stock-expiry-reminders）は
// 取ってきた備蓄とこの関数を突き合わせて、文面を作るだけにしてある（Edge Functionの外で
// 試せるよう、Denoにもネットワークにも依存しない）。 npm run test:stock-expiry

/** お知らせの対象になる備蓄。stock_items から引いた列。 */
export interface StockLot {
  name: string;
  quantity: number;
  /** 賞味・使用期限（YYYY-MM-DD）。月までしか無い期限はその月の末日。 */
  expires_on: string | null;
  expires_month_only: boolean;
}

/** 何か月前のお知らせか。 */
export const NOTICE_MONTHS = [3, 1] as const;

export interface StockExpiryNotice {
  /** 期限まで1か月を切った（お知らせの日が1か月前の日以降）もの。 */
  oneMonth: StockLot[];
  /** 期限まで3か月を切った（1か月前のお知らせにはまだ早い）もの。 */
  threeMonths: StockLot[];
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

const lastDayOfMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** YYYY-MM-DD に月を足す（引くときは負の数）。月末を越える日はその月の末日にそろえる。 */
export function addMonths(dateKey: string, months: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const total = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(total / 12);
  const nextMonth = (total % 12) + 1;
  const nextDay = Math.min(day, lastDayOfMonth(nextYear, nextMonth));
  return `${nextYear}-${pad2(nextMonth)}-${pad2(nextDay)}`;
}

/** YYYY-MM-DD に日を足す（引くときは負の数）。 */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

/** 日本時間の日付（YYYY-MM-DD）。家族全員が日本にいる前提（他のお知らせと同じ）。 */
export function todayJst(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60_000).toISOString().slice(0, 10);
}

/** 画面（stockUtils.ts の formatExpiry）と同じ書き方。「2031.08.25」「2027.06」。 */
export function formatExpiry(lot: Pick<StockLot, 'expires_on' | 'expires_month_only'>): string {
  if (!lot.expires_on) return '';
  const [year, month, day] = lot.expires_on.split('-');
  return lot.expires_month_only ? `${year}.${month}` : `${year}.${month}.${day}`;
}

/**
 * まだ知らせていない分のうち、知らせる日に当たった備蓄を拾う。
 *
 * 「期限の3か月前の日」「1か月前の日」が (since, today] に入った備蓄が対象。
 * since は前回までに知らせ終えた日（含まない）で、実行が飛んだ日があっても
 * 次の実行でまとめて拾える。**日付で決めるので、備蓄の行を直したり持ち出しへ移したりしても
 * 同じお知らせが繰り返されることはない**（行ごとの「知らせた」記録を持たずに済む）。
 *
 * - 期限の無いもの・期限が過ぎたもの・数が0のものは対象にしない
 * - 3か月前と1か月前の両方の日が窓に入ったもの（実行が長く飛んだとき）は、1か月前として出す
 */
export function collectNotices(
  lots: readonly StockLot[],
  sinceExclusive: string,
  today: string,
): StockExpiryNotice {
  const notice: StockExpiryNotice = { oneMonth: [], threeMonths: [] };
  const inWindow = (day: string) => day > sinceExclusive && day <= today;

  for (const lot of lots) {
    if (!lot.expires_on || lot.expires_on < today || !(lot.quantity > 0)) continue;
    if (inWindow(addMonths(lot.expires_on, -1))) notice.oneMonth.push(lot);
    else if (inWindow(addMonths(lot.expires_on, -3))) notice.threeMonths.push(lot);
  }

  const byExpiry = (a: StockLot, b: StockLot) =>
    a.expires_on === b.expires_on ? a.name.localeCompare(b.name, 'ja') : a.expires_on! < b.expires_on! ? -1 : 1;
  notice.oneMonth.sort(byExpiry);
  notice.threeMonths.sort(byExpiry);
  return notice;
}

export const hasNotice = (notice: StockExpiryNotice): boolean =>
  notice.oneMonth.length + notice.threeMonths.length > 0;

/** 品名を3つまで並べ、残りは「ほかn件」にする。 */
const MAX_NAMES = 3;

function summarize(label: string, lots: readonly StockLot[]): string {
  const shown = lots.slice(0, MAX_NAMES).map((lot) => `${lot.name}（${formatExpiry(lot)}）`);
  const rest = lots.length - shown.length;
  return `${label} ${shown.join('、')}${rest > 0 ? `、ほか${rest}件` : ''}`;
}

/** お知らせの文面。1か月前を先に出す（近いものほど急ぐため）。 */
export function buildMessage(notice: StockExpiryNotice): { title: string; body: string } {
  const lines: string[] = [];
  if (notice.oneMonth.length > 0) lines.push(summarize('1か月以内:', notice.oneMonth));
  if (notice.threeMonths.length > 0) lines.push(summarize('3か月以内:', notice.threeMonths));
  const count = notice.oneMonth.length + notice.threeMonths.length;
  return {
    title: `備蓄の期限が近づいています（${count}件）`,
    body: lines.join('\n'),
  };
}
