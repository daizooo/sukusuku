'use client';

import { useMemo } from 'react';
import { formatAxisYen, niceTicks, type YearMonthRow } from '@/lib/moneyUtils';

// 年の月ごとの収支（棒）と、年初からの累計（折れ線）。docs/kakei.md §0.4。
// mobile版の `mobile/src/components/money/YearFlowChart.tsx` と同じ並び・文言。
// 数える月だけに棒と点を出す（記録の無い月・開始月より前の月は空き）。増えた月の棒は緑、減った月は濃い灰。
// 年末の着地見込み（§4.6）を出すときは、締めた月を実線、見込みの月（forecast）を点線（棒は枠だけ・点は白抜き）にする。
// 2026-10-16: 前の形を基本に見やすくした。グラフを大きくし、棒ごとに収支の額（万円）を添え、月は「10月」の形で出す。
// 月の縦の帯を押すと、その月の実績（月の振り返り）へ飛ぶ。凡例は「棒」「線」と書く。

const WIDTH = 360;
const HEIGHT = 240;
const PAD = { left: 50, right: 8, top: 22, bottom: 30 };
const GREEN = '#43b02a';
const GRAY = '#374151';
const BLUE = '#2563eb';

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
    // 隣り合う数える月をつなぐ線。どちらかが見込みなら点線。
    const points = months.flatMap((month, index) => (month.recorded ? [{ month, index }] : []));
    const segments = points.slice(1).map((point, offset) => ({
      key: point.month.monthKey,
      from: points[offset],
      to: point,
      forecast: Boolean(points[offset].month.forecast || point.month.forecast),
    }));
    return { ticks, x, y, slot, segments };
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
            const fill = month.balance >= 0 ? GREEN : GRAY;
            const top = Math.min(geometry.y(0), geometry.y(month.balance));
            const barHeight = Math.max(Math.abs(geometry.y(month.balance) - geometry.y(0)), 1);
            const barWidth = Math.min(geometry.slot * 0.62, 24);
            return (
              <rect
                key={month.monthKey}
                x={geometry.x(index) - barWidth / 2}
                y={top}
                width={barWidth}
                height={barHeight}
                rx={2}
                fill={month.forecast ? 'none' : fill}
                stroke={month.forecast ? fill : undefined}
                strokeWidth={month.forecast ? 1.5 : undefined}
                strokeDasharray={month.forecast ? '3 2' : undefined}
              />
            );
          })}
          {months.map((month, index) => {
            if (!month.recorded) return null;
            const above = month.balance >= 0;
            return (
              <text
                key={`value-${month.monthKey}`}
                x={geometry.x(index)}
                y={geometry.y(month.balance) + (above ? -5 : 12)}
                fontSize={10}
                fontWeight={700}
                fill="#111827"
                textAnchor="middle"
              >
                {formatAxisYen(month.balance)}
              </text>
            );
          })}
          {geometry.segments.map((segment) => (
            <line
              key={`line-${segment.key}`}
              x1={geometry.x(segment.from.index)}
              y1={geometry.y(segment.from.month.cumulative)}
              x2={geometry.x(segment.to.index)}
              y2={geometry.y(segment.to.month.cumulative)}
              stroke={BLUE}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeDasharray={segment.forecast ? '5 4' : undefined}
            />
          ))}
          {months.map((month, index) =>
            month.recorded ? (
              <circle
                key={`dot-${month.monthKey}`}
                cx={geometry.x(index)}
                cy={geometry.y(month.cumulative)}
                r={3.5}
                fill={month.forecast ? '#ffffff' : BLUE}
                stroke={month.forecast ? BLUE : undefined}
                strokeWidth={month.forecast ? 1.5 : undefined}
              />
            ) : null,
          )}
          {months.map((month, index) => (
            <text
              key={`month-${month.monthKey}`}
              x={geometry.x(index)}
              y={HEIGHT - 9}
              fontSize={11}
              fontWeight={600}
              fill={month.recorded ? '#111827' : '#9ca3af'}
              textAnchor="middle"
            >
              {Number(month.monthKey.slice(5, 7))}月
            </text>
          ))}
          {/* 月の縦の帯を押すと、その月の実績へ。 */}
          {months.map((month, index) =>
            month.recorded ? (
              <rect
                key={`hit-${month.monthKey}`}
                x={PAD.left + index * geometry.slot}
                y={0}
                width={geometry.slot}
                height={HEIGHT}
                fill="transparent"
                className="cursor-pointer"
                role="button"
                aria-label={`${Number(month.monthKey.slice(5, 7))}月の実績を見る`}
                onClick={() => onSelectMonth(month.monthKey)}
              />
            ) : null,
          )}
        </svg>
      )}
      <div className="flex justify-center gap-4 pb-2">
        <span className={`flex items-center gap-1.5 text-xs font-semibold text-gray-600`}>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: GREEN }} />
          月の収支（棒）
        </span>
        <span className={`flex items-center gap-1.5 text-xs font-semibold text-gray-600`}>
          <span className="h-[3px] w-3.5 rounded-sm" style={{ backgroundColor: BLUE }} />
          年初からの累計（線）
        </span>
        {months.some((month) => month.recorded && month.forecast) && (
          <span className={`flex items-center gap-1.5 text-xs font-semibold text-gray-600`}>
            <span className="flex w-3.5 justify-between">
              <span className="h-[3px] w-[5px] rounded-sm" style={{ backgroundColor: BLUE }} />
              <span className="h-[3px] w-[5px] rounded-sm" style={{ backgroundColor: BLUE }} />
            </span>
            見込み（点線）
          </span>
        )}
      </div>
    </div>
  );
}
