'use client';

import type { CareLog, DynamicTask } from '@/types/app';
import { WEEKDAY_LABELS, addDays, isSameDay, startOfWeek } from '@/lib/dateUtils';
import { getMilestoneLabel } from '@/lib/milestones';
import TaskRow from './TaskRow';
import { CareLogSummaryLine } from './CareLogSection';
import { tasksOnDate } from './utils';

interface WeekViewProps {
  /** この日を含む週を表示する。 */
  date: Date;
  today: Date;
  tasks: DynamicTask[];
  birthDate: string;
  /** 表示中の週の記録（日ごとに振り分けて使う）。 */
  careLogs: CareLog[];
  isLoadingCareLogs?: boolean;
  onSelectDate: (date: Date) => void;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
}

/**
 * 7日分を縦に並べた週の面。月表示と日表示の中間として、
 * 「この1週間に何があるか」と「記録がどれくらいあったか」を1画面で見る。
 */
export default function WeekView({
  date,
  today,
  tasks,
  birthDate,
  careLogs,
  isLoadingCareLogs,
  onSelectDate,
  onToggleTodo,
  onOpenTask,
}: WeekViewProps) {
  const start = startOfWeek(date);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  return (
    <div className="space-y-3">
      {days.map((day) => {
        const dayTasks = tasksOnDate(tasks, day);
        const dayLogs = careLogs.filter((log) => isSameDay(log.time, day));
        const isToday = isSameDay(day, today);
        const isPastOrToday = day.getTime() <= today.getTime();
        const milestone = getMilestoneLabel(birthDate, day);

        return (
          <section key={day.toISOString()}>
            <button
              onClick={() => onSelectDate(day)}
              className="w-full flex items-center gap-2 px-1 mb-1.5 text-left"
            >
              <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                  isToday ? 'bg-blue-500 text-white' : 'text-gray-700'
                }`}
              >
                {day.getDate()}
              </span>
              <span
                className={`text-xs font-medium ${day.getDay() === 0 ? 'text-red-500' : day.getDay() === 6 ? 'text-blue-500' : 'text-gray-500'}`}
              >
                {WEEKDAY_LABELS[day.getDay()]}
              </span>
              {milestone && (
                <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                  {milestone}
                </span>
              )}
            </button>

            {dayTasks.length > 0 ? (
              <div className="space-y-2">
                {dayTasks.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 px-1 py-1">予定なし</p>
            )}

            {isPastOrToday && !isLoadingCareLogs && (
              <div className="mt-1.5 px-1">
                <CareLogSummaryLine logs={dayLogs} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
