'use client';

import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Plus, Search, X } from 'lucide-react';
import type { ScheduleView } from '@/types/app';
import { parseDateString, toDateString } from '@/lib/dateUtils';

// 予定タブの見出し（1行）。Googleカレンダーの見出しにならう（ヘルプ・設定・予定とタスクの切り替えは置かない）:
//   今日 / ‹ › / 年月（押すと月・日を選べる） / 検索 / 表示の切り替え（月・日・リスト） / ＋（予定の追加）
// 検索中は1行まるごと検索欄に替わる。
// mobile版の `mobile/src/components/schedule/ScheduleHeader.tsx` と同じ並び。

const VIEW_OPTIONS: { value: ScheduleView; label: string }[] = [
  { value: 'month', label: '月' },
  { value: 'day', label: '日' },
  { value: 'list', label: 'リスト' },
];

interface ScheduleHeaderProps {
  view: ScheduleView;
  title: string;
  onChangeView: (view: ScheduleView) => void;
  onToday: () => void;
  /** 前へ（-1）・次へ（1）。リストには日付送りが無いので出さない。 */
  onStep: (delta: number) => void;
  /** 月表示で表示中の月（の1日）と、日表示の日。見出しから選び直すときの初期値。 */
  monthStart: Date;
  selectedDate: Date;
  onPickMonth: (month: Date) => void;
  onPickDate: (date: Date) => void;
  onAdd: () => void;
  /** 検索中の文字。null なら検索していない。 */
  searchQuery: string | null;
  onChangeSearchQuery: (query: string) => void;
  onStartSearch: () => void;
  onEndSearch: () => void;
}

export default function ScheduleHeader({
  view,
  title,
  onChangeView,
  onToday,
  onStep,
  monthStart,
  selectedDate,
  onPickMonth,
  onPickDate,
  onAdd,
  searchQuery,
  onChangeSearchQuery,
  onStartSearch,
  onEndSearch,
}: ScheduleHeaderProps) {
  if (searchQuery !== null) {
    return (
      <div className="flex-none flex items-center gap-2 mb-3 min-h-9">
        <button onClick={onEndSearch} aria-label="検索を閉じる" className="p-1 text-gray-700">
          <ArrowLeft size={22} />
        </button>
        <input
          type="search"
          value={searchQuery}
          onChange={(e) => onChangeSearchQuery(e.target.value)}
          placeholder="これからの予定を検索"
          autoFocus
          className="flex-1 min-w-0 text-[15px] font-medium text-gray-900 py-1.5 border-b border-gray-200 bg-transparent outline-none focus:border-blue-400"
        />
        {searchQuery !== '' && (
          <button onClick={() => onChangeSearchQuery('')} aria-label="検索の文字を消す" className="p-1 text-gray-500">
            <X size={20} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-none flex items-center gap-2 md:gap-3 mb-3 min-h-9">
      <button
        onClick={onToday}
        className="flex-none text-xs md:text-sm font-bold text-gray-700 border border-gray-300 rounded-full px-2.5 md:px-4 py-1 md:py-1.5 hover:bg-gray-100 transition"
      >
        今日
      </button>
      {view !== 'list' && (
        <div className="flex-none flex items-center">
          <button onClick={() => onStep(-1)} aria-label="前へ" className="p-1 text-gray-700 rounded-full hover:bg-gray-100">
            <ChevronLeft size={22} />
          </button>
          <button onClick={() => onStep(1)} aria-label="次へ" className="p-1 text-gray-700 rounded-full hover:bg-gray-100">
            <ChevronRight size={22} />
          </button>
        </div>
      )}
      {/* 年月・日付を押すと、ネイティブのピッカーで任意の月・日へ直接ジャンプする */}
      <div className="relative flex-1 min-w-0">
        <h3 className="text-base md:text-xl font-bold md:font-medium text-gray-900 truncate">{title}</h3>
        {view === 'month' && (
          <input
            type="month"
            aria-label="月を選ぶ"
            value={`${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`}
            onChange={(e) => {
              const picked = parseDateString(`${e.target.value}-01`);
              if (picked) onPickMonth(picked);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        )}
        {view === 'day' && (
          <input
            type="date"
            aria-label="日付を選ぶ"
            value={toDateString(selectedDate)}
            onChange={(e) => {
              const picked = parseDateString(e.target.value);
              if (picked) onPickDate(picked);
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        )}
      </div>
      <button onClick={onStartSearch} aria-label="予定を検索" className="flex-none p-1 text-gray-700 rounded-full hover:bg-gray-100">
        <Search size={20} />
      </button>
      <label className="relative flex-none flex items-center gap-1 text-xs md:text-sm font-bold text-gray-700 border border-gray-300 rounded-full pl-2.5 pr-2 md:pl-4 md:pr-3 py-1 md:py-1.5 hover:bg-gray-100 transition">
        {VIEW_OPTIONS.find((option) => option.value === view)?.label}
        <ChevronDown size={14} className="text-gray-500" />
        <select
          aria-label="表示を切り替える"
          value={view}
          onChange={(e) => onChangeView(e.target.value as ScheduleView)}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {VIEW_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        onClick={onAdd}
        aria-label="予定を追加"
        className="flex-none w-8 h-8 md:w-9 md:h-9 rounded-full bg-pink-500 text-white flex items-center justify-center shadow-sm hover:bg-pink-600 active:scale-95 transition"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
