'use client';

import { CalendarDays, ChevronLeft, ChevronRight, CornerDownRight } from 'lucide-react';
import type { CareLog, DynamicTask, ScheduleView } from '@/types/app';
import {
  addDays,
  addMonths,
  formatDateHeading,
  isSameDay,
  isSameMonth,
  parseDateString,
  startOfDay,
  toDateString,
} from '@/lib/dateUtils';
import MonthView from '../schedule/MonthView';
import DayView from '../schedule/DayView';
import ListView from '../schedule/ListView';
import UpcomingTasks from '../schedule/UpcomingTasks';
import { byDateThenTime, tasksOnDate } from '../schedule/utils';

interface ScheduleTabProps {
  dynamicTodos: DynamicTask[];
  isLoadingTodos?: boolean;
  today: Date;
  /** 節目・月齢の表示に使う。未登録なら空文字。 */
  birthDate: string;
  view: ScheduleView;
  onChangeView: (view: ScheduleView) => void;
  /** 日表示の対象日。月表示では選択中の日。 */
  selectedDate: Date;
  onChangeSelectedDate: (date: Date) => void;
  /** 月グリッドで表示中の月。 */
  currentCalendarDate: Date;
  onChangeCalendarDate: (date: Date) => void;
  /** 日表示で表示中の範囲の育児記録。 */
  careLogs: CareLog[];
  isLoadingCareLogs?: boolean;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: (date: Date) => void;
  onOpenLogTab: (date: Date) => void;
}

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
    selectDate(addDays(selectedDate, delta), false);
  };

  const goToday = () => {
    onChangeCalendarDate(new Date(today.getFullYear(), today.getMonth(), 1));
    onChangeSelectedDate(today);
  };

  const title =
    view === 'month'
      ? `${monthStart.getFullYear()}年 ${monthStart.getMonth() + 1}月`
      : formatDateHeading(selectedDate, today);

  const isShowingToday = view === 'month' ? isSameMonth(monthStart, today) : isSameDay(selectedDate, today);

  const tasksInMonth = dynamicTodos.filter((t) => t.targetDateObj && isSameMonth(t.targetDateObj, monthStart));

  // 予定のない月をめくり続けなくて済むよう、次に予定がある日へ直接飛べるようにする。
  const nextMonthWithTask = dynamicTodos
    .filter((t) => t.targetDateObj && t.targetDateObj >= addMonths(monthStart, 1))
    .sort(byDateThenTime)[0]?.targetDateObj;

  return (
    <div className="p-4 h-full flex flex-col md:max-w-3xl lg:max-w-4xl md:mx-auto md:w-full">
      {/* 面は月（初期表示）・日（日をタップ）・リスト（「直近のスケジュール」の見出しをタップ）の3つ。
          月以外（日・リスト）では、戻るボタンだけを左上に出す（文言は付けない）。
          ブラウザの戻る操作も同じく月へ戻る（SukusukuApp が履歴に積んでいる）。 */}
      {view !== 'month' && (
        <button
          onClick={() => onChangeView('month')}
          aria-label="戻る"
          className="flex-none self-start mb-2 -ml-1 p-1 text-blue-600"
        >
          <ChevronLeft size={24} />
        </button>
      )}

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

      {/* 月表示は、カレンダーの下に「直近のスケジュール」を並べる。高さは 5:3 で分け、
          どちらも画面全体はスクロールさせない。 */}
      {view === 'month' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="flex-[5] min-h-0">
            <MonthView
              month={monthStart}
              today={today}
              selectedDate={selectedDate}
              tasks={dynamicTodos}
              birthDate={birthDate}
              onSelectDate={(date) => selectDate(date)}
              onOpenTask={onOpenTask}
            />
          </div>
          {!isLoadingTodos && tasksInMonth.length === 0 && nextMonthWithTask && (
            <button
              onClick={() => onChangeCalendarDate(new Date(nextMonthWithTask.getFullYear(), nextMonthWithTask.getMonth(), 1))}
              className="flex-none w-full mt-2 py-2 text-sm text-blue-600 font-medium bg-white rounded-xl border border-gray-100 shadow-sm flex items-center justify-center"
            >
              <CornerDownRight size={14} className="mr-1.5" />
              次に予定がある月へ ({nextMonthWithTask.getFullYear()}年{nextMonthWithTask.getMonth() + 1}月)
            </button>
          )}
          <div className="flex-[3] min-h-0 mt-3">
            <UpcomingTasks
              tasks={dynamicTodos}
              isLoading={isLoadingTodos}
              today={today}
              onToggleTodo={onToggleTodo}
              onOpenTask={onOpenTask}
              onAddTask={() => onAddTask(selectedDate)}
              onShowAll={() => onChangeView('list')}
            />
          </div>
        </div>
      )}

      {view === 'day' && (
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">
          <DayView
            date={selectedDate}
            today={today}
            tasks={tasksOnDate(dynamicTodos, selectedDate)}
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
            tasks={dynamicTodos}
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
