'use client';

import { useMemo, useState, type PointerEvent } from 'react';
import {
  balanceChanges,
  filterTrend,
  formatAxisYen,
  formatBalance,
  niceTicks,
  TREND_PERIODS,
  type BalancePoint,
  type TrendPeriod,
} from '@/lib/moneyUtils';
import { swipeBoundary } from '../ui/useSwipeNavigation';
import { cardClass, minus, SectionHeader, type } from './moneyVisual';

// 残高の推移（docs/kakei.md §9.3）。mobile版の `mobile/src/components/money/BalanceTrend.tsx` と同じ並び・文言。
// 折れ線（日ごとの残高）・期間の切り替え（はじめは全期間）・対象期間の履歴（残高が変わった日。新しい順）。
// 総残高と出金元ごとの推移で同じものを使う。親のスクロールの中に置く（この中ではスクロールしない）。
// グラフに触れる（なぞる）と、その日の日付と残高を線の上に出す。指を離しても、次に触れるか期間を変えるまで残す。
// グラフの中の横の動きは日付の選択に使い、画面の切り替えのスワイプ（useSwipeTabs）へは渡さない。

const WIDTH = 360;
const TOOLTIP_AREA = 44; // 日付と残高の吹き出しを置く、グラフの上の余白
const HEIGHT = 200 + TOOLTIP_AREA;
const PAD = { left: 52, right: 10, top: 10 + TOOLTIP_AREA, bottom: 24 };
const TOOLTIP_WIDTH = 168;
const TOOLTIP_HEIGHT = 38;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
const FONT = '#9ca3af'; // gray-400（補足の薄い灰）

const shortDate = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
};
const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
};
const fullDateWithWeekday = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${fullDate(dateKey)}(${WEEKDAYS[new Date(year, month - 1, day).getDay()]})`;
};

function Chart({ points }: { points: BalancePoint[] }) {
  const [selected, setSelected] = useState<{ points: BalancePoint[]; index: number } | null>(null);
  // 期間を変えて points が入れ替わったら、選んでいた日は捨てる。
  const selectedIndex = selected && selected.points === points ? selected.index : null;
  const geometry = useMemo(() => {
    if (points.length === 0) return null;
    const values = points.map((point) => point.amount);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const x = (index: number) => PAD.left + (points.length === 1 ? plotWidth : (index / (points.length - 1)) * plotWidth);
    const y = (value: number) => PAD.top + (high === low ? plotHeight / 2 : (1 - (value - low) / (high - low)) * plotHeight);
    const labelIndexes = [0, 1, 2, 3].map((step) => Math.round((step / 3) * (points.length - 1)));
    return {
      ticks,
      x,
      y,
      line: points.map((point, index) => `${x(index)},${y(point.amount)}`).join(' '),
      labels: [...new Set(labelIndexes)],
    };
  }, [points]);
  if (geometry === null) return null;

  // 触れた位置にいちばん近い日を選ぶ。
  const select = (event: PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const ratio = (x - PAD.left) / (WIDTH - PAD.left - PAD.right);
    const index = Math.min(points.length - 1, Math.max(0, Math.round(ratio * (points.length - 1))));
    setSelected({ points, index });
  };
  const selectedPoint = selectedIndex === null ? null : points[selectedIndex];
  const tooltipLeft =
    selectedIndex === null
      ? 0
      : Math.min(Math.max(geometry.x(selectedIndex) - TOOLTIP_WIDTH / 2, 4), WIDTH - TOOLTIP_WIDTH - 4);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="mx-auto w-full max-w-[480px] touch-pan-y select-none"
      role="img"
      aria-label="残高の推移"
      {...swipeBoundary}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        select(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId) || event.pointerType === 'mouse') select(event);
      }}
    >
      {geometry.ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={geometry.y(tick)}
            y2={geometry.y(tick)}
            stroke="#d1d5db"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={PAD.left - 6} y={geometry.y(tick) + 4} fontSize={11} fontWeight={500} fill={FONT} textAnchor="end">
            {formatAxisYen(tick)}
          </text>
        </g>
      ))}
      {points.length > 1 ? (
        <polyline points={geometry.line} fill="none" stroke="#2563eb" strokeWidth={2.5} strokeLinejoin="round" />
      ) : (
        <circle cx={geometry.x(0)} cy={geometry.y(points[0].amount)} r={4} fill="#2563eb" />
      )}
      {selectedPoint && selectedIndex !== null && (
        <g pointerEvents="none">
          <line
            x1={geometry.x(selectedIndex)}
            x2={geometry.x(selectedIndex)}
            y1={PAD.top}
            y2={HEIGHT - PAD.bottom}
            stroke="#2563eb"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          <circle
            cx={geometry.x(selectedIndex)}
            cy={geometry.y(selectedPoint.amount)}
            r={5}
            fill="#ffffff"
            stroke="#2563eb"
            strokeWidth={2.5}
          />
          <rect x={tooltipLeft} y={0} width={TOOLTIP_WIDTH} height={TOOLTIP_HEIGHT} rx={8} fill="#2563eb" />
          <text x={tooltipLeft + TOOLTIP_WIDTH / 2} y={15} fontSize={11} fontWeight={600} fill="#ffffff" textAnchor="middle">
            {fullDateWithWeekday(selectedPoint.date)}
          </text>
          <text x={tooltipLeft + TOOLTIP_WIDTH / 2} y={32} fontSize={14} fontWeight={700} fill="#ffffff" textAnchor="middle">
            {formatBalance(selectedPoint.amount)}
          </text>
        </g>
      )}
      {geometry.labels.map((index) => (
        <text
          key={index}
          x={geometry.x(index)}
          y={HEIGHT - 6}
          fontSize={11}
          fontWeight={500}
          fill={FONT}
          textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
        >
          {shortDate(points[index].date)}
        </text>
      ))}
    </svg>
  );
}

/**
 * 残高の推移。points は全期間の日ごとの残高（古い順）。
 * 証券（評価額。毎日変わる）は、残高が変わった日の一覧を出さない（showHistory={false}）。
 */
export default function BalanceTrend({
  points,
  asOf,
  showHistory = true,
  emptyText = '記録も補正もまだないので、推移は出せません',
}: {
  points: BalancePoint[];
  asOf: string;
  showHistory?: boolean;
  emptyText?: string;
}) {
  const [period, setPeriod] = useState<TrendPeriod>('all');
  const shown = useMemo(() => filterTrend(points, period, asOf), [points, period, asOf]);
  const changes = useMemo(() => balanceChanges(shown), [shown]);

  if (points.length === 0) {
    return <p className="py-8 text-center text-sm text-gray-400">{emptyText}</p>;
  }
  return (
    <div>
      <Chart points={shown} />
      <div role="tablist" className="mt-2 flex justify-center gap-2">
        {TREND_PERIODS.map((entry) => {
          const selected = entry.id === period;
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setPeriod(entry.id)}
              className={`rounded-full px-3.5 py-1.5 text-[13px] ${
                selected ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-500'
              }`}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
      {showHistory && (
        <>
          <SectionHeader title="対象期間の履歴" />
          <div className={`${cardClass} overflow-hidden`}>
            {changes.map((point, index) => (
              <div
                key={point.date}
                className={`flex items-center justify-between px-3.5 py-3 ${index > 0 ? 'border-t border-gray-200' : ''}`}
              >
                <span className={type.row}>{fullDate(point.date)}</span>
                <span className={minus(type.amount, point.amount < 0)}>{formatBalance(point.amount)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
