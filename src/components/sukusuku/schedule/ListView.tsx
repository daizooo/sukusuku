'use client';

import type { DynamicTask } from '@/types/app';
import TaskRow from './TaskRow';
import { byDateThenTime } from './utils';

interface ListViewProps {
  tasks: DynamicTask[];
  isLoading?: boolean;
  onToggleTodo: (id: string) => void;
  onOpenTask: (task: DynamicTask) => void;
}

/** 予定を日付順に並べた一覧。先の予定をまとめて確かめるための面。 */
export default function ListView({ tasks, isLoading, onToggleTodo, onOpenTask }: ListViewProps) {
  // 誕生日が未登録で日付が確定しない予定は、日付順の並びに混ぜず末尾にまとめる。
  const dated = tasks.filter((t) => t.targetDateObj).sort(byDateThenTime);
  const undated = tasks.filter((t) => !t.targetDateObj);

  if (isLoading) return <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>;
  if (tasks.length === 0) return <p className="text-sm text-gray-400 text-center py-8">予定はまだありません</p>;

  return (
    <div className="space-y-3">
      {dated.map((task) => (
        <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} showDate />
      ))}

      {undated.length > 0 && (
        <div className="pt-3">
          <h4 className="text-xs font-bold text-gray-500 mb-2 px-1">日付未定 ({undated.length}件)</h4>
          <p className="text-[11px] text-gray-400 mb-2 px-1 leading-relaxed">
            お子様の誕生日を設定タブで登録すると、カレンダーに表示されます。
          </p>
          <div className="space-y-2">
            {undated.map((task) => (
              <TaskRow key={task.id} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
