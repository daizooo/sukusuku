'use client';

import { useState } from 'react';
import { CornerDownRight, Plus } from 'lucide-react';
import type { CareLog, DynamicTask, ScheduleView } from '@/types/app';
import {
  addDays,
  addMonths,
  formatDateHeading,
  isSameMonth,
  startOfDay,
  startOfWeek,
} from '@/lib/dateUtils';
import { expandOccurrences } from '@/lib/scheduleExpand';
import MonthView from '../schedule/MonthView';
import DayView from '../schedule/DayView';
import ListView from '../schedule/ListView';
import ScheduleHeader from '../schedule/ScheduleHeader';
import { byDateThenTime, tasksOnDate } from '../schedule/utils';
import { useSwipeNavigation } from '../ui/useSwipeNavigation';

interface ScheduleTabProps {
  /** 日付を解決した予定。繰り返す予定は元の1件のまま（回への展開はここで行う）。 */
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
  onToggleTodo: (task: DynamicTask) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: (date: Date) => void;
  onOpenLogTab: (date: Date) => void;
}

// リスト（と検索）に、繰り返す予定を何日先まで並べるか。
const FORWARD_DAYS = 366;

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

  // 繰り返す予定を回へ展開する範囲。見ている面ごとに必要な分だけ展開する。
  // - 月: マスに出る範囲（前後の月の日も含めて週単位。最大6週）
  // - 日: 選んでいる日
  // - リスト・検索: 今日から先 FORWARD_DAYS 日。過去の回は期限切れにも
  //   完了済みにも並べない（毎日の予定が過去ぶん全部「期限切れ」になるのを避ける。
  //   過ぎた回は月・日の表示で見返せる）
  // （React Compiler が値の使い回しを見てくれるので、useMemo は使わない）
  const gridStart = startOfWeek(monthStart);
  const monthTodos = expandOccurrences(dynamicTodos, gridStart, addDays(gridStart, 6 * 7 - 1));
  const dayTodos = expandOccurrences(dynamicTodos, selectedDate, selectedDate);
  const forwardTodos = expandOccurrences(dynamicTodos, startOfDay(today), addDays(startOfDay(today), FORWARD_DAYS));

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
      ? `${monthStart.getFullYear()}年${monthStart.getMonth() + 1}月`
      : view === 'day'
        ? formatDateHeading(selectedDate, today)
        : 'リスト';

  // 検索中の文字。null なら検索していない。検索はリストの面で、これからの予定を絞り込む。
  // ブラウザの戻る操作でリストを離れたときも検索をやめた扱いにするため、リスト以外では見ない。
  const [searchInput, setSearchInput] = useState<string | null>(null);
  const searchQuery = view === 'list' ? searchInput : null;

  // 見出しの「月▾」での切り替え。切り替えたら検索はやめる（mobile版と同じ）。
  const changeView = (next: ScheduleView) => {
    setSearchInput(null);
    onChangeView(next);
  };

  // 検索は、タイトル・場所・詳細のどれかに文字を含む予定に絞る（大文字・小文字は区別しない）。
  const normalizedQuery = searchQuery?.trim().toLowerCase() ?? '';
  const listTodos =
    normalizedQuery === ''
      ? forwardTodos
      : forwardTodos.filter((t) =>
          [t.title, t.place, t.note].some((text) => text.toLowerCase().includes(normalizedQuery)),
        );

  const tasksInMonth = monthTodos.filter((t) => t.targetDateObj && isSameMonth(t.targetDateObj, monthStart));

  // 予定のない月をめくり続けなくて済むよう、次に予定がある日へ直接飛べるようにする。
  const nextMonthWithTask = forwardTodos
    .filter((t) => t.targetDateObj && t.targetDateObj >= addMonths(monthStart, 1))
    .sort(byDateThenTime)[0]?.targetDateObj;

  // 矢印ボタンと同じ操作を、画面上どこでの横スワイプでもできるようにする（mobile版と同じ）。
  // 一覧表示（list）には日付送りが無いため、それ以外の表示中だけ有効にする。
  // 指に合わせて横に動くのは、月表示はカレンダー、日表示はその日の中身（見出しは固定）。
  const { handlers: swipeHandlers, attachContent } = useSwipeNavigation({
    onSwipeLeft: () => step(1),
    onSwipeRight: () => step(-1),
    enabled: view !== 'list',
  });

  return (
    <div
      className="relative p-4 h-full flex flex-col md:max-w-3xl lg:max-w-4xl md:mx-auto md:w-full"
      {...swipeHandlers}
    >
      {/* 面は月（初期表示）・日（日をタップ）・リストの3つ。見出しの「月▾」で切り替え、
          ブラウザの戻る操作でも月へ戻る（SukusukuApp が履歴に積んでいる）。 */}
      <ScheduleHeader
        view={view}
        title={title}
        onChangeView={changeView}
        onToday={goToday}
        onStep={step}
        monthStart={monthStart}
        selectedDate={selectedDate}
        onPickMonth={onChangeCalendarDate}
        onPickDate={(date) => selectDate(date, false)}
        searchQuery={searchQuery}
        onChangeSearchQuery={setSearchInput}
        onStartSearch={() => {
          setSearchInput('');
          onChangeView('list');
        }}
        onEndSearch={() => changeView('month')}
      />

      {/* 月表示は、カレンダーを見出しの下の高さいっぱいに出す（画面全体はスクロールさせない）。 */}
      {view === 'month' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div ref={attachContent} className="flex-1 min-h-0">
            <MonthView
              month={monthStart}
              today={today}
              selectedDate={selectedDate}
              tasks={monthTodos}
              birthDate={birthDate}
              onSelectDate={(date) => selectDate(date)}
              onAddTask={onAddTask}
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
        </div>
      )}

      {view === 'day' && (
        <div ref={attachContent} className="flex-1 min-h-0 overflow-y-auto pb-4">
          <DayView
            date={selectedDate}
            today={today}
            tasks={tasksOnDate(dayTodos, selectedDate)}
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
        <div className="flex-1 min-h-0 overflow-y-auto pb-4">
          <ListView
            tasks={listTodos}
            isLoading={isLoadingTodos}
            today={today}
            birthDate={birthDate}
            onToggleTodo={onToggleTodo}
            onOpenTask={onOpenTask}
            emptyMessage={normalizedQuery === '' ? undefined : '見つかりませんでした'}
          />
        </div>
      )}

      {/* 右下の丸い追加ボタン。家計タブのボタンと同じ大きさ・位置（2026-10-13）。 */}
      <button
        type="button"
        aria-label="予定を追加"
        onClick={() => onAddTask(selectedDate)}
        className="absolute bottom-4 right-4 z-10 flex h-16 w-16 items-center justify-center rounded-full bg-pink-500 text-white shadow-lg transition-all hover:bg-pink-600 active:scale-95"
      >
        <Plus size={32} />
      </button>
    </div>
  );
}
