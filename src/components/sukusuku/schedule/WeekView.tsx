'use client';

import { useEffect, useState } from 'react';
import type { CareLog, DynamicTask } from '@/types/app';
import { WEEKDAY_LABELS, addDays, isSameDay, startOfWeek } from '@/lib/dateUtils';
import { getMilestoneLabel } from '@/lib/milestones';
import TaskRow from './TaskRow';
import { CareLogSummaryLine } from './CareLogSection';
import DayTimeline from './DayTimeline';
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

  // 計測中の睡眠は現在時刻まで伸ばすため、分ごとに描き直す。
  // 最初の描画では持たず（サーバー側の描画と食い違わせない）、
  // 時刻が分かるまで確定していない帯は描かない。
  const [now, setNow] = useState<Date | null>(null);
  const hasActiveSleep = careLogs.some((log) => log.type === 'sleep' && log.endedAt === null);
  useEffect(() => {
    if (!hasActiveSleep) return;
    const update = () => setNow(new Date());
    update();
    const timer = setInterval(update, 60000);
    return () => clearInterval(timer);
  }, [hasActiveSleep]);

  return (
    <div className="space-y-3">
      {/* 帯の目盛り。7日ぶんの帯に共通するので、上に1本だけ置く。
          記録がなく帯が1本も出ない週（これから来る週など）では出さない。 */}
      {careLogs.length > 0 && !isLoadingCareLogs && (
        <div className="flex justify-between px-1 text-[10px] text-gray-400 tabular-nums">
          {[0, 6, 12, 18, 24].map((hour) => (
            <span key={hour}>{hour}時</span>
          ))}
        </div>
      )}
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
              <div className="mt-1.5 px-1 space-y-1">
                {/* 帯には前夜から続く睡眠も入るため、その日のぶんに絞らず渡す。 */}
                <DayTimeline logs={careLogs} day={day} now={now ?? today} />
                <CareLogSummaryLine logs={dayLogs} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
