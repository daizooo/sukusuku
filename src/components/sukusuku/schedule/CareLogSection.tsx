'use client';

import type { ReactNode } from 'react';
import { ChevronRight, Coffee, Droplet, Moon } from 'lucide-react';
import type { CareLog } from '@/types/app';
import {
  BADGE_TONE_CLASS,
  formatDuration,
  getLogBadges,
  getLogTimeText,
  getLogTitle,
  isAlertLog,
  summarizeLogs,
} from '@/lib/careLogUtils';

const formatMinutes = (minutes: number): string => formatDuration(minutes * 60000);

interface CareLogSummaryProps {
  logs: CareLog[];
}

/** その日の合計を1行にまとめたもの。週表示・日表示で共通して使う。 */
export function CareLogSummaryLine({ logs }: CareLogSummaryProps) {
  const summary = summarizeLogs(logs);
  if (logs.length === 0) return <p className="text-[11px] text-gray-400">記録なし</p>;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-600 tabular-nums">
      <span className="flex items-center">
        <Coffee size={12} className="text-amber-600 mr-1" />
        {summary.milk.count}回
        {summary.milk.ml > 0 && <span className="ml-1">{summary.milk.ml}ml</span>}
      </span>
      <span className="flex items-center">
        <Droplet size={12} className="text-blue-500 mr-1" />
        {summary.diaper.count}回
        {summary.diaper.poopCount > 0 && <span className="ml-1">(💩{summary.diaper.poopCount})</span>}
      </span>
      <span className="flex items-center">
        <Moon size={12} className="text-indigo-500 mr-1" />
        {summary.sleep.minutes > 0 ? formatMinutes(summary.sleep.minutes) : `${summary.sleep.count}回`}
      </span>
    </div>
  );
}

interface CareLogSectionProps {
  logs: CareLog[];
  isLoading?: boolean;
  /** 合計の上に置く24時間の帯。前夜から続く睡眠も含むため、記録の一覧とは別に受け取る。 */
  timeline?: ReactNode;
  onOpenLogTab: () => void;
}

/**
 * 日表示に出す育児記録。ここでは閲覧だけを行い、追加・編集は記録タブに任せる
 * （同じ入力導線を2か所に置かないため）。
 */
export default function CareLogSection({ logs, isLoading, timeline, onOpenLogTab }: CareLogSectionProps) {
  // 記録タブは最新が上だが、1日の流れを追う面なので古い順に並べる。
  const ordered = [...logs].sort((a, b) => a.time.getTime() - b.time.getTime());

  return (
    <section>
      <div className="flex items-end justify-between mb-2 px-1">
        <h4 className="text-xs font-bold text-gray-500">育児記録 {logs.length > 0 && `(${logs.length}件)`}</h4>
        <button onClick={onOpenLogTab} className="text-blue-500 text-xs font-medium flex items-center">
          記録タブで開く <ChevronRight size={14} />
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-4">読み込み中...</p>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 space-y-2">
          {timeline}
          <CareLogSummaryLine logs={logs} />

          {ordered.length > 0 && (
            <ul className="divide-y divide-gray-50 border-t border-gray-50 pt-1">
              {ordered.map((log) => (
                <li
                  key={log.id}
                  className={`flex items-start py-1.5 text-xs ${isAlertLog(log) ? 'text-red-600' : 'text-gray-700'}`}
                >
                  <span className="w-24 flex-none text-gray-500 tabular-nums">{getLogTimeText(log)}</span>
                  <span className="font-medium flex-none">{getLogTitle(log)}</span>
                  <span className="flex flex-wrap gap-1 ml-2">
                    {getLogBadges(log).map((badge, i) => (
                      <span
                        key={`${badge.text}-${i}`}
                        className={`px-1.5 py-0.5 rounded text-[10px] tabular-nums ${BADGE_TONE_CLASS[badge.tone]}`}
                      >
                        {badge.text}
                      </span>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
