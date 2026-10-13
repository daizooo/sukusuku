'use client';

import { useEffect, useRef, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { DynamicTask } from '@/types/app';
import { getTaskTone } from '@/lib/uiUtils';
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

// 1マスに出す予定の数の上限（mobile版と同じ）。これを超えたぶんは「他n件」にまとめる。
const CHIPS = 4;
// これより広いグリッドでは、予定の帯を少し大きくする（時刻・週番号は出さない。mobile版と同じ）。
const WIDE_GRID_PX = 640;

// マスの高さは画面と週の数で変わるので、上の件数が入らないときは件数を減らして
// 「他n件」に寄せる（mobile版の chipsThatFit と同じ考え方）。
// 下の値は className の実寸の見積もり（余白・枠を含む）。className を変えたら合わせる。
const CELL_CHROME = 9; // マスの上下の余白と枠
const WEEKDAY_HEIGHT = 12; // 1週目のマスの頭の曜日
const DATE_HEIGHT = 22; // 日付の丸（下の余白を含む）
const LABEL_HEIGHT = 10; // 祝日・節目の行
const CHIP_HEIGHT_NARROW = 15; // 予定1行（帯）
const CHIP_HEIGHT_WIDE = 18;
const MORE_HEIGHT = 12;
const CHIP_GAP = 2;

/** 予定が total 件あるマスで、予定へ回せる高さ room に何件のチップを出せるか。 */
const chipsThatFit = (total: number, room: number, chipHeight: number): number => {
  const stack = (n: number) => n * chipHeight + Math.max(n - 1, 0) * CHIP_GAP;
  const limit = Math.min(total, CHIPS);
  // 全部出せるなら「他n件」は要らない（上限を超える分だけは「他n件」が必要）。
  if (total <= CHIPS && stack(total) <= room) return total;
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
 * 月グリッド。Googleカレンダーの月表示にならい、予定は1行ずつ色付きの帯にして積む
 * （mobile版の MonthView と同じ）:
 * - 予定: 主体の色の帯（淡い地に濃い文字）
 * - タスク: 灰の帯に灰のチェックの丸（docs/calendar.md §1）
 * - 完了: 薄い灰の帯に取り消し線
 * 曜日は1週目のマスの頭に出し、月の初日も他の日と同じく日付の数字だけ（月は見出しに出ている）。
 * 日曜・祝日は赤、土曜は青（曜日の文字も同じ）。今日だけ青い丸に白、前後の月の日は薄い灰。
 * 育児記録はここには出さない（月表示は予定を見渡すための面。記録は日をタップした先で見る）。
 *
 * 高さは親から与えられたぶんを週の数で等分する。画面全体をスクロールさせないため、
 * マスに入りきらない予定は「他n件」に寄せる。
 *
 * 押したところで動きが分かれる（Googleカレンダーと同じ）:
 * - 日付の数字 → その日の日表示
 * - 予定の行 → 予定の詳細
 * - それ以外のマスの中（予定の無いところ） → その日の予定・タスクの追加
 * 手触りはGoogleカレンダーと同じく、予定と空きで逆にする:
 * - 予定の行・日付の数字 → カーソルが指の形になり、合わせる・押している間は地の色が付く
 * - 予定の無いマスの中 → カーソルは矢印のまま、色も変えない（押すと追加が開く）
 * （mobile版は触れている間の色だけ。予定の行と日付の数字だけが変わり、空きは変わらない）
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
  const weeks = Array.from({ length: weekCount }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
  );

  const { ref: gridRef, size: gridSize } = useElementSize();
  const rowHeight = gridSize ? gridSize.height / weekCount : null;
  const isWide = gridSize !== null && gridSize.width >= WIDE_GRID_PX;
  const chipHeight = isWide ? CHIP_HEIGHT_WIDE : CHIP_HEIGHT_NARROW;

  return (
    <div className="h-full flex flex-col bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div
        ref={gridRef}
        className="flex-1 min-h-0 grid"
        // 列も minmax(0, 1fr) にする。auto のままだと帯の文字（折り返さない）の幅で週が広がり、右の列がはみ出す。
        style={{
          gridTemplateRows: `repeat(${weekCount}, minmax(0, 1fr))`,
          gridTemplateColumns: 'minmax(0, 1fr)',
        }}
      >
        {weeks.map((week, w) => (
          <div key={w} className="min-h-0 min-w-0 flex border-b border-gray-100 last:border-b-0">
            {week.map((date, columnIndex) => {
              const dayTasks = tasksOnDate(tasks, date);
              const isToday = isSameDay(date, today);
              const isSelected = isSameDay(date, selectedDate);
              const isOtherMonth = date.getMonth() !== monthIndex;
              const holiday = getHolidayName(date);
              const milestone = getMilestoneLabel(birthDate, date);
              const hasLabel = !isOtherMonth && (holiday !== null || milestone !== null);
              const shownChips =
                rowHeight === null
                  ? CHIPS
                  : chipsThatFit(
                      dayTasks.length,
                      rowHeight -
                        CELL_CHROME -
                        (w === 0 ? WEEKDAY_HEIGHT : 0) -
                        DATE_HEIGHT -
                        (hasLabel ? LABEL_HEIGHT : 0) -
                        CHIP_GAP,
                      chipHeight,
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
                  className={`flex-1 min-w-0 overflow-hidden px-0.5 pt-1 pb-1 text-left cursor-default ${
                    columnIndex === 6 ? '' : 'border-r border-gray-100'
                  } ${isSelected ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-400' : ''}`}
                >
                  {w === 0 && (
                    <p
                      className={`h-3 text-[9px] leading-3 text-center font-bold ${
                        columnIndex === 0 ? 'text-red-500' : columnIndex === 6 ? 'text-blue-500' : 'text-gray-500'
                      }`}
                    >
                      {WEEKDAY_LABELS[columnIndex]}
                    </p>
                  )}
                  <div className="flex items-center justify-center">
                    <button
                      type="button"
                      aria-label={`${date.getMonth() + 1}月${date.getDate()}日の予定を見る`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectDate(date);
                      }}
                      className={`inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full text-[11px] leading-none font-bold cursor-pointer transition ${
                        isToday
                          ? 'bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700'
                          : `${
                              isOtherMonth
                                ? 'text-gray-400'
                                : date.getDay() === 0 || holiday
                                  ? 'text-red-500'
                                  : date.getDay() === 6
                                    ? 'text-blue-500'
                                    : 'text-gray-900'
                            } hover:bg-gray-200 active:bg-gray-300`
                      }`}
                    >
                      {date.getDate()}
                    </button>
                  </div>

                  {/* 祝日と節目が重なる日は祝日を出す。1マスの高さに収めるため1行だけにする。 */}
                  {hasLabel && (
                    <p
                      className={`text-[8px] leading-tight text-center truncate ${
                        holiday ? 'text-red-500' : 'text-amber-600'
                      }`}
                    >
                      {holiday ?? milestone}
                    </p>
                  )}

                  <div className="mt-0.5 space-y-0.5">
                    {dayTasks.slice(0, shownChips).map((task) => (
                      <button
                        key={task.occurrenceKey}
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenTask(task);
                        }}
                        // カーソルを指の形にし、合わせる・押している間は帯を薄くして、触った感を出す。
                        // （空きのマスは逆に、カーソルも色も変えない）
                        className={`w-full flex items-center gap-0.5 md:gap-1 rounded px-[3px] md:px-1 text-left whitespace-nowrap overflow-hidden cursor-pointer transition hover:opacity-80 active:opacity-60 ${
                          task.done ? 'bg-gray-100 text-gray-400' : getTaskTone(task)
                        } ${isWide ? 'h-[18px] text-xs' : 'h-[15px] text-[9px]'} ${isOtherMonth ? 'opacity-50' : ''}`}
                      >
                        {task.kind === 'task' && (
                          <CheckCircle2 size={isWide ? 13 : 9} className="flex-none text-gray-500" />
                        )}
                        <span
                          className={`min-w-0 overflow-hidden font-semibold ${isWide ? 'text-ellipsis' : 'text-clip'} ${
                            task.done ? 'line-through' : ''
                          }`}
                        >
                          {task.title}
                        </span>
                      </button>
                    ))}
                    {dayTasks.length > shownChips && (
                      <p className={`leading-tight font-bold text-gray-500 px-0.5 ${isWide ? 'text-[11px]' : 'text-[9px]'}`}>
                        他{dayTasks.length - shownChips}件
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
