'use client';

import { useMemo } from 'react';
import { formatAxisYen, niceTicks, type YearMonthRow } from '@/lib/moneyUtils';
import { type } from './moneyVisual';

// 年の月ごとの収支（棒）と、年初からの累計（折れ線）。docs/kakei.md §0.4。
// mobile版の `mobile/src/components/money/YearFlowChart.tsx` と同じ並び・文言。
// 数える月だけに棒と点を出す（記録の無い月・開始月より前の月は空き）。増えた月の棒は緑、減った月は濃い灰。

const WIDTH = 360;
const HEIGHT = 170;
const PAD = { left: 52, right: 10, top: 12, bottom: 24 };
const GREEN = '#43b02a';
const GRAY = '#374151';
const BLUE = '#2563eb';

type Month = Pick<YearMonthRow, 'monthKey' | 'recorded' | 'balance' | 'cumulative'>;

export default function YearFlowChart({ months }: { months: Month[] }) {
  const geometry = useMemo(() => {
    const counted = months.filter((month) => month.recorded);
    if (counted.length === 0) return null;
    const values = [0, ...counted.flatMap((month) => [month.balance, month.cumulative])];
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const slot = plotWidth / months.length;
    const x = (index: number) => PAD.left + (index + 0.5) * slot;
    const y = (value: number) => PAD.top + (high === low ? plotHeight / 2 : (1 - (value - low) / (high - low)) * plotHeight);
    const line = months
      .map((month, index) => (month.recorded ? `${x(index)},${y(month.cumulative)}` : null))
      .filter((point): point is string => point !== null)
      .join(' ');
    return { ticks, x, y, slot, line };
  }, [months]);

  return (
    <div>
      {geometry && (
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full" role="img" aria-label="月ごとの収支と年初からの累計">
          {geometry.ticks.map((tick) => (
            <line
              key={tick}
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke="#d1d5db"
              strokeWidth={1}
              strokeDasharray={tick === 0 ? undefined : '4 4'}
            />
          ))}
          {geometry.ticks.map((tick) => (
            <text
              key={`label-${tick}`}
              x={PAD.left - 6}
              y={geometry.y(tick) + 4}
              fontSize={11}
              fontWeight={500}
              fill="#9ca3af"
              textAnchor="end"
            >
              {formatAxisYen(tick)}
            </text>
          ))}
          {months.map((month, index) => {
            if (!month.recorded) return null;
            const top = Math.min(geometry.y(0), geometry.y(month.balance));
            const barHeight = Math.max(Math.abs(geometry.y(month.balance) - geometry.y(0)), 1);
            const barWidth = Math.min(geometry.slot * 0.5, 22);
            return (
              <rect
                key={month.monthKey}
                x={geometry.x(index) - barWidth / 2}
                y={top}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill={month.balance >= 0 ? GREEN : GRAY}
              />
            );
          })}
          {geometry.line.includes(' ') && (
            <polyline points={geometry.line} fill="none" stroke={BLUE} strokeWidth={2.5} strokeLinejoin="round" />
          )}
          {months.map((month, index) =>
            month.recorded ? (
              <circle key={`dot-${month.monthKey}`} cx={geometry.x(index)} cy={geometry.y(month.cumulative)} r={3.5} fill={BLUE} />
            ) : null,
          )}
          {months.map((month, index) => (
            <text
              key={`month-${month.monthKey}`}
              x={geometry.x(index)}
              y={HEIGHT - 6}
              fontSize={11}
              fontWeight={500}
              fill={month.recorded ? '#6b7280' : '#9ca3af'}
              textAnchor="middle"
            >
              {Number(month.monthKey.slice(5, 7))}
            </text>
          ))}
        </svg>
      )}
      <div className="flex justify-center gap-4 pb-2">
        <span className={`flex items-center gap-1.5 ${type.faint}`}>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: GREEN }} />
          月の収支
        </span>
        <span className={`flex items-center gap-1.5 ${type.faint}`}>
          <span className="h-[3px] w-3.5 rounded-sm" style={{ backgroundColor: BLUE }} />
          年初からの累計
        </span>
      </div>
    </div>
  );
}
