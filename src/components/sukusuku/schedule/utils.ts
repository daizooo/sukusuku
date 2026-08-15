import type { DynamicTask } from '@/types/app';
import { isSameDay } from '@/lib/dateUtils';

/** 時刻の早い順。終日は先頭に置く。 */
export const byTime = (a: DynamicTask, b: DynamicTask) => {
  if (!a.startTime && !b.startTime) return 0;
  if (!a.startTime) return -1;
  if (!b.startTime) return 1;
  return a.startTime.localeCompare(b.startTime);
};

export const byDateThenTime = (a: DynamicTask, b: DynamicTask) => {
  const at = a.targetDateObj?.getTime() ?? Infinity;
  const bt = b.targetDateObj?.getTime() ?? Infinity;
  if (at !== bt) return at - bt;
  return byTime(a, b);
};

export const tasksOnDate = (tasks: DynamicTask[], date: Date): DynamicTask[] =>
  tasks.filter((t) => isSameDay(t.targetDateObj, date)).sort(byTime);
