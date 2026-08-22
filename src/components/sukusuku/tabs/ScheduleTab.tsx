'use client';

import { useState } from 'react';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CornerDownRight, Filter } from 'lucide-react';
import type { CareLog, DynamicTask, Label, ScheduleView } from '@/types/app';
import { LABELS } from '@/types/app';
import { getLabelColor } from '@/lib/uiUtils';
import {
  addDays,
  addMonths,
  formatDateHeading,
  isSameDay,
  isSameMonth,
  parseDateString,
  startOfDay,
  startOfWeek,
  toDateString,
} from '@/lib/dateUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import MonthView from '../schedule/MonthView';
import WeekView from '../schedule/WeekView';
import DayView from '../schedule/DayView';
import ListView from '../schedule/ListView';
import { byDateThenTime, tasksOnDate } from '../schedule/utils';

interface ScheduleTabProps {
  dynamicTodos: DynamicTask[];
  isLoadingTodos?: boolean;
  today: Date;
  /** 節目・月齢の表示に使う。未登録なら空文字。 */
  birthDate: string;
  view: ScheduleView;
  onChangeView: (view: ScheduleView) => void;
  /** 週表示・日表示の対象日。月表示では選択中の日。 */
  selectedDate: Date;
  onChangeSelectedDate: (date: Date) => void;
  /** 月グリッドで表示中の月。 */
  currentCalendarDate: Date;
  onChangeCalendarDate: (date: Date) => void;
  /** 週表示・日表示で表示中の範囲の育児記録。 */
  careLogs: CareLog[];
  isLoadingCareLogs?: boolean;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: (date: Date) => void;
  onOpenLogTab: (date: Date) => void;
}

const LABEL_FILTERS: (Label | 'すべて')[] = ['すべて', ...LABELS];

const VIEW_TABS: { id: ScheduleView; label: string }[] = [
  { id: 'month', label: '月' },
  { id: 'week', label: '週' },
  { id: 'day', label: '日' },
  { id: 'list', label: 'リスト' },
];

const formatShortDate = (date: Date): string => `${date.getMonth() + 1}月${date.getDate()}日`;

export default function ScheduleTab({
  dynamicTodos,
  isLoadingTodos,
  today,
  birthDate,
  view,
  onChangeView,
  selectedDate,
  onChangeSelectedDate,
  currentCalendarDate,
  onChangeCalendarDate,
  careLogs,
  isLoadingCareLogs,
  onToggleTodo,
  onOpenTask,
  onAddTask,
  onOpenLogTab,
}: ScheduleTabProps) {
  const [labelFilter, setLabelFilter] = useState<Label | 'すべて'>('すべて');

  const filteredTodos = dynamicTodos.filter((t) => labelFilter === 'すべて' || t.label === labelFilter);

  const weekStart = startOfWeek(selectedDate);
  const monthStart = new Date(currentCalendarDate.getFullYear(), currentCalendarDate.getMonth(), 1);

  // 日を選ぶと日表示へ移る（月・週は俯瞰、日は詳細という役割分担）。
  const selectDate = (date: Date, openDayView = true) => {
    const day = startOfDay(date);
    onChangeSelectedDate(day);
    if (!isSameMonth(day, currentCalendarDate)) {
      onChangeCalendarDate(new Date(day.getFullYear(), day.getMonth(), 1));
    }
    if (openDayView) onChangeView('day');
  };

  const step = (delta: number) => {
    if (view === 'month') {
      onChangeCalendarDate(addMonths(monthStart, delta));
      return;
    }
    selectDate(addDays(selectedDate, view === 'week' ? delta * 7 : delta), false);
  };

  const goToday = () => {
    onChangeCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
    onChangeSelectedDate(today);
  };

  const title =
    view === 'month'
      ? `${monthStart.getFullYear()}年 ${monthStart.getMonth() + 1}月`
      : view === 'week'
        ? `${formatShortDate(weekStart)} - ${formatShortDate(addDays(weekStart, 6))}`
        : formatDateHeading(selectedDate, today);

  const isShowingToday =
    view === 'month' ? isSameMonth(monthStart, today) : view === 'week' ? isSameDay(weekStart, startOfWeek(today)) : isSameDay(selectedDate, today);

  const tasksInMonth = filteredTodos.filter((t) => t.targetDateObj && isSameMonth(t.targetDateObj, monthStart));

  // 予定のない月をめくり続けなくて済むよう、次に予定がある日へ直接飛べるようにする。
  const nextMonthWithTask = filteredTodos
    .filter((t) => t.targetDateObj && t.targetDateObj >= addMonths(monthStart, 1))
    .sort(byDateThenTime)[0]?.targetDateObj;

  return (
    <div className="p-4 h-full flex flex-col md:max-w-3xl lg:max-w-4xl md:mx-auto md:w-full">
      {/* 表示の切り替えと担当の絞り込みは同じ1段に置く（スマホで縦の高さを予定表に回すため）。
          絞り込みは選択肢が増えても幅が変わらないよう、横並びのボタンではなく選択にしている。 */}
      <div className="flex items-center gap-2 mb-3 flex-none">
        <SegmentedTabs
          ariaLabel="スケジュールの表示"
          value={view}
          onChange={onChangeView}
          options={VIEW_TABS}
          fill={false}
          className="flex-none"
        />
        <div className="relative flex-none ml-auto">
          <select
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value as Label | 'すべて')}
            aria-label="担当で絞り込む"
            className={`appearance-none h-11 pl-8 pr-7 rounded-xl border text-sm font-bold transition ${
              labelFilter === 'すべて' ? 'bg-white text-gray-700 border-gray-200' : getLabelColor(labelFilter)
            }`}
          >
            {LABEL_FILTERS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Filter size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 opacity-70" />
          <ChevronDown size={14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 opacity-70" />
        </div>
      </div>

      {view !== 'list' && (
        <div className="flex items-center justify-between mb-3 bg-white p-2 rounded-xl shadow-sm border border-gray-100 flex-none">
          <button onClick={() => step(-1)} className="p-2 text-gray-600" aria-label="前へ">
            <ChevronLeft size={20} />
          </button>

          <div className="flex items-center gap-1">
            <h3 className="text-[17px] font-bold text-gray-900">{title}</h3>
            {/* ネイティブのピッカーで任意の月・日へ直接ジャンプする */}
            <span className="relative w-7 h-7 inline-flex items-center justify-center rounded-full text-gray-400 hover:text-blue-500 hover:bg-gray-100 transition">
              <CalendarDays size={16} />
              {view === 'month' ? (
                <input
                  type="month"
                  aria-label="月を選ぶ"
                  value={`${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`}
                  onChange={(e) => {
                    const picked = parseDateString(`${e.target.value}-01`);
                    if (picked) onChangeCalendarDate(picked);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              ) : (
                <input
                  type="date"
                  aria-label="日付を選ぶ"
                  value={toDateString(selectedDate)}
                  onChange={(e) => {
                    const picked = parseDateString(e.target.value);
                    if (picked) selectDate(picked, false);
                  }}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              )}
            </span>
            {!isShowingToday && (
              <button
                onClick={goToday}
                className="ml-1 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-md hover:bg-blue-100 transition"
              >
                今日
              </button>
            )}
          </div>

          <button onClick={() => step(1)} className="p-2 text-gray-600" aria-label="次へ">
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {view === 'month' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <MonthView
            month={monthStart}
            today={today}
            selectedDate={selectedDate}
            tasks={filteredTodos}
            birthDate={birthDate}
            onSelectDate={(date) => selectDate(date)}
            onOpenTask={onOpenTask}
          />
          {!isLoadingTodos && tasksInMonth.length === 0 && nextMonthWithTask && (
            <button
              onClick={() => onChangeCalendarDate(new Date(nextMonthWithTask.getFullYear(), nextMonthWithTask.getMonth(), 1))}
              className="flex-none w-full mt-3 py-2.5 text-sm text-blue-600 font-medium bg-white rounded-xl border border-gray-100 shadow-sm flex items-center justify-center"
            >
              <CornerDownRight size={14} className="mr-1.5" />
              次に予定がある月へ ({nextMonthWithTask.getFullYear()}年{nextMonthWithTask.getMonth() + 1}月)
            </button>
          )}
        </div>
      )}

      {view === 'week' && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">
          <WeekView
            date={selectedDate}
            today={today}
            tasks={filteredTodos}
            birthDate={birthDate}
            careLogs={careLogs}
            isLoadingCareLogs={isLoadingCareLogs}
            onSelectDate={(date) => selectDate(date)}
            onToggleTodo={onToggleTodo}
            onOpenTask={onOpenTask}
          />
        </div>
      )}

      {view === 'day' && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">
          <DayView
            date={selectedDate}
            today={today}
            tasks={tasksOnDate(filteredTodos, selectedDate)}
            birthDate={birthDate}
            careLogs={careLogs}
            isLoadingCareLogs={isLoadingCareLogs}
            onToggleTodo={onToggleTodo}
            onOpenTask={onOpenTask}
            onAddTask={onAddTask}
            onOpenLogTab={onOpenLogTab}
          />
        </div>
      )}

      {view === 'list' && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">
          <ListView
            tasks={filteredTodos}
            isLoading={isLoadingTodos}
            today={today}
            birthDate={birthDate}
            onToggleTodo={onToggleTodo}
            onOpenTask={onOpenTask}
          />
        </div>
      )}
    </div>
  );
}
