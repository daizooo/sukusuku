'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Inbox, TriangleAlert, Undo2 } from 'lucide-react';
import type { MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import { groupRecordsByDay, type BalanceCheck } from '@/lib/moneyUtils';
import { RecordDayBlock, type RecordDay } from './RecordDayList';
import FastScrollBar from './FastScrollBar';

// 家計タブの「記録」（docs/kakei.md §2・§3）。mobile版の `mobile/src/components/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に、**これまでの分をすべて**1本の一覧で並べる（2026-10-15。以前は月ごとだった）。
// 一覧そのものは RecordDayList の1日ぶん（RecordDayBlock）。
// **この面を開くたびに、いちばん上（新しい記録）から**見せる（2026-10-16。ほかの面から戻ったときも）。
// 右端の早送りバーは最初から出ていて、帯のどこを触っても、つかんで動かしても、その位置へ飛べる（触っているあいだだけ位置の日付が出る）。
// いちばん上から15件さかのぼると、上に「今日に戻る」を出す（押すと、いちばん上へ戻る）。
// その月に使った額は「振り返り」で見るので、ここには出さない（2026-10-08）。押すと記録の詳細。
// 一覧の上に固定して「未確定明細 n件」の帯を出す（Gmail から取り込んだ明細の未確認と、日が来た帯に出す見込み。
// 2026-10-21。以前は Gmail の「未確認 n件」だけ。docs/kakei.md §0.7・§9.5.6.1）。押すと一覧（MoneyFeedInbox）。
// Apps Script から1時間以上届いていなければ、その上に「Gmail の取り込みが止まっています」を出す（2026-10-20。§9.8）。

interface MoneyRecordsViewProps {
  /** この面を開いているか。false から true になったとき、いちばん上へ戻す。 */
  active: boolean;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  isLoading: boolean;
  onOpen: (record: MoneyRecord) => void;
  /** 日の見出しの「＋」。その日（YYYY-MM-DD）で記録を足す。 */
  onAddOnDate: (date: string) => void;
  /** Gmail から取り込んだ明細のうち、片づいていないものの数（docs/kakei.md §9.5.6.1）。0 なら出さない。 */
  feedOpenCount: number;
  onOpenFeed: () => void;
  /** Apps Script から1時間以上届いていない（docs/kakei.md §9.8）。 */
  feedStalled: boolean;
}

/** 補正は口座の履歴にだけ混ぜるので、ここでは持たない。 */
const NO_CORRECTIONS: BalanceCheck[] = [];

/** いちばん上から、これだけ（記録の件数）さかのぼったら「今日に戻る」を出す。 */
const FAR_FROM_TOP = 15;

const bubbleLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${year}年${pad(month)}月${pad(day)}日(${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]})`;
};

export default function MoneyRecordsView({
  active,
  records,
  categories,
  wallets,
  isLoading,
  onOpen,
  onAddOnDate,
  feedOpenCount,
  onOpenFeed,
  feedStalled,
}: MoneyRecordsViewProps) {
  const days = useMemo<RecordDay[]>(
    () => groupRecordsByDay(records).map((day) => ({ ...day, corrections: NO_CORRECTIONS })),
    [records],
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // いま上に見えている日の位置（バーの日付・「今日に戻る」の判定に使う）。
  const [firstIndex, setFirstIndex] = useState(0);

  const scrollToTop = useCallback((smooth: boolean) => {
    scrollRef.current?.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
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

  // ほかの面から戻ったときは、必ずいちばん上から。
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) {
      scrollToTop(false);
      setFirstIndex(0);
    }
    wasActive.current = active;
  }, [active, scrollToTop]);

  // 日ごとの先頭までの記録の件数（いちばん上から、何件さかのぼったかを数える）。
  const recordsBefore = useMemo(() => {
    const counts: number[] = [];
    let total = 0;
    for (const day of days) {
      counts.push(total);
      total += day.records.length;
    }
    return counts;
  }, [days]);
  const farFromTop = (recordsBefore[firstIndex] ?? 0) > FAR_FROM_TOP;
  const label = days[firstIndex] ? bubbleLabel(days[firstIndex].date) : '';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {feedStalled && (
        <div className="mt-2 flex w-full shrink-0 items-center gap-2 rounded-2xl bg-amber-100 px-3.5 py-2 text-amber-800">
          <TriangleAlert size={18} />
          <span className="flex-1 text-[13px] font-bold">Gmail の取り込みが止まっています（1時間以上届いていません）</span>
        </div>
      )}
      {feedOpenCount > 0 && (
        <button
          type="button"
          onClick={onOpenFeed}
          className="mb-1 mt-2 flex w-full shrink-0 items-center gap-2 rounded-2xl bg-blue-100 px-3.5 py-2.5 text-left text-blue-800 hover:bg-blue-200"
        >
          <Inbox size={18} />
          <span className="text-[15px] font-extrabold">未確定明細 {feedOpenCount}件</span>
          <span className="min-w-0 flex-1 truncate text-xs">
            Gmail から取り込んだ明細
          </span>
          <ChevronRight size={16} />
        </button>
      )}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* 右端のバーと、右下の「＋」に一覧の最後が隠れないよう、右と下を空ける。 */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto pb-36 pr-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
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
        {farFromTop && (
          <div className="pointer-events-none absolute inset-x-0 top-2.5 flex justify-center">
            <button
              type="button"
              aria-label="今日の記録へ戻る"
              onClick={() => scrollToTop((recordsBefore[firstIndex] ?? 0) < 200)}
              className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-blue-600 px-[18px] py-2.5 text-[15px] font-bold text-white shadow-md transition active:opacity-85"
            >
              <Undo2 size={16} />
              今日に戻る
            </button>
          </div>
        )}
        <FastScrollBar scrollRef={scrollRef} label={label} />
      </div>
    </div>
  );
}
