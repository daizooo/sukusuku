'use client';

import { useMemo } from 'react';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { recordsInMonth } from '@/lib/moneyUtils';
import { MonthBar } from './moneyVisual';
import RecordDayList from './RecordDayList';

// 家計タブの「記録」（docs/kakei.md §2・§3）。mobile版の `mobile/src/components/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 記録を日ごと（新しい日から）に並べる（一覧そのものは RecordDayList）。その月に使った額は「振り返り」で見るので、
// ここには出さない（2026-10-08）。押すと記録の詳細。月の送りは固定で、スクロールするのは下だけ。

interface MoneyRecordsViewProps {
  monthKey: string;
  onMonth: (monthKey: string) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  specialItems: SpecialItem[];
  isLoading: boolean;
  onOpen: (record: MoneyRecord) => void;
}

export default function MoneyRecordsView({
  monthKey,
  onMonth,
  records,
  categories,
  wallets,
  specialItems,
  isLoading,
  onOpen,
}: MoneyRecordsViewProps) {
  const inMonth = useMemo(() => recordsInMonth(records, monthKey), [records, monthKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">読み込み中...</p>
        ) : inMonth.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">この月の記録はまだありません。右下の「＋」で記録します</p>
        ) : (
          <RecordDayList records={inMonth} categories={categories} wallets={wallets} specialItems={specialItems} onOpen={onOpen} />
        )}
      </div>
    </div>
  );
}
