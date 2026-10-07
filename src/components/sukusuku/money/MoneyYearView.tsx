'use client';

import { useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { buildYearSummary, formatSignedYen, formatYen, monthKeyOfDate } from '@/lib/moneyUtils';
import { formatFiscalYear } from '@/lib/specialUtils';
import SpecialPanel from '../living/SpecialPanel';

// 家計タブの「年」（docs/kakei.md §4.2）。mobile版の `mobile/src/components/money/MoneyYearView.tsx` と同じ並び・文言。
//
// 上に年度の収支（収入 − 生活費 − 貯金。特別費は入れない）と、月ごとの表（押すとその月の「月」へ）。
// その下に特別費の予定と実績（SpecialPanel）。年度の送りは固定で、下はまとめてスクロールする。

interface MoneyYearViewProps {
  fiscalYear: number;
  onFiscalYear: (fiscalYear: number) => void;
  familyId: string;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  onSelectMonth: (monthKey: string) => void;
  onRecordsChanged: () => void;
}

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';

export default function MoneyYearView({
  fiscalYear,
  onFiscalYear,
  familyId,
  records,
  categories,
  budgets,
  wallets,
  onSelectMonth,
  onRecordsChanged,
}: MoneyYearViewProps) {
  const today = monthKeyOfDate(new Date());
  const summary = useMemo(
    () => buildYearSummary(records, categories, budgets, wallets, fiscalYear, today),
    [records, categories, budgets, wallets, fiscalYear, today],
  );
  const { total } = summary;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 flex items-center gap-2 py-2">
        <button type="button" aria-label="前の年度" onClick={() => onFiscalYear(fiscalYear - 1)} className={yearButtonClass}>
          <ChevronLeft size={18} />
        </button>
        <span className="text-[17px] font-bold text-gray-900 tabular-nums">{formatFiscalYear(fiscalYear)}</span>
        <button type="button" aria-label="次の年度" onClick={() => onFiscalYear(fiscalYear + 1)} className={yearButtonClass}>
          <ChevronRight size={18} />
        </button>
        <span className="flex-1" />
        <span className="text-[11px] text-gray-400 tabular-nums">
          {fiscalYear}年4月〜{fiscalYear + 1}年3月
        </span>
      </div>

      {/* 右下の「＋」に最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        <div className="space-y-2.5 pb-5">
          <div className="space-y-1.5 rounded-2xl border border-gray-200 bg-white p-3.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex-1 text-xs text-gray-500">年の収支（収入 − 生活費 − 貯金）</span>
              <span className={`text-[26px] font-bold tabular-nums ${total.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatSignedYen(total.balance)}
              </span>
            </div>
            <div className="flex justify-between gap-2 text-[13px] tabular-nums">
              <span className="text-gray-700">収入</span>
              <span className="font-semibold text-gray-900">{formatYen(total.income)}</span>
            </div>
            <div className="flex justify-between gap-2 text-[13px] tabular-nums">
              <span className="text-gray-700">
                生活費
                <span className={`text-[11px] ${total.livingDiff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  　予算との差 {formatSignedYen(total.livingDiff)}
                </span>
              </span>
              <span className="font-semibold text-gray-900">−{formatYen(total.living)}</span>
            </div>
            <div className="flex justify-between gap-2 text-[13px] tabular-nums">
              <span className="text-gray-700">貯金</span>
              <span className="font-semibold text-gray-900">−{formatYen(total.saving)}</span>
            </div>
            <p className="text-[11px] text-gray-400">特別費は年の収支に入れず、下で予定と実績を見ます</p>
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white text-xs tabular-nums">
            <div className="flex items-center bg-gray-50 px-2.5 py-2 text-[11px] font-bold text-gray-500">
              <span className="w-9">月</span>
              <span className="flex-1 text-right">収入</span>
              <span className="flex-1 text-right">生活費</span>
              <span className="flex-1 text-right">貯金</span>
              <span className="flex-1 text-right">収支</span>
            </div>
            {summary.months.map((row) => {
              const future = row.monthKey > today;
              const month = Number(row.monthKey.slice(5, 7));
              return (
                <button
                  key={row.monthKey}
                  type="button"
                  aria-label={`${month}月の月の収支を見る`}
                  onClick={() => onSelectMonth(row.monthKey)}
                  className="flex w-full items-center border-t border-gray-200 px-2.5 py-2 text-left text-gray-700 hover:bg-gray-50"
                >
                  <span className="w-9 font-bold">{month}月</span>
                  {future ? (
                    <span className="flex-1 text-right text-gray-400">−</span>
                  ) : (
                    <>
                      <span className="flex-1 text-right">{formatYen(row.income)}</span>
                      <span className={`flex-1 text-right ${row.livingDiff < 0 ? 'text-red-600' : ''}`}>{formatYen(row.living)}</span>
                      <span className="flex-1 text-right">{formatYen(row.saving)}</span>
                      <span className={`flex-1 text-right font-bold ${row.balance < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                        {formatSignedYen(row.balance)}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400">生活費が赤い月は、生活費の予算を超えた月。月を押すとその月の内訳へ</p>
        </div>

        <SpecialPanel familyId={familyId} fiscalYear={fiscalYear} onFiscalYear={onFiscalYear} onRecordsChanged={onRecordsChanged} />
      </div>
    </div>
  );
}
