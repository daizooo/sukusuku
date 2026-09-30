'use client';

import { AlertTriangle, BellRing, CheckCircle2, ChevronRight, Circle, Plus } from 'lucide-react';
import type { DynamicTask } from '@/types/app';
import { formatTimeRange, startOfDay } from '@/lib/dateUtils';
import { getOwnerTone } from '@/lib/uiUtils';
import { byDateThenTime, formatRelativeDay } from './utils';

// 月表示のカレンダーの下に置く「直近のスケジュール」。以前はホームタブにあったもの
// （mobile版の `UpcomingTasks` と出す中身・並びを同じにしてある）。
// 高さは親から与えられたぶんに収め、あふれた分はこの中だけでスクロールする
// （画面全体はスクロールさせない）。
//
// 見出しを押すと、すべての予定を日付順に並べたリスト表示へ移る。
//
// 予定の追加ボタンは、右下の丸いボタンだと一覧の右下に重なって隠してしまうため、
// 月表示ではこの見出しの中に置く。

interface UpcomingTasksProps {
  /** 表示する予定。 */
  tasks: DynamicTask[];
  isLoading?: boolean;
  today: Date;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
  onAddTask: () => void;
  /** 見出しを押したとき・期限切れの件数を押したときにリスト表示へ移る。 */
  onShowAll: () => void;
}

/** 一覧に出す件数の上限。それより先は「すべて見る」で見る。 */
const MAX_TASKS = 10;

export default function UpcomingTasks({
  tasks,
  isLoading,
  today,
  onToggleTodo,
  onOpenTask,
  onAddTask,
  onShowAll,
}: UpcomingTasksProps) {
  const startOfToday = startOfDay(today).getTime();
  const pending = tasks.filter((t) => !t.done);

  // 期限切れは古いものほど先頭に来るため、そのまま並べると直近の予定を
  // 食いつぶしてしまう。件数だけ知らせて、中身はリスト表示に任せる。
  const overdueCount = pending.filter(
    (t) => t.targetDateObj && startOfDay(t.targetDateObj).getTime() < startOfToday,
  ).length;

  // 今日以降の予定を近い順に。日付未設定は後ろに回る（byDateThenTime）。
  const upcoming = pending
    .filter((t) => !t.targetDateObj || startOfDay(t.targetDateObj).getTime() >= startOfToday)
    .sort(byDateThenTime)
    .slice(0, MAX_TASKS);

  return (
    <section className="h-full min-h-0 overflow-hidden flex flex-col gap-1.5">
      <div className="flex-none flex items-center gap-1.5">
        <button
          onClick={onShowAll}
          aria-label="直近のスケジュール。押すとすべての予定をリストで見る"
          className="flex-none flex items-center gap-0.5 text-sm font-bold text-gray-900 whitespace-nowrap"
        >
          直近のスケジュール
          <ChevronRight size={16} className="text-blue-600" />
        </button>
        {overdueCount > 0 && (
          <button
            onClick={onShowAll}
            aria-label={`期限切れ${overdueCount}件。リストで見る`}
            className="flex-none flex items-center gap-0.5 rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 whitespace-nowrap hover:bg-red-100 transition"
          >
            <AlertTriangle size={12} />
            期限切れ {overdueCount}件
          </button>
        )}
        <div className="flex-1" />
        <button
          onClick={onAddTask}
          aria-label="予定を追加"
          className="flex-none w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 active:scale-95 transition"
        >
          <Plus size={18} />
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-3">読み込み中...</p>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-3">直近の予定はありません</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {upcoming.map((task) => (
            <div
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpenTask(task)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onOpenTask(task);
              }}
              className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 transition"
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleTodo(task.id);
                }}
                aria-label={task.done ? '完了を取り消す' : '完了にする'}
                className={`flex-none transition-colors ${task.done ? 'text-blue-500' : 'text-gray-300 hover:text-gray-400'}`}
              >
                {task.done ? <CheckCircle2 size={20} /> : <Circle size={20} />}
              </button>

              {/* 幅の狭い端末でも日付と時刻が欠けないよう、この2つは縮めず、
                  タイトルだけが省略される。 */}
              <div className="flex-none flex flex-col leading-tight tabular-nums">
                <span className="text-xs font-bold text-blue-600 whitespace-nowrap">
                  {task.targetDateObj ? formatRelativeDay(task.targetDateObj, today) : '未定'}
                </span>
                <span className="text-[10px] text-gray-500 whitespace-nowrap">
                  {task.kind === 'event' ? formatTimeRange(task.startTime, task.endTime) : ''}
                </span>
              </div>

              <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-800">{task.title}</span>
              {task.remindMinutesBefore !== null && <BellRing size={12} className="flex-none text-yellow-500" />}
              {task.participants.length > 0 && (
                <span
                  className={`flex-none text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${getOwnerTone(task.owner, task.participants)}`}
                >
                  {task.participants.join('・')}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
