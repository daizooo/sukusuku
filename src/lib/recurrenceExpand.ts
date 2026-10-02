// 繰り返しのルールから、実際の日付の一覧を求める（繰り返しの「展開」）。
//
// 何も読み込まない自己完結のファイル。同じ中身を3か所に置いている
// （src/lib・mobile/src/lib・supabase/functions/_shared）。通知を送るEdge Functionは
// アプリ側のコードを読み込めないため、コピーを持つしかない。直すときは3つとも同じに
// する（npm run test:recurrence が一致を確かめる）。
//
// 日付はすべて 'YYYY-MM-DD'。内部ではUTCの暦で数えるので、動かす端末・サーバーの
// タイムゾーンや夏時間に左右されない。
//
// 数え方はGoogleカレンダーと同じ:
// - 開始日以降で、ルールに当てはまる日だけを数える。開始日そのものがルールに
//   当てはまらないとき（開始日が金曜で「毎週 月曜」など）は、最初の回は開始日の次の月曜になる
// - 毎月の「31日」のように、その月に無い日の回は飛ばす（2月は出ない）。毎年の2月29日も同様
// - 「週間ごと」の2週間ごとなどは、開始日を含む週（日曜始まり）を1週目として数える
// - 終了は 終了日（その日を含む）／回数（開始日以降に数えた最初のn回）／なし

export type RecurrenceRule = {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  /** 週間ごとのとき。0=日 ... 6=土。空なら開始日の曜日。 */
  byWeekday?: number[];
  /** か月ごとのとき。無ければ毎月その日。nth は 1〜4、最終週は -1。 */
  byNthWeekday?: { nth: number; weekday: number };
  end: { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number };
};

const DAY_MS = 24 * 60 * 60 * 1000;
// 無限に回らないための上限（1つのルールで調べる周期の数）。
const MAX_PERIODS = 20000;

const pad = (n: number): string => String(n).padStart(2, '0');

const parseDate = (date: string): { year: number; month: number; day: number } => {
  const [year, month, day] = date.split('-').map(Number);
  return { year, month: month - 1, day };
};

const formatMs = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

const weekdayOf = (ms: number): number => new Date(ms).getUTCDay();

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

// その月の第nの weekday（最終は nth = -1）が何日か。無ければ null。
const nthWeekdayDay = (year: number, month: number, nth: number, weekday: number): number | null => {
  if (nth === -1) {
    const last = daysInMonth(year, month);
    const lastWeekday = weekdayOf(Date.UTC(year, month, last));
    return last - ((lastWeekday - weekday + 7) % 7);
  }
  const firstWeekday = weekdayOf(Date.UTC(year, month, 1));
  const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
  return day <= daysInMonth(year, month) ? day : null;
};

// ルールに当てはまる日を、開始日以降で古い順に1つずつ返す。
function* candidates(rule: RecurrenceRule, startMs: number): Generator<number> {
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  const start = parseDate(formatMs(startMs));

  switch (rule.freq) {
    case 'daily':
      for (let k = 0; k < MAX_PERIODS; k += 1) yield startMs + k * interval * DAY_MS;
      return;
    case 'weekly': {
      const weekdays = [...new Set(rule.byWeekday && rule.byWeekday.length > 0 ? rule.byWeekday : [weekdayOf(startMs)])].sort(
        (a, b) => a - b,
      );
      const weekStartMs = startMs - weekdayOf(startMs) * DAY_MS;
      for (let w = 0; w < MAX_PERIODS; w += interval) {
        for (const weekday of weekdays) {
          const ms = weekStartMs + (w * 7 + weekday) * DAY_MS;
          if (ms >= startMs) yield ms;
        }
      }
      return;
    }
    case 'monthly':
      for (let k = 0; k < MAX_PERIODS; k += interval) {
        const total = start.month + k;
        const year = start.year + Math.floor(total / 12);
        const month = total % 12;
        const day = rule.byNthWeekday
          ? nthWeekdayDay(year, month, rule.byNthWeekday.nth, rule.byNthWeekday.weekday)
          : start.day <= daysInMonth(year, month)
            ? start.day
            : null;
        if (day === null) continue;
        const ms = Date.UTC(year, month, day);
        if (ms >= startMs) yield ms;
      }
      return;
    case 'yearly':
      for (let k = 0; k < MAX_PERIODS; k += interval) {
        const year = start.year + k;
        if (start.day > daysInMonth(year, start.month)) continue;
        yield Date.UTC(year, start.month, start.day);
      }
      return;
  }
}

/** startDate から始まるルールの回のうち、from〜to（両端を含む）に入る日付を古い順に返す。 */
export const occurrencesBetween = (
  rule: RecurrenceRule,
  startDate: string,
  from: string,
  to: string,
): string[] => {
  const { year, month, day } = parseDate(startDate);
  const startMs = Date.UTC(year, month, day);
  const until = rule.end.type === 'until' ? rule.end.date : null;
  const limit = rule.end.type === 'count' ? Math.max(1, Math.floor(rule.end.count) || 1) : Infinity;

  const dates: string[] = [];
  let counted = 0;
  for (const ms of candidates(rule, startMs)) {
    const date = formatMs(ms);
    if (date > to) break;
    if (until !== null && date > until) break;
    counted += 1;
    if (counted > limit) break;
    if (date >= from) dates.push(date);
  }
  return dates;
};
