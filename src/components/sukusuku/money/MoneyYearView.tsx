'use client';

import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyWallet } from '@/types/app';
import { buildYearSummary, formatSignedYen, formatYen, monthKeyOfDate } from '@/lib/moneyUtils';
import { Hero, SectionHeader, StatRow, YearBar, cardClass, minus, type } from './moneyVisual';

// 家計タブの「年」（docs/kakei.md §4.2）。mobile版の `mobile/src/components/money/MoneyYearView.tsx` と同じ並び・文言。
//
// 結論は年度の収支（収入 − 生活費 − 貯金。特別費は入れず「特別費」の面で見る）。内訳に収入・生活費・貯金。
// その下に月ごとの収支（新しい月から。まだ来ていない月は出さない）。月を押すとその月の「月」へ。

interface MoneyYearViewProps {
  fiscalYear: number;
  onFiscalYear: (fiscalYear: number) => void;
  records: MoneyRecord[];
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  wallets: MoneyWallet[];
  onSelectMonth: (monthKey: string) => void;
}

export default function MoneyYearView({
  fiscalYear,
  onFiscalYear,
  records,
  categories,
  budgets,
  wallets,
  onSelectMonth,
}: MoneyYearViewProps) {
  const today = monthKeyOfDate(new Date());
  const summary = useMemo(
    () => buildYearSummary(records, categories, budgets, wallets, fiscalYear, today),
    [records, categories, budgets, wallets, fiscalYear, today],
  );
  const { total } = summary;
  const months = summary.months.filter((row) => row.monthKey <= today).reverse();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <YearBar fiscalYear={fiscalYear} onChange={onFiscalYear} />
      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pb-24">
        <Hero
          label="年の収支"
          value={formatSignedYen(total.balance)}
          isMinus={total.balance < 0}
          note={`記録のある${summary.recordedMonths}か月ぶん・特別費は入れない`}
        >
          <StatRow label="収入" value={`+${formatYen(total.income)}`} />
          <StatRow
            label="生活費"
            note={total.livingDiff < 0 ? `予算より ${formatYen(total.livingDiff)} 多い` : `予算より ${formatYen(total.livingDiff)} 少ない`}
            noteMinus={total.livingDiff < 0}
            value={`−${formatYen(total.living)}`}
          />
          <StatRow label="貯金" value={`−${formatYen(total.saving)}`} />
        </Hero>

        <SectionHeader title="月ごと" hint="押すとその月へ" />
        {months.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-gray-400">この年度はまだ始まっていません</p>
        ) : (
          <div className={`${cardClass} overflow-hidden`}>
            {months.map((row, index) => {
              const month = Number(row.monthKey.slice(5, 7));
              return (
                <button
                  key={row.monthKey}
                  type="button"
                  aria-label={`${month}月の月の収支を見る`}
                  onClick={() => onSelectMonth(row.monthKey)}
                  className={`flex w-full items-center gap-2.5 px-3.5 py-3 text-left hover:bg-gray-50 ${
                    index > 0 ? 'border-t border-gray-200' : ''
                  }`}
                >
                  <span className="w-10 text-[15px] font-bold text-gray-900 tabular-nums">{month}月</span>
                  {row.recorded ? (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className={`block ${type.faint}`}>収入 {formatYen(row.income)}</span>
                        <span className={`block ${minus(type.faint, row.livingDiff < 0)}`}>
                          生活費 {formatYen(row.living)}
                          {row.livingDiff < 0 ? '（予算超え）' : ''}
                        </span>
                      </span>
                      <span className={minus(type.amount, row.balance < 0)}>{formatSignedYen(row.balance)}</span>
                    </>
                  ) : (
                    <span className={`flex-1 ${type.faint}`}>記録なし</span>
                  )}
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
