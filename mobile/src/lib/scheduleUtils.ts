import type { CareLog, DynamicTask } from '@/types/app';
import { addDays, isSameDay, startOfDay, startOfWeek } from '@/lib/dateUtils';

// 予定の並べ方・まとめ方。Web版の `src/components/sukusuku/schedule/utils.ts` を
// そのまま持ってきたもの（予定タブの月・週・日・リストで同じ並びにするため）。

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** 今日から何日後か。過去なら負。 */
export const diffInDays = (date: Date, today: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / MS_PER_DAY);

/** 日付見出しに添える相対表記。'今日' / '明日' / 'あと3日' / '3日前'。 */
export const formatRelativeDay = (date: Date, today: Date): string => {
  const days = diffInDays(date, today);
  if (days === 0) return '今日';
  if (days === 1) return '明日';
  if (days === -1) return '昨日';
  return days > 0 ? `あと${days}日` : `${-days}日前`;
};

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

/** 完了済みは新しく済ませたものから見せる。日付未定（0扱い）は末尾へ。 */
export const byDateDesc = (a: DynamicTask, b: DynamicTask) =>
  (b.targetDateObj?.getTime() ?? 0) - (a.targetDateObj?.getTime() ?? 0);

// --- リスト表示のセクション分け ---

export interface ScheduleDayGroup {
  /** 日ごとの見出しに使う日付（0時）。 */
  date: Date;
  tasks: DynamicTask[];
}

export interface ScheduleListSection {
  key: string;
  title: string;
  /** 見出しの強さ。期限切れと今日だけ目立たせる。 */
  tone: 'alert' | 'today' | 'plain';
  groups: ScheduleDayGroup[];
  count: number;
}

/** 日付順に並んだ予定を、同じ日ごとにまとめる。 */
const groupByDay = (tasks: DynamicTask[]): ScheduleDayGroup[] => {
  const groups: ScheduleDayGroup[] = [];
  for (const task of tasks) {
    if (!task.targetDateObj) continue;
    const date = startOfDay(task.targetDateObj);
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.date, date)) last.tasks.push(task);
    else groups.push({ date, tasks: [task] });
  }
  return groups;
};

/** 月のまとまりの見出し。今年のうちは年を省く。 */
const formatMonthTitle = (date: Date, today: Date): string =>
  date.getFullYear() === today.getFullYear()
    ? `${date.getMonth() + 1}月`
    : `${date.getFullYear()}年${date.getMonth() + 1}月`;

/**
 * リスト表示のセクション。期限切れ → 今日 → 明日 → 今週 → 月ごと の順に返す。
 * 中身が空のセクションは返さない。
 * 完了済みと日付未定はセクションの流れから外して扱うため、ここには含めない。
 */
export const buildScheduleSections = (
  tasks: DynamicTask[],
  today: Date,
): ScheduleListSection[] => {
  const start = startOfDay(today);
  const tomorrow = addDays(start, 1);
  const afterTomorrow = addDays(start, 2);
  // 「今週」は日曜始まりの週の終わりまで。週末が近く明後日が翌週なら、今週の枠は出ない。
  const weekEnd = addDays(startOfWeek(start), 7);

  const dated = tasks.filter((t) => t.targetDateObj && !t.done).sort(byDateThenTime);
  const dayOf = (task: DynamicTask) => startOfDay(task.targetDateObj as Date).getTime();

  const sections: ScheduleListSection[] = [];
  const add = (
    key: string,
    title: string,
    tone: ScheduleListSection['tone'],
    items: DynamicTask[],
  ) => {
    if (items.length === 0) return;
    sections.push({ key, title, tone, groups: groupByDay(items), count: items.length });
  };

  add('overdue', '期限切れ', 'alert', dated.filter((t) => dayOf(t) < start.getTime()));
  add('today', '今日', 'today', dated.filter((t) => dayOf(t) === start.getTime()));
  add('tomorrow', '明日', 'plain', dated.filter((t) => dayOf(t) === tomorrow.getTime()));
  add(
    'thisWeek',
    '今週',
    'plain',
    dated.filter((t) => dayOf(t) >= afterTomorrow.getTime() && dayOf(t) < weekEnd.getTime()),
  );

  // 今週までに入らなかった先の予定は月ごとにまとめる。
  const laterStart = Math.max(afterTomorrow.getTime(), weekEnd.getTime());
  const months = new Map<string, DynamicTask[]>();
  for (const task of dated) {
    if (dayOf(task) < laterStart) continue;
    const date = task.targetDateObj as Date;
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const bucket = months.get(key);
    if (bucket) bucket.push(task);
    else months.set(key, [task]);
  }
  // dated は日付順なので、Map の挿入順がそのまま月の並びになる。
  for (const [key, items] of months) {
    add(`month-${key}`, formatMonthTitle(items[0].targetDateObj as Date, today), 'plain', items);
  }

  return sections;
};

// --- 24時間の帯 ---

/** その日の中での位置。0が0時、1が24時。 */
const dayFraction = (timeMs: number, dayStartMs: number): number =>
  (timeMs - dayStartMs) / MS_PER_DAY;

/** その日の授乳の位置（0〜1）。24時間の帯に細い印として並べる。 */
export const getMilkMarksOnDate = (logs: CareLog[], day: Date): number[] => {
  const dayStart = startOfDay(day).getTime();
  return logs
    .filter((log) => log.type === 'milk' && isSameDay(log.time, day))
    .map((log) => dayFraction(log.time.getTime(), dayStart))
    .sort((a, b) => a - b);
};
