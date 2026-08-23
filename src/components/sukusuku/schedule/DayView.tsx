'use client';

import { Plus } from 'lucide-react';
import type { CareLog, DynamicTask } from '@/types/app';
import { isSameDay } from '@/lib/dateUtils';
import { formatBabyAgeAt, getMilestoneLabel } from '@/lib/milestones';
import TaskRow from './TaskRow';
import CareLogSection from './CareLogSection';
import DayTimeline from './DayTimeline';

interface DayViewProps {
  date: Date;
  today: Date;
  /** その日の予定（時刻順に並べ済み）。 */
  tasks: DynamicTask[];
  birthDate: string;
  /** 表示中の範囲の記録。その日のぶんへの絞り込みはこの中で行う。 */
  careLogs: CareLog[];
  isLoadingCareLogs?: boolean;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: (date: Date) => void;
  onOpenLogTab: (date: Date) => void;
}

/** 1日の面。予定と育児記録をここで合わせて見る。 */
export default function DayView({
  date,
  today,
  tasks,
  birthDate,
  careLogs,
  isLoadingCareLogs,
  onToggleTodo,
  onOpenTask,
  onAddTask,
  onOpenLogTab,
}: DayViewProps) {
  const babyAge = formatBabyAgeAt(birthDate, date);
  const milestone = getMilestoneLabel(birthDate, date);
  // 未来の日には記録が存在しないため、記録の枠自体を出さない。
  const isPastOrToday = date.getTime() <= today.getTime();
  // 一覧と合計はその日のぶんだけ。
  const dayLogs = careLogs.filter((log) => isSameDay(log.time, date));

  return (
    <div className="space-y-5">
      {(babyAge || milestone) && (
        <div className="flex items-center gap-2 px-1">
          {babyAge && <span className="text-xs font-medium text-gray-500">{babyAge}</span>}
          {milestone && (
            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              {milestone}
            </span>
          )}
        </div>
      )}

      <section>
        <div className="flex items-end justify-between mb-2 px-1">
          <h4 className="text-xs font-bold text-gray-500">予定 {tasks.length > 0 && `(${tasks.length}件)`}</h4>
          <button onClick={() => onAddTask(date)} className="text-blue-500 text-xs font-medium flex items-center">
            <Plus size={14} className="mr-0.5" /> この日に追加
          </button>
        </div>
        {tasks.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-5 bg-white rounded-xl border border-gray-100">
            予定はありません
          </p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
            ))}
          </div>
        )}
      </section>

      {isPastOrToday && (
        <CareLogSection
          logs={dayLogs}
          isLoading={isLoadingCareLogs}
          timeline={<DayTimeline logs={dayLogs} day={date} variant="day" />}
          onOpenLogTab={() => onOpenLogTab(date)}
        />
      )}
    </div>
  );
}
