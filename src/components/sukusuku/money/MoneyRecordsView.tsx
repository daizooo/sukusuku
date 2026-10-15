'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import { dateKeyOfDate, groupRecordsByDay, type BalanceCheck } from '@/lib/moneyUtils';
import { RecordDayBlock, type RecordDay } from './RecordDayList';
import FastScrollBar from './FastScrollBar';

// 家計タブの「記録」（docs/kakei.md §2・§3）。mobile版の `mobile/src/components/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に、**これまでの分をすべて**1本の一覧で並べる（2026-10-15。以前は月ごとだった）。
// 一覧そのものは RecordDayList の1日ぶん（RecordDayBlock）。右端の早送りのバーをつかんで動かすと、過去へすぐ飛べる
// （つかんでいるあいだは位置の日付が出る）。今日から離れた位置まで下がると、上に「今日に戻る」を出す。
// その月に使った額は「振り返り」で見るので、ここには出さない（2026-10-08）。押すと記録の詳細。

interface MoneyRecordsViewProps {
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  isLoading: boolean;
  onOpen: (record: MoneyRecord) => void;
  /** 日の見出しの「＋」。その日（YYYY-MM-DD）で記録を足す。 */
  onAddOnDate: (date: string) => void;
}

/** 補正は口座の履歴にだけ混ぜるので、ここでは持たない。 */
const NO_CORRECTIONS: BalanceCheck[] = [];

/** 今日の位置から、これだけ（日の数）離れたら「今日に戻る」を出す。 */
const FAR_FROM_TODAY = 3;

const bubbleLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}年${pad(month)}月${pad(day)}日(${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]})`;
};

export default function MoneyRecordsView({ records, categories, wallets, isLoading, onOpen, onAddOnDate }: MoneyRecordsViewProps) {
  const days = useMemo<RecordDay[]>(
    () => groupRecordsByDay(records).map((day) => ({ ...day, corrections: NO_CORRECTIONS })),
    [records],
  );
  // 今日（以前の日のうち、いちばん新しいもの）の位置。先の日付の記録があるときは、その下になる。
  const todayIndex = useMemo(() => {
    const today = dateKeyOfDate(new Date());
    const index = days.findIndex((day) => day.date <= today);
    return index < 0 ? 0 : index;
  }, [days]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // いま上に見えている日の位置（見出し・「今日に戻る」の判定に使う）。
  const [firstIndex, setFirstIndex] = useState(0);
  const openedAtToday = useRef(false);

  const scrollToIndex = useCallback((index: number, smooth: boolean) => {
    const scroller = scrollRef.current;
    const target = listRef.current?.children[index] as HTMLElement | undefined;
    if (!scroller) return;
    scroller.scrollTo({ top: index <= 0 || !target ? 0 : target.offsetTop, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // 上に見えている日（スクロールの位置より下にある、いちばん上の日）を二分探索で探す。
  const onScroll = useCallback(() => {
    const scroller = scrollRef.current;
    const children = listRef.current?.children;
    if (!scroller || !children || children.length === 0) return;
    let low = 0;
    let high = children.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((children[mid] as HTMLElement).offsetTop + (children[mid] as HTMLElement).offsetHeight <= scroller.scrollTop + 1) low = mid + 1;
      else high = mid;
    }
    setFirstIndex(low);
  }, []);

  // 先の日付の記録があるときは、はじめに今日の位置へ合わせる（面が出て、一覧の高さが分かったとき1回だけ）。
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => {
      if (openedAtToday.current || scroller.clientHeight <= 0 || days.length === 0) return;
      openedAtToday.current = true;
      if (todayIndex > 0) scrollToIndex(todayIndex, false);
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [days.length, todayIndex, scrollToIndex]);

  const farFromToday = days.length > 0 && Math.abs(firstIndex - todayIndex) > FAR_FROM_TODAY;
  const label = days[firstIndex] ? bubbleLabel(days[firstIndex].date) : '';

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto pb-24">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">読み込み中...</p>
        ) : days.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">まだ記録がありません。右下の「＋」で記録します</p>
        ) : (
          <div ref={listRef} className="relative">
            {days.map((day) => (
              <RecordDayBlock key={day.date} day={day} categories={categories} wallets={wallets} onOpen={onOpen} onAddOnDate={onAddOnDate} />
            ))}
          </div>
        )}
      </div>
      {farFromToday && (
        <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center">
          <button
            type="button"
            aria-label="今日の記録へ戻る"
            onClick={() => scrollToIndex(todayIndex, Math.abs(firstIndex - todayIndex) < 40)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-blue-600 px-[18px] py-2.5 text-[15px] font-bold text-white shadow-md transition active:opacity-85"
          >
            <Undo2 size={16} />
            今日に戻る
          </button>
        </div>
      )}
      <FastScrollBar scrollRef={scrollRef} label={label} />
    </div>
  );
}
