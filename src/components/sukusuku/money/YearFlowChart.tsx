'use client';

import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatBalance, type YearMonthRow } from '@/lib/moneyUtils';
import { incomeAmountClass, type } from './moneyVisual';

// 年の月ごとの収支の推移（docs/kakei.md §0.4）。mobile版の `mobile/src/components/money/YearFlowChart.tsx` と同じ並び・文言。
// 2026-10-16に作り直した（棒と折れ線を重ねた縦のグラフは見にくかったため）: 月を1行ずつ縦に並べ、
// 中央の線（0）から、増えた月は右へ緑、減った月は左へ濃い灰の棒を伸ばし、右に収支の額を大きく出す。行を押すと、その月の実績（月の振り返り）へ飛ぶ。
// 数える月だけを出す（記録の無い月・使い始める前の月は出さない）。年末の着地見込み（§4.6）を出すときは、
// 締めていない月（forecast）を見込みとして、棒を枠だけの点線にして「見込み」と添える。

const GREEN = '#43b02a';
const GRAY = '#374151';

export type YearFlowMonth = Pick<YearMonthRow, 'monthKey' | 'recorded' | 'balance' | 'cumulative'> & {
  /** 見込みの月（点線）。 */
  forecast?: boolean;
};

export default function YearFlowChart({
  months,
  onSelectMonth,
}: {
  months: YearFlowMonth[];
  onSelectMonth: (monthKey: string) => void;
}) {
  const rows = useMemo(() => months.filter((month) => month.recorded), [months]);
  const scale = useMemo(() => {
    const negative = Math.max(0, ...rows.map((month) => -month.balance));
    const positive = Math.max(0, ...rows.map((month) => month.balance));
    const total = Math.max(negative + positive, 1);
    return { total, axis: negative / total };
  }, [rows]);

  return (
    <div className="divide-y divide-gray-200">
      {rows.map((month) => {
        const number = Number(month.monthKey.slice(5, 7));
        const gain = month.balance >= 0;
        const fill = gain ? GREEN : GRAY;
        const length = Math.abs(month.balance) / scale.total;
        const left = gain ? scale.axis : scale.axis - length;
        return (
          <button
            key={month.monthKey}
            type="button"
            aria-label={`${number}月の実績を見る`}
            onClick={() => onSelectMonth(month.monthKey)}
            className="flex w-full items-center gap-2 px-3 py-[7px] text-left hover:bg-gray-50"
          >
            <span className="w-[34px] shrink-0 text-sm font-bold text-gray-900">{number}月</span>
            <span className="relative block h-[22px] min-w-0 flex-1">
              <span className="absolute inset-y-0 w-px bg-gray-300" style={{ left: `${scale.axis * 100}%` }} />
              <span
                className="absolute inset-y-[2px] rounded-[3px]"
                style={{
                  left: `${left * 100}%`,
                  width: `${Math.max(length * 100, 0.8)}%`,
                  ...(month.forecast ? { border: `1.5px dashed ${fill}` } : { backgroundColor: fill }),
                }}
              />
            </span>
            <span className="flex w-[92px] shrink-0 flex-col items-end">
              <span className={`text-[15px] font-extrabold tabular-nums ${month.balance > 0 ? incomeAmountClass : 'text-gray-900'}`}>
                {formatBalance(month.balance)}
              </span>
              {month.forecast && <span className={type.faint}>見込み</span>}
            </span>
            <ChevronRight size={16} className="shrink-0 text-gray-400" />
          </button>
        );
      })}
    </div>
  );
}
