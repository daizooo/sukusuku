'use client';

import { useMemo } from 'react';
import type { MoneyCategory, MoneyRecord, MoneyWallet, SpecialItem } from '@/types/app';
import { WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  categoryPath,
  formatYen,
  groupItems,
  groupRecordsByDay,
  iconKeyOf,
  recordTotal,
  recordsInMonth,
  topCategoryIdOf,
} from '@/lib/moneyUtils';
import { CategoryIcon, Hero, MonthBar, cardClass, type } from './moneyVisual';

// 家計タブの「記録」（docs/kakei.md §2・§3）。mobile版の `mobile/src/components/money/MoneyRecordsView.tsx` と同じ並び・文言。
//
// 結論はその月に使った額（生活費。特別費は「特別費」の面だけで見る）。その下に記録を日ごと（新しい日から）。
// 1行＝1件の記録（種類・お店・出金元・合計）。押すと記録の詳細。月の送りは固定で、スクロールするのは下だけ。

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
    // 特別費の品目は数えない（特別費は「特別費」の面だけで見る）。
    for (const record of inMonth) {
      const amount = record.items.filter((item) => item.specialItemId === null).reduce((sum, item) => sum + item.amount, 0);
      if (record.kind === 'expense') expense += amount;
      if (record.kind === 'income') income += amount;
    }
    return { expense, income };
  }, [inMonth]);

  const walletName = (id: string | null) => wallets.find((wallet) => wallet.id === id)?.name ?? '';

  const describe = (record: MoneyRecord) => {
    if (record.kind === 'transfer') {
      return {
        icon: 'wallet',
        title: '振替',
        sub: `${walletName(record.walletId) || '?'} → ${walletName(record.toWalletId) || '?'}`,
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
      icon: top ? iconKeyOf(categories.find((category) => category.id === top)) : 'receipt',
      title: groups.length > 1 ? `${firstTitle} ほか${groups.length - 1}` : firstTitle,
      sub: [record.store, walletName(record.walletId)].filter((text) => text !== '').join('・'),
    };
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MonthBar monthKey={monthKey} onChange={onMonth} />
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        <Hero
          label="この月に使った額（生活費）"
          value={formatYen(totals.expense)}
          note={totals.income > 0 ? `収入 +${formatYen(totals.income)}` : undefined}
        />

        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">読み込み中...</p>
        ) : days.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">この月の記録はまだありません。右下の「＋」で記録します</p>
        ) : (
          days.map((day) => {
            const spent = day.records
              .filter((record) => record.kind === 'expense')
              .flatMap((record) => record.items)
              .filter((item) => item.specialItemId === null)
              .reduce((sum, item) => sum + item.amount, 0);
            return (
              <section key={day.date} className="mt-5">
                <div className="flex items-baseline justify-between pb-1.5">
                  <h4 className="text-[13px] font-bold text-gray-700">{dayLabel(day.date)}</h4>
                  {spent > 0 && <span className={type.faint}>{formatYen(spent)}</span>}
                </div>
                <div className={`${cardClass} overflow-hidden`}>
                  {day.records.map((record, index) => {
                    const { icon, title, sub } = describe(record);
                    return (
                      <button
                        key={record.id}
                        type="button"
                        onClick={() => onOpen(record)}
                        className={`flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-gray-50 ${
                          index > 0 ? 'border-t border-gray-200' : ''
                        }`}
                      >
                        <CategoryIcon iconKey={icon} />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${type.row}`}>{title}</span>
                          {sub !== '' && <span className={`block truncate ${type.sub}`}>{sub}</span>}
                        </span>
                        <span className={record.kind === 'transfer' ? type.amount.replace('text-gray-900', 'text-gray-500') : type.amount}>
                          {record.kind === 'income' ? '+' : ''}
                          {formatYen(recordTotal(record))}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
