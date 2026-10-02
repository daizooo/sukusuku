'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DynamicTask } from '@/types/app';
import { formatDateHeading } from '@/lib/dateUtils';
import { formatBabyAgeAt } from '@/lib/milestones';
import TaskRow from './TaskRow';
import {
  buildScheduleSections,
  byDateDesc,
  formatRelativeDay,
  type ScheduleListSection,
} from './utils';

interface ListViewProps {
  tasks: DynamicTask[];
  isLoading?: boolean;
  today: Date;
  /** 生後日数の表示に使う。未登録なら空文字。 */
  birthDate: string;
  onToggleTodo: (task: DynamicTask) => void;
  onOpenTask: (task: DynamicTask) => void;
}

const SECTION_TONE: Record<ScheduleListSection['tone'], string> = {
  alert: 'text-red-600',
  today: 'text-blue-600',
  plain: 'text-gray-500',
};

/** 日付・曜日と相対表記をまとめた1日の見出し。予定の行には日付を繰り返さない。 */
function DayHeading({
  date,
  today,
  birthDate,
  sectionTitle,
}: {
  date: Date;
  today: Date;
  birthDate: string;
  sectionTitle: string;
}) {
  const relative = formatRelativeDay(date, today);
  const babyAge = formatBabyAgeAt(birthDate, date);

  return (
    <div className="flex items-baseline flex-wrap gap-x-2 px-1 mb-1.5">
      <span className="text-xs font-bold text-gray-700">{formatDateHeading(date, today)}</span>
      {/* セクションの見出しと同じことを繰り返さない（「今日」の中の「今日」など）。 */}
      {relative !== sectionTitle && <span className="text-[11px] text-gray-500">{relative}</span>}
      {babyAge && <span className="text-[11px] text-gray-400">{babyAge}</span>}
    </div>
  );
}

/** 予定を期限の近さでまとめた一覧。先の予定をまとめて確かめるための面。 */
export default function ListView({
  tasks,
  isLoading,
  today,
  birthDate,
  onToggleTodo,
  onOpenTask,
}: ListViewProps) {
  const [showDone, setShowDone] = useState(false);

  const sections = buildScheduleSections(tasks, today);
  // 誕生日が未登録で日付が確定しない予定は、日付順の並びに混ぜず末尾にまとめる。
  const undated = tasks.filter((t) => !t.targetDateObj && !t.done);
  const done = tasks.filter((t) => t.done).sort(byDateDesc);

  if (isLoading) return <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>;
  if (tasks.length === 0) return <p className="text-sm text-gray-400 text-center py-8">予定はまだありません</p>;

  return (
    <div className="space-y-5">
      {sections.map((section) => (
        <section key={section.key}>
          <div className="sticky top-0 z-10 bg-gray-50 flex items-baseline justify-between px-1 py-1">
            <h4 className={`text-xs font-bold ${SECTION_TONE[section.tone]}`}>{section.title}</h4>
            <span className="text-[11px] text-gray-400">{section.count}件</span>
          </div>
          <div className="space-y-3">
            {section.groups.map((group) => (
              <div key={group.date.getTime()}>
                <DayHeading date={group.date} today={today} birthDate={birthDate} sectionTitle={section.title} />
                <div className="space-y-2">
                  {group.tasks.map((task) => (
                    <TaskRow key={task.occurrenceKey} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      {undated.length > 0 && (
        <section>
          <div className="sticky top-0 z-10 bg-gray-50 flex items-baseline justify-between px-1 py-1">
            <h4 className="text-xs font-bold text-gray-500">日付未定</h4>
            <span className="text-[11px] text-gray-400">{undated.length}件</span>
          </div>
          <p className="text-[11px] text-gray-400 mb-2 px-1 leading-relaxed">
            お子様の誕生日を設定タブで登録すると、カレンダーに表示されます。
          </p>
          <div className="space-y-2">
            {undated.map((task) => (
              <TaskRow key={task.occurrenceKey} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} />
            ))}
          </div>
        </section>
      )}

      {done.length > 0 && (
        <section>
          {/* 済んだ予定は畳んでおき、見返したいときだけ開く。 */}
          <button
            onClick={() => setShowDone((v) => !v)}
            aria-expanded={showDone}
            className="w-full flex items-center justify-between px-1 py-1 text-xs font-bold text-gray-500"
          >
            <span className="flex items-center">
              {showDone ? <ChevronDown size={14} className="mr-1" /> : <ChevronRight size={14} className="mr-1" />}
              完了済み
            </span>
            <span className="text-[11px] font-medium text-gray-400">{done.length}件</span>
          </button>
          {showDone && (
            <div className="space-y-2 mt-1.5">
              {done.map((task) => (
                <TaskRow key={task.occurrenceKey} task={task} onToggle={onToggleTodo} onOpen={onOpenTask} showDate />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
