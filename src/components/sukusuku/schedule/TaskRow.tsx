'use client';

import { CalendarDays, CheckCircle2, Circle, Clock, Lock, MapPin } from 'lucide-react';
import type { DynamicTask } from '@/types/app';
import { getOwnerTone } from '@/lib/uiUtils';
import { formatTimeRange } from '@/lib/dateUtils';

interface TaskRowProps {
  task: DynamicTask;
  onToggle: (task: DynamicTask) => void;
  onOpen: (task: DynamicTask) => void;
  /** 日付を行に出すか（日をまたいで並べる一覧で使う）。 */
  showDate?: boolean;
}

/** 予定1件の行。リスト表示・週表示・日表示で共通して使う。 */
export default function TaskRow({ task, onToggle, onOpen, showDate }: TaskRowProps) {
  return (
    <div
      className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-start space-x-3 cursor-pointer hover:bg-blue-50 hover:border-blue-200 active:bg-blue-100 transition"
      onClick={() => onOpen(task)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task);
        }}
        aria-label={task.done ? '未完了に戻す' : '完了にする'}
        className={`mt-0.5 flex-shrink-0 p-1 -ml-1 transition-colors ${task.done ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}
      >
        {task.done ? <CheckCircle2 size={22} /> : <Circle size={22} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-start">
          <p className={`font-medium text-sm leading-tight ${task.done ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
            {task.title}
            {task.isPrivate && <Lock size={12} className="inline ml-1.5 text-gray-400 mb-0.5" aria-label="自分だけ" />}
          </p>
          {task.participants.length > 0 && (
            <span
              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ml-2 ${getOwnerTone(task.owner, task.participants)}`}
            >
              {task.participants.join('・')}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center text-xs text-gray-500 mt-1.5 gap-x-3 gap-y-1">
          {showDate && (
            <span className="flex items-center text-blue-600 font-medium">
              <CalendarDays size={12} className="mr-1" />
              {task.targetDate}
            </span>
          )}
          {(task.kind === 'event' || task.startTime !== null) && (
            <span className="flex items-center">
              <Clock size={12} className="mr-1" />
              {formatTimeRange(task.startTime, task.endTime)}
            </span>
          )}
          {task.place && (
            <span className="flex items-center truncate">
              <MapPin size={12} className="mr-1 flex-none" />
              <span className="truncate">{task.place}</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
