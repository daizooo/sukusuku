import type { DynamicTask } from '@/types/app';
import { formatDateString, parseDateString, toDateString } from '@/lib/dateUtils';
import { occurrencesBetween } from '@/lib/recurrenceExpand';

// 繰り返す予定・タスクを、回ごとの1件へ展開する（中身は mobile/src/lib と src/lib で同じ）。
//
// 日付を解決した予定のうち、繰り返すもの（日付指定で、繰り返しの設定があるもの）だけを
// from〜to に入る回へ置き換える。繰り返さないものはそのまま通す（範囲では絞らない。
// 絞るのは日付ごとに引く側の仕事）。
//
// 展開した回は、元の予定と id が同じ（編集・削除は全部の回に効く）。回を見分けるのは
// occurrenceKey で、その回の完了は doneDates に回の日付があるかで決まる。
//
// 生後日数で日付を決める予定は、日付がそろわず繰り返しを持てない（入力欄も出さない）ので、
// 古いデータに繰り返しの設定が残っていても単発として扱う。
export const expandOccurrences = (tasks: DynamicTask[], from: Date, to: Date): DynamicTask[] => {
  const fromDate = toDateString(from);
  const toDate = toDateString(to);

  const result: DynamicTask[] = [];
  for (const task of tasks) {
    if (!task.recurrence || task.anchorType !== 'absolute' || !task.startDate) {
      result.push(task);
      continue;
    }
    for (const date of occurrencesBetween(task.recurrence, task.startDate, fromDate, toDate)) {
      const dateObj = parseDateString(date);
      result.push({
        ...task,
        targetDateObj: dateObj,
        targetDate: formatDateString(dateObj),
        occurrenceDate: date,
        occurrenceKey: `${task.id}@${date}`,
        done: task.doneDates.includes(date),
      });
    }
  }
  return result;
};

/** 繰り返す予定のある1回の完了を切り替えたあとの doneDates。 */
export const toggledDoneDates = (doneDates: string[], date: string): string[] =>
  doneDates.includes(date) ? doneDates.filter((d) => d !== date) : [...doneDates, date].sort();
