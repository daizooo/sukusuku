// 繰り返す予定・タスクの、いま通知すべき回を求める。
//
// 繰り返さない予定の通知時刻は task_reminder_schedule ビュー（SQL）が決めるが、
// 繰り返す予定は回ごとの日付がルールから計算するしかない（SQLで書くとRRULE相当の
// 展開を二重に持つことになる）ため、こちらで展開する。展開の中身は
// recurrenceExpand.ts（アプリ側と同じ）。
//
// 通知時刻は予定の日時そのもの（時刻が無ければ 09:00。日本時間）。完了にした回は通知しない。
import { occurrencesBetween, type RecurrenceRule } from './recurrenceExpand.ts';

/** 繰り返す予定の行（tasks）。使う列だけ。 */
export interface RecurringTaskRow {
  id: string;
  family_id: string;
  title: string;
  category: string | null;
  place: string | null;
  start_time: string | null;
  start_date: string | null;
  recurrence: unknown;
  done_dates: string[] | null;
}

/** task_reminder_schedule の1行と同じ形（send-reminders が送る単位）。 */
export interface ScheduleRow {
  task_id: string;
  family_id: string;
  title: string;
  category: string;
  place: string | null;
  start_time: string | null;
  remind_minutes_before: number;
  target_date: string;
  starts_at: string;
  remind_at: string;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

const jstDateOf = (ms: number): string => new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);

const FREQS = ['daily', 'weekly', 'monthly', 'yearly'];

// DBのjsonbは型を保証しないため、展開に必要な形だけ確かめて取り出す。合わなければ繰り返し無し扱い。
export const toRule = (value: unknown): RecurrenceRule | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.freq !== 'string' || !FREQS.includes(v.freq)) return null;
  if (typeof v.interval !== 'number' || !(v.interval >= 1)) return null;
  const end = v.end as Record<string, unknown> | undefined;
  if (!end || typeof end !== 'object') return null;
  if (end.type === 'until' && typeof end.date !== 'string') return null;
  if (end.type === 'count' && typeof end.count !== 'number') return null;
  if (end.type !== 'never' && end.type !== 'until' && end.type !== 'count') return null;
  return v as unknown as RecurrenceRule;
};

/**
 * 通知時刻が nowMs の lookbackMinutes 分前から nowMs までに入る回を返す。
 * 送信済みかどうかは見ない（reminder_deliveries の一意制約が二重送信を防ぐ）。
 */
export function dueRecurringReminders(
  tasks: RecurringTaskRow[],
  nowMs: number,
  lookbackMinutes: number,
): ScheduleRow[] {
  const fromMs = nowMs - lookbackMinutes * 60_000;
  // 通知時刻は日本時間の日付＋時刻なので、日付の範囲も日本時間で切る。
  const fromDate = jstDateOf(fromMs);
  const toDate = jstDateOf(nowMs);

  const rows: ScheduleRow[] = [];
  for (const task of tasks) {
    const rule = toRule(task.recurrence);
    if (!rule || !task.start_date) continue;

    const doneDates = new Set(task.done_dates ?? []);
    for (const date of occurrencesBetween(rule, task.start_date, fromDate, toDate)) {
      if (doneDates.has(date)) continue;
      const time = task.start_time ? task.start_time.slice(0, 5) : '09:00';
      const startsMs = Date.parse(`${date}T${time}:00+09:00`);
      if (startsMs < fromMs || startsMs > nowMs) continue;
      const startsAt = new Date(startsMs).toISOString();
      rows.push({
        task_id: task.id,
        family_id: task.family_id,
        title: task.title,
        category: task.category ?? '',
        place: task.place,
        start_time: task.start_time,
        remind_minutes_before: 0,
        target_date: date,
        starts_at: startsAt,
        remind_at: startsAt,
      });
    }
  }
  return rows;
}
