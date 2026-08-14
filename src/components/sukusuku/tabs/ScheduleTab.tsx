'use client';

import { useState } from 'react';
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Filter,
  List,
  MapPin,
} from 'lucide-react';
import type { DynamicTask, Label } from '@/types/app';
import { LABELS } from '@/types/app';
import { getLabelColor, getLabelDotColor } from '@/lib/uiUtils';
import {
  formatDateWithWeekday,
  formatTimeRange,
  getDaysInMonth,
  getFirstDayOfMonth,
  isSameDay,
  startOfDay,
} from '@/lib/dateUtils';

interface ScheduleTabProps {
  dynamicTodos: DynamicTask[];
  isLoadingTodos?: boolean;
  today: Date;
  currentCalendarDate: Date;
  onChangeCalendarDate: (date: Date) => void;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
}

const LABEL_FILTERS: (Label | 'すべて')[] = ['すべて', ...LABELS];

// 時刻の早い順。終日は先頭に置く。
const byTime = (a: DynamicTask, b: DynamicTask) => {
  if (!a.startTime && !b.startTime) return 0;
  if (!a.startTime) return -1;
  if (!b.startTime) return 1;
  return a.startTime.localeCompare(b.startTime);
};

const byDateThenTime = (a: DynamicTask, b: DynamicTask) => {
  const at = a.targetDateObj?.getTime() ?? Infinity;
  const bt = b.targetDateObj?.getTime() ?? Infinity;
  if (at !== bt) return at - bt;
  return byTime(a, b);
};

// 月カレンダーのマス目。先頭は月初の曜日ぶんだけ空白を入れる。
const buildMonthGrid = (year: number, month: number): (Date | null)[] => {
  const leading: (Date | null)[] = Array.from({ length: getFirstDayOfMonth(year, month) }, () => null);
  const dates = Array.from(
    { length: getDaysInMonth(year, month) },
    (_, i) => new Date(year, month, i + 1),
  );
  return [...leading, ...dates];
};

export default function ScheduleTab({
  dynamicTodos,
  isLoadingTodos,
  today,
  currentCalendarDate,
  onChangeCalendarDate,
  onToggleTodo,
  onOpenTask,
}: ScheduleTabProps) {
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');
  const [labelFilter, setLabelFilter] = useState<Label | 'すべて'>('すべて');
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(today));

  const filteredTodos = dynamicTodos.filter((t) => labelFilter === 'すべて' || t.label === labelFilter);

  const year = currentCalendarDate.getFullYear();
  const month = currentCalendarDate.getMonth();

  const days = buildMonthGrid(year, month);

  const tasksInMonth = filteredTodos.filter(
    (t) =>
      t.targetDateObj &&
      t.targetDateObj.getFullYear() === year &&
      t.targetDateObj.getMonth() === month,
  );

  const tasksOnSelectedDate = tasksInMonth
    .filter((t) => isSameDay(t.targetDateObj, selectedDate))
    .sort(byTime);

  const changeMonth = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    onChangeCalendarDate(next);
    // 月を移動したら、その月の1日を選択日にする（今月に戻ったときは今日）
    setSelectedDate(
      next.getFullYear() === today.getFullYear() && next.getMonth() === today.getMonth()
        ? startOfDay(today)
        : next,
    );
  };

  // 日付未設定（誕生日が未登録の出生日基準の予定）
  const undatedTasks = filteredTodos.filter((t) => !t.targetDateObj);

  return (
    <div className="p-4 h-full flex flex-col md:max-w-2xl lg:max-w-3xl md:mx-auto md:w-full">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-xl font-bold text-gray-800">スケジュール</h2>
        <div className="flex bg-gray-200 p-1 rounded-lg">
          <button
            onClick={() => setViewMode('list')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center transition ${viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            <List size={14} className="mr-1" /> リスト
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md flex items-center transition ${viewMode === 'calendar' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'}`}
          >
            <CalendarDays size={14} className="mr-1" /> カレンダー
          </button>
        </div>
      </div>

      <div className="flex space-x-2 mb-4 overflow-x-auto pb-2 flex-none">
        <span className="flex items-center text-gray-500 text-xs font-medium mr-1">
          <Filter size={14} />
        </span>
        {LABEL_FILTERS.map((a) => (
          <button
            key={a}
            onClick={() => setLabelFilter(a)}
            className={`px-3 py-1.5 rounded-full text-xs whitespace-nowrap font-medium transition border ${
              labelFilter === a
                ? a === 'すべて'
                  ? 'bg-gray-700 text-white border-gray-700'
                  : getLabelColor(a)
                : 'bg-white text-gray-600 border-gray-200'
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {viewMode === 'list' ? (
        <div className="flex-1 overflow-y-auto space-y-3 pb-6">
          {isLoadingTodos && <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>}
          {!isLoadingTodos && filteredTodos.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">予定はまだありません</p>
          )}
          {[...filteredTodos].sort(byDateThenTime).map((task) => (
            <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} showDate />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between mb-3 bg-white p-2 rounded-xl shadow-sm border border-gray-100 flex-none">
            <button onClick={() => changeMonth(-1)} className="p-2 text-gray-600" aria-label="前の月">
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-base font-bold text-gray-800">
              {year}年 {month + 1}月
            </h3>
            <button onClick={() => changeMonth(1)} className="p-2 text-gray-600" aria-label="次の月">
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 mb-3 flex-none">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                <div
                  key={d}
                  className={`text-center text-[10px] font-medium ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}
                >
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1 gap-x-1">
              {days.map((date, idx) => {
                if (!date) return <div key={`empty-${idx}`} className="h-12" />;
                const dayTasks = tasksInMonth.filter((t) => isSameDay(t.targetDateObj, date)).sort(byTime);
                const isToday = isSameDay(date, today);
                const isSelected = isSameDay(date, selectedDate);
                return (
                  <button
                    key={date.toISOString()}
                    onClick={() => setSelectedDate(date)}
                    className={`flex flex-col items-center justify-start pt-1 rounded-lg h-12 transition ${
                      isSelected ? 'bg-blue-500 text-white shadow-sm' : isToday ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <span
                      className={`text-xs ${
                        isSelected ? 'font-bold' : isToday ? 'text-blue-700 font-bold' : 'text-gray-700'
                      }`}
                    >
                      {date.getDate()}
                    </span>
                    {dayTasks.length > 0 && (
                      <div className="flex items-center space-x-0.5 mt-1">
                        {dayTasks.slice(0, 3).map((t) => (
                          <div
                            key={t.id}
                            className={`w-1.5 h-1.5 rounded-full ${
                              isSelected ? 'bg-white/90' : t.done ? 'bg-gray-300' : getLabelDotColor(t.label)
                            }`}
                          />
                        ))}
                        {dayTasks.length > 3 && (
                          <span className={`text-[8px] leading-none ${isSelected ? 'text-white/90' : 'text-gray-400'}`}>
                            +{dayTasks.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pb-4">
            <h4 className="text-xs font-bold text-gray-500 mb-2 px-1">
              {formatDateWithWeekday(selectedDate)} の予定 ({tasksOnSelectedDate.length}件)
            </h4>
            {tasksOnSelectedDate.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">予定はありません</p>
            ) : (
              <div className="space-y-2">
                {tasksOnSelectedDate.map((task) => (
                  <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
                ))}
              </div>
            )}

            {undatedTasks.length > 0 && (
              <div className="mt-5">
                <h4 className="text-xs font-bold text-gray-500 mb-2 px-1">
                  日付未定 ({undatedTasks.length}件)
                </h4>
                <p className="text-[11px] text-gray-400 mb-2 px-1 leading-relaxed">
                  お子様の誕生日を設定タブで登録すると、カレンダーに表示されます。
                </p>
                <div className="space-y-2">
                  {undatedTasks.map((task) => (
                    <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface TaskRowProps {
  task: DynamicTask;
  onToggle: (id: string) => void;
  onOpen: (task: DynamicTask) => void;
  showDate?: boolean;
}

function TaskRow({ task, onToggle, onOpen, showDate }: TaskRowProps) {
  return (
    <div
      className="bg-white p-3 rounded-xl shadow-sm border border-gray-100 flex items-start space-x-3 cursor-pointer hover:bg-gray-50 transition"
      onClick={() => onOpen(task)}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle(task.id);
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
            {task.remindMinutesBefore !== null && !task.done && (
              <BellRing size={12} className="inline ml-1.5 text-yellow-500 mb-0.5" />
            )}
          </p>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ml-2 ${getLabelColor(task.label)}`}>
            {task.label}
          </span>
        </div>
        <div className="flex flex-wrap items-center text-xs text-gray-500 mt-1.5 gap-x-3 gap-y-1">
          {showDate && (
            <span className="flex items-center text-blue-600 font-medium">
              <CalendarDays size={12} className="mr-1" />
              {task.targetDate}
            </span>
          )}
          <span className="flex items-center">
            <Clock size={12} className="mr-1" />
            {formatTimeRange(task.startTime, task.endTime)}
          </span>
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
