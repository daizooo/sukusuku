'use client';

import { useMemo } from 'react';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  categoryPath,
  formatYen,
  groupItems,
  groupRecordsByDay,
  recordTotal,
  recordsInMonth,
  topCategoryIdOf,
} from '@/lib/moneyUtils';
import { CategoryBadge, MonthBar } from './moneyVisual';

// 家計タブの「記録」（docs/kakei.md §2・§3）。mobile版の `mobile/src/components/money/MoneyRecordsView.tsx` と同じ並び・文言。
// その月の記録を日ごと（新しい日から）に並べる。1行＝1件の記録（種類・お店・出金元・合計）。押すと記録の詳細。
// 月の送りは固定で、スクロールするのは一覧だけ（右下の「＋」に最後が隠れないよう、下を空ける）。

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

const dayLabel = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${month}月${day}日（${WEEKDAY_LABELS[new Date(year, month - 1, day).getDay()]}）`;
};

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
  const days = useMemo(() => groupRecordsByDay(inMonth), [inMonth]);
  const totals = useMemo(() => {
    let expense = 0;
    let income = 0;
    for (const record of inMonth) {
      if (record.kind === 'expense') expense += recordTotal(record);
      if (record.kind === 'income') income += recordTotal(record);
    }
    return { expense, income };
  }, [inMonth]);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        badge: '振',
        title: `振替 ${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
        sub: '',
      };
    }
    const groups = groupItems(record.items);
    const first = groups[0];
    const top = first?.categoryId ? topCategoryIdOf(categories, first.categoryId) : null;
    const firstTitle = first?.categoryId
      ? categoryPath(categories, first.categoryId)
      : first?.specialItemId
        ? `${record.kind === 'income' ? '特別収入' : '特別費'} › ${specialItems.find((item) => item.id === first.specialItemId)?.name ?? ''}`
        : '';
    return {
      badge: top ? categories.find((category) => category.id === top)?.name ?? '' : '特',
      title: groups.length > 1 ? `${firstTitle} ほか${groups.length - 1}種類` : firstTitle,
      sub: [record.store, walletName(record.walletId)].filter((text) => text !== '').join('・'),
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonthBar
        monthKey={monthKey}
        onChange={onMonth}
        right={
          <span className="text-xs font-semibold text-gray-500 tabular-nums">
            支出 {formatYen(totals.expense)}
            {totals.income > 0 ? `　収入 ${formatYen(totals.income)}` : ''}
          </span>
        }
      />
      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-400">読み込み中...</p>
      ) : days.length === 0 ? (
        <p className="p-8 text-center text-sm text-gray-400">この月の記録はまだありません。右下の「＋」で記録します</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-24">
          {days.map((day) => (
            <div key={day.date} className="mb-3">
              <p className="pb-1 text-xs font-bold text-gray-500">{dayLabel(day.date)}</p>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                {day.records.map((record, index) => {
                  const { badge, title, sub } = describe(record);
                  const total = recordTotal(record);
                  return (
                    <button
                      key={record.id}
                      type="button"
                      onClick={() => onOpen(record)}
                      className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-gray-50 ${
                        index > 0 ? 'border-t border-gray-200' : ''
                      }`}
                    >
                      <CategoryBadge label={badge} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-900">{title}</span>
                        {sub !== '' && <span className="mt-0.5 block truncate text-xs text-gray-400">{sub}</span>}
                      </span>
                      <span
                        className={`text-[15px] font-bold tabular-nums ${
                          record.kind === 'income' ? 'text-sky-600' : record.kind === 'transfer' ? 'text-gray-500' : 'text-gray-900'
                        }`}
                      >
                        {record.kind === 'income' ? '+' : ''}
                        {formatYen(total)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
