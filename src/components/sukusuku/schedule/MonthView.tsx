'use client';

import { useEffect, useRef, useState } from 'react';
import type { DynamicTask } from '@/types/app';
import { getOwnerTone, getSplitSegments } from '@/lib/uiUtils';
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
  /** 参加者で絞り込み済みの予定。 */
  tasks: DynamicTask[];
  birthDate: string;
  /** 日付の数字を押したとき。その日の日表示へ移る。 */
  onSelectDate: (date: Date) => void;
  /** マスの予定が無いところを押したとき。その日を初期値にした予定の追加を開く。 */
  onAddTask: (date: Date) => void;
  onOpenTask: (task: DynamicTask) => void;
}

// 1マスに出す予定の数。狭い画面では2件まで、広い画面では3件まで。
// これを超えたぶんは「+n件」にまとめる。
const CHIPS_NARROW = 2;
const CHIPS_WIDE = 3;
const WIDE_GRID_PX = 640;

// マスの高さは画面と週の数で変わる（下に「直近のスケジュール」が並ぶぶん低い）ので、
// 上の件数が入らないときは件数を減らして「+n件」に寄せる（mobile版の chipsThatFit と同じ考え方）。
// 下の値は className の実寸の見積もり（余白・枠を含む）。className を変えたら合わせる。
const CELL_CHROME = 9; // マスの上下の余白と枠
const DATE_HEIGHT = 22; // 日付の丸（下の余白を含む）
const LABEL_HEIGHT = 10; // 祝日・節目の行
const CHIP_HEIGHT = 17;
const MORE_HEIGHT = 11;
const CHIP_GAP = 2;

/** 予定が total 件あるマスで、予定へ回せる高さ room に何件のチップを出せるか。 */
const chipsThatFit = (total: number, room: number, limitChips: number): number => {
  const stack = (n: number) => n * CHIP_HEIGHT + Math.max(n - 1, 0) * CHIP_GAP;
  const limit = Math.min(total, limitChips);
  // 全部出せるなら「+n件」は要らない（上限を超える分だけは「+n件」が必要）。
  if (total <= limitChips && stack(total) <= room) return total;
  for (let n = limit; n > 0; n -= 1) {
    if (stack(n) + CHIP_GAP + MORE_HEIGHT <= room) return n;
  }
  return 0;
};

/** 要素の大きさを追う。最初の計測が済むまでは null。 */
const useElementSize = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
};

/**
 * 月グリッド。予定はタイトル入りのチップで積み、育児記録はここには出さない
 * （月表示は予定を見渡すための面。記録は日をタップした先で見る）。
 *
 * 高さは親から与えられたぶんを週の数で等分する。画面全体をスクロールさせないため、
 * マスに入りきらない予定は「+n件」に寄せる。
 *
 * 押したところで動きが分かれる（Googleカレンダーと同じ）:
 * - 日付の数字 → その日の日表示
 * - 予定のチップ → 予定の詳細
 * - それ以外のマスの中（予定の無いところ） → その日の予定・タスクの追加
 * 手触りはGoogleカレンダーと同じく、予定と空きで逆にする:
 * - 予定のチップ・日付の数字 → カーソルが指の形になり、合わせる・押している間は色が濃くなる
 * - 予定の無いマスの中 → カーソルは矢印のまま、色も変えない（押すと追加が開く）
 * （mobile版は触れている間の色だけ。チップと日付の数字だけが変わり、空きは変わらない）
 */
export default function MonthView({
  month,
  today,
  selectedDate,
  tasks,
  birthDate,
  onSelectDate,
  onAddTask,
  onOpenTask,
}: MonthViewProps) {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();

  // 前後の月の日も含めて週単位で埋める（週の途中で切らない）。
  const gridStart = startOfWeek(new Date(year, monthIndex, 1));
  const weekCount = Math.ceil((getFirstDayOfMonth(year, monthIndex) + getDaysInMonth(year, monthIndex)) / 7);
  const days = Array.from({ length: weekCount * 7 }, (_, i) => addDays(gridStart, i));

  const { ref: gridRef, size: gridSize } = useElementSize();
  const rowHeight = gridSize ? gridSize.height / weekCount : null;
  const limitChips = gridSize && gridSize.width >= WIDE_GRID_PX ? CHIPS_WIDE : CHIPS_NARROW;

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
        ref={gridRef}
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
          const hasLabel = !isOtherMonth && (holiday !== null || milestone !== null);
          const shownChips =
            rowHeight === null
              ? limitChips
              : chipsThatFit(
                  dayTasks.length,
                  rowHeight - CELL_CHROME - DATE_HEIGHT - (hasLabel ? LABEL_HEIGHT : 0) - CHIP_GAP,
                  limitChips,
                );

          return (
            <div
              key={date.toISOString()}
              role="button"
              tabIndex={0}
              aria-label={`${date.getMonth() + 1}月${date.getDate()}日${holiday ? ` ${holiday}` : ''} 予定${dayTasks.length}件 押すと予定を追加`}
              onClick={() => onAddTask(date)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onAddTask(date);
                }
              }}
              className={`min-w-0 overflow-hidden border-r border-b border-gray-100 [&:nth-child(7n)]:border-r-0 px-1 pt-1 pb-1 text-left cursor-default ${
                isSelected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-400' : ''
              } ${isOtherMonth ? 'bg-gray-50/60' : ''}`}
            >
              <div className="flex items-center justify-center">
                <button
                  type="button"
                  aria-label={`${date.getMonth() + 1}月${date.getDate()}日の予定を見る`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectDate(date);
                  }}
                  className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] leading-none cursor-pointer transition ${
                    isToday
                      ? 'bg-blue-500 text-white font-bold hover:bg-blue-600 active:bg-blue-700'
                      : isOtherMonth
                        ? 'text-gray-300'
                        : date.getDay() === 0 || holiday
                          ? 'text-red-500'
                          : date.getDay() === 6
                            ? 'text-blue-500'
                            : 'text-gray-700'
                  } ${isToday ? '' : 'hover:bg-gray-200 active:bg-gray-300'}`}
                >
                  {date.getDate()}
                </button>
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
                {dayTasks.slice(0, shownChips).map((task) => {
                  // 2人以上が参加する予定は、帯を参加者の色で等分する（完了したものは灰のまま）。
                  const split = task.done ? null : getSplitSegments(task.participants);
                  return (
                    <button
                      key={task.occurrenceKey}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenTask(task);
                      }}
                      // カーソルを指の形にし、合わせる・押している間は色を濃くして、触った感を出す。
                      // （空きのマスは逆に、カーソルも色も変えない）
                      className={`relative w-full text-left text-[9px] leading-tight px-1 py-0.5 rounded border truncate cursor-pointer transition hover:brightness-90 active:brightness-75 ${
                        task.done
                          ? 'bg-gray-100 text-gray-400 border-gray-200 line-through'
                          : split
                            ? 'overflow-hidden text-gray-800 border-gray-200'
                            : getOwnerTone(task.owner, task.participants)
                      } ${isOtherMonth ? 'opacity-50' : ''}`}
                    >
                      {split && (
                        <span aria-hidden className="absolute inset-0 flex">
                          {split.map((segment, i) => (
                            <span key={i} className={`flex-1 ${segment}`} />
                          ))}
                        </span>
                      )}
                      <span className="relative">{task.title}</span>
                    </button>
                  );
                })}
                {dayTasks.length > shownChips && (
                  <p className="text-[9px] leading-tight text-gray-400 px-1">+{dayTasks.length - shownChips}件</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
