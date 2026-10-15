'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring } from '@/types/app';
import {
  buildMonthSummary,
  categoryPath,
  estimatesInMonth,
  formatBalance,
  formatShortDate,
  formatYen,
  itemSummary,
  pendingRecurringInMonth,
  recordTotal,
} from '@/lib/moneyUtils';
import { FullScreen, Hero, PrimaryButton, ScreenHeader, SectionHeader, StatRow, cardClass, incomeAmountClass, type } from './moneyVisual';

// 月の締め（振り返りの確定。docs/kakei.md §4.5）。mobile版の `mobile/src/components/money/MonthCloseScreen.tsx` と同じ並び・文言。
//
// その月の収支を、見込みの額も含めてすべて出し、「この月を締める」で確定する。片づいていないものが残っていても締められる。
// 見込みのままの記録はその場で「確定」でき（今の額のまま）、未確認の明細は件数を出して一覧を開ける。
// 年初からの累計は出さない（その月の締めなので）。
// その月に、固定収入・固定費でこれから自動で作られる記録がある（自動の記録より前に締める）ときは、一覧で知らせ、
// 締めるときにも確かめる（締めたあとに作られた記録は、締めた収支に入っていないため）。

interface MonthCloseScreenProps {
  monthKey: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  /** 固定収入・固定費のルール（これから自動で作られる記録を出す）。 */
  recurring: MoneyRecurring[];
  /** 今日（YYYY-MM-DD）。 */
  today: string;
  /** その月の日付の、未確認の明細の件数。 */
  feedCount: number;
  closed: boolean;
  /** 締めた日時（締めた月だけ）。 */
  closedAt: string | null;
  onConfirmEstimate: (record: MoneyRecord) => Promise<void>;
  onOpenRecord: (record: MoneyRecord) => void;
  onOpenFeed: () => void;
  onCloseMonth: () => void;
  onReopenMonth: () => void;
  onClose: () => void;
}

/** 見込みの記録の見出し。お店、無ければ品名、無ければ種類。 */
function recordTitle(record: MoneyRecord, categories: MoneyCategory[]): string {
  if (record.store.trim() !== '') return record.store;
  const names = itemSummary(record.items);
  if (names !== '') return names;
  return categoryPath(categories, record.items[0]?.categoryId ?? null) || (record.kind === 'income' ? '収入' : '支出');
}

/** 固定のルールの見出し。品名、無ければお店、無ければ種類。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = rule.name.trim() || rule.store.trim();
  return name !== '' ? name : categoryPath(categories, rule.categoryId) || (rule.kind === 'income' ? '収入' : '支出');
}

const closedDateLabel = (closedAt: string) => {
  const date = new Date(closedAt);
  return `${date.getMonth() + 1}/${date.getDate()}`;
};

export default function MonthCloseScreen({
  monthKey,
  records,
  categories,
  budgets,
  recurring,
  today,
  feedCount,
  closed,
  closedAt,
  onConfirmEstimate,
  onOpenRecord,
  onOpenFeed,
  onCloseMonth,
  onReopenMonth,
  onClose,
}: MonthCloseScreenProps) {
  const month = useMemo(() => buildMonthSummary(records, categories, budgets, monthKey), [records, categories, budgets, monthKey]);
  const estimates = useMemo(() => estimatesInMonth(records, monthKey), [records, monthKey]);
  const pending = useMemo(
    () => pendingRecurringInMonth(recurring, records, monthKey, today),
    [recurring, records, monthKey, today],
  );
  // 確定を押した記録（読み直しが届くまで、二度押せないように）。
  const [confirming, setConfirming] = useState<string | null>(null);
  const label = `${Number(monthKey.slice(5, 7))}月`;

  // これから自動で作られる記録があれば、締める前に確かめる。
  const closeMonth = () => {
    if (
      pending.length > 0 &&
      !window.confirm(
        `まだ自動で記録されていないものが${pending.length}件あります。締めたあとに作られた記録は、締めた収支に入っていません。記録されてから締め直すこともできます。このまま締めますか？`,
      )
    ) {
      return;
    }
    onCloseMonth();
  };

  const confirm = async (record: MoneyRecord) => {
    setConfirming(record.id);
    try {
      await onConfirmEstimate(record);
    } finally {
      setConfirming(null);
    }
  };

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title={`${label}の締め`} icon="back" onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-3">
        <Hero compact label={`収支（${label}）`} value={formatBalance(month.balance)} plus={month.balance > 0} note="収入 − 支出（見込みの額も含む）">
          <StatRow compact label="収入" value={formatYen(month.income)} plus={month.income > 0} />
          <StatRow compact label="支出" value={`−${formatYen(month.living)}`} />
        </Hero>

        <SectionHeader compact title="見込みのままの記録" hint={`${estimates.length}件`} />
        {estimates.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-gray-400">見込みのままの記録はありません</p>
        ) : (
          <div className={`${cardClass} overflow-hidden`}>
            {estimates.map((record, index) => (
              <div key={record.id} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                <button
                  type="button"
                  aria-label={`${recordTitle(record, categories)}の記録を開く`}
                  onClick={() => onOpenRecord(record)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="w-11 shrink-0 text-[13px] font-semibold text-gray-500 tabular-nums">{formatShortDate(record.occurredOn)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{recordTitle(record, categories)}</span>
                  <span className={`text-[15px] font-extrabold tabular-nums ${record.kind === 'income' ? incomeAmountClass : 'text-gray-900'}`}>
                    {formatYen(recordTotal(record))}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${recordTitle(record, categories)}をこの額で確定する`}
                  disabled={confirming !== null}
                  onClick={() => void confirm(record)}
                  className={`shrink-0 rounded-full bg-blue-100 px-3 py-1.5 text-[13px] font-bold text-blue-800 ${confirming === record.id ? 'opacity-50' : ''}`}
                >
                  確定
                </button>
              </div>
            ))}
          </div>
        )}
        {estimates.length > 0 && (
          <p className={`${type.faint} mt-1`}>額が違うものは、押して記録の詳細で直してください。「確定」は今の額のまま確定します</p>
        )}

        {pending.length > 0 && (
          <>
            <SectionHeader compact title="これから自動で記録されるもの" hint={`${pending.length}件`} />
            <div className="overflow-hidden rounded-2xl border border-amber-100 bg-white">
              {pending.map((entry, index) => (
                <div key={entry.rule.id} className={`flex items-center gap-2.5 px-3.5 py-2.5 ${index > 0 ? 'border-t border-gray-200' : ''}`}>
                  <span className="w-11 shrink-0 text-[13px] font-semibold text-gray-500 tabular-nums">{formatShortDate(entry.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{ruleTitle(entry.rule, categories)}</span>
                  <span className={`text-[15px] font-extrabold tabular-nums ${entry.rule.kind === 'income' ? incomeAmountClass : 'text-gray-900'}`}>
                    {formatYen(entry.amount)}
                  </span>
                </div>
              ))}
            </div>
            <p className={`${type.faint} mt-1`}>
              固定収入・固定費で、この月のうちにまだ自動で記録されていないものです。上の収支には入っていません。記録されてから締めると確かです
            </p>
          </>
        )}

        <SectionHeader compact title="未確認の明細" hint={`${feedCount}件`} />
        {feedCount === 0 ? (
          <p className="py-4 text-center text-[13px] text-gray-400">未確認の明細はありません</p>
        ) : (
          <button
            type="button"
            onClick={onOpenFeed}
            className={`${cardClass} flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50`}
          >
            <span className="flex-1 text-sm font-semibold text-gray-900">未確認の明細 {feedCount}件を片づける</span>
            <ChevronRight size={16} className="text-gray-400" />
          </button>
        )}
      </div>
      <div className="shrink-0 space-y-1.5 border-t border-gray-200 px-4 pb-4 pt-2.5">
        {closed ? (
          <>
            <p className="text-center text-[13px] font-semibold text-gray-500">
              {closedAt ? `${closedDateLabel(closedAt)}に締めました` : '締めた月です'}
            </p>
            <button type="button" onClick={onReopenMonth} className="w-full py-2.5 text-[13px] font-bold text-red-500">
              締めを外す
            </button>
          </>
        ) : (
          <>
            <PrimaryButton label="この月を締める" onClick={closeMonth} />
            <p className="text-center text-xs font-medium text-gray-400">見込みのままの記録や未確認の明細が残っていても締められます</p>
          </>
        )}
      </div>
    </FullScreen>
  );
}
