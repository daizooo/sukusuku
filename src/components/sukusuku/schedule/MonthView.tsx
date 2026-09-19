'use client';

import type { DynamicTask } from '@/types/app';
import { getLabelColor } from '@/lib/uiUtils';
import {
  WEEKDAY_LABELS,
  addDays,
  getDaysInMonth,
  getFirstDayOfMonth,
  isSameDay,
  startOfWeek,
} from '@/lib/dateUtils';
import { getHolidayName } from '@/lib/japaneseHolidays';
import { getMilestoneLabel } from '@/lib/milestones';
import { tasksOnDate } from './utils';

interface MonthViewProps {
  /** 表示する月（日は問わない）。 */
  month: Date;
  today: Date;
  selectedDate: Date;
  /** ラベルで絞り込み済みの予定。 */
  tasks: DynamicTask[];
  birthDate: string;
  onSelectDate: (date: Date) => void;
  onOpenTask: (task: DynamicTask) => void;
}

// 1マスに出す予定の数。画面の高さに収める必要があるため、狭い画面では2件までにする。
// これを超えたぶんは「+n件」にまとめる。
const CHIPS_NARROW = 2;
const CHIPS_WIDE = 3;

/**
 * 月グリッド。予定はタイトル入りのチップで積み、育児記録はここには出さない
 * （月表示は予定を見渡すための面。記録は日をタップした先で見る）。
 *
 * 高さは親から与えられたぶんを週の数で等分する。画面全体をスクロールさせないため、
 * マスに入りきらない予定は「+n件」に寄せる。
 */
export default function MonthView({
  month,
  today,
  selectedDate,
  tasks,
  birthDate,
  onSelectDate,
  onOpenTask,
}: MonthViewProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  // 前後の月の日も含めて週単位で埋める（週の途中で切らない）。
  const gridStart = startOfWeek(new Date(year, monthIndex, 1));
  const weekCount = Math.ceil((getFirstDayOfMonth(year, monthIndex) + getDaysInMonth(year, monthIndex)) / 7);
  const days = Array.from({ length: weekCount * 7 }, (_, i) => addDays(gridStart, i));

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-100 flex-none">
        {WEEKDAY_LABELS.map((d, i) => (
          <div
            key={d}
            className={`text-center text-[10px] font-medium py-1.5 ${i === 0 ? 'text-red-500' : i === 6 ? 'text-blue-500' : 'text-gray-500'}`}
          >
            {d}
          </div>
        ))}
      </div>

      <div
        className="flex-1 min-h-0 grid grid-cols-7"
        style={{ gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))` }}
      >
        {days.map((date) => {
          const dayTasks = tasksOnDate(tasks, date);
          const isToday = isSameDay(date, today);
          const isSelected = isSameDay(date, selectedDate);
          const isOtherMonth = date.getMonth() !== monthIndex;
          const holiday = getHolidayName(date);
          const milestone = getMilestoneLabel(birthDate, date);

          return (
            <div
              key={date.toISOString()}
              role="button"
              tabIndex={0}
              aria-label={`${date.getMonth() + 1}月${date.getDate()}日${holiday ? ` ${holiday}` : ''} 予定${dayTasks.length}件`}
              onClick={() => onSelectDate(date)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectDate(date);
                }
              }}
              className={`min-w-0 overflow-hidden border-r border-b border-gray-100 [&:nth-child(7n)]:border-r-0 px-1 pt-1 pb-1 text-left cursor-pointer transition ${
                isSelected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-400' : 'hover:bg-gray-50'
              } ${isOtherMonth ? 'bg-gray-50/60' : ''}`}
            >
              <div className="flex items-center justify-center">
                <span
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] leading-none ${
                    isToday
                      ? 'bg-blue-500 text-white font-bold'
                      : isOtherMonth
                        ? 'text-gray-300'
                        : date.getDay() === 0 || holiday
                          ? 'text-red-500'
                          : date.getDay() === 6
                            ? 'text-blue-500'
                            : 'text-gray-700'
                  }`}
                >
                  {date.getDate()}
                </span>
              </div>

              {/* 祝日と節目が重なる日は祝日を出す。1マスの高さに収めるため1行だけにする。 */}
              {!isOtherMonth && (holiday || milestone) && (
                <p
                  className={`text-[8px] leading-tight text-center truncate ${
                    holiday ? 'text-red-500' : 'text-amber-600'
                  }`}
                >
                  {holiday ?? milestone}
                </p>
              )}

              <div className="mt-0.5 space-y-0.5">
                {dayTasks.slice(0, CHIPS_WIDE).map((task, i) => (
                  <button
                    key={task.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenTask(task);
                    }}
                    className={`w-full text-left text-[9px] leading-tight px-1 py-0.5 rounded border truncate ${
                      task.done ? 'bg-gray-100 text-gray-400 border-gray-200 line-through' : getLabelColor(task.label)
                    } ${isOtherMonth ? 'opacity-50' : ''} ${i >= CHIPS_NARROW ? 'hidden md:block' : ''}`}
                  >
                    {task.title}
                  </button>
                ))}
                {dayTasks.length > CHIPS_NARROW && (
                  <p
                    className={`text-[9px] leading-tight text-gray-400 px-1 ${
                      dayTasks.length <= CHIPS_WIDE ? 'md:hidden' : ''
                    }`}
                  >
                    <span className="md:hidden">+{dayTasks.length - CHIPS_NARROW}件</span>
                    {dayTasks.length > CHIPS_WIDE && (
                      <span className="hidden md:inline">+{dayTasks.length - CHIPS_WIDE}件</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
