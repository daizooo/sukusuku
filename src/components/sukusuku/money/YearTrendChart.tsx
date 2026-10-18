'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { formatAxisYen, formatSignedYen } from '@/lib/moneyUtils';
import { pickBubble, yearTrendAxes, type TrendBox, type YearTrendPoint } from '@/lib/yearTrend';

// 年の振り返りの「推移」（docs/kakei.md §4.8）。mobile版の `mobile/src/components/money/YearTrendChart.tsx` と同じ並び・文言。
// 棒＝月ごとの収支（左の軸）、折れ線＝年初からの累計（右の軸）。0 の高さは左右でそろえる。
// 横は使い始めた月にかかわらず、いつも1〜12月の幅（2026-10-18。数えない月は棒・点を出さず、月の名前だけ薄く出す）。
// 締めた月は実線・濃い棒、締めていない月と先の月は見込みなので点線・薄い棒で年末まで伸ばす（年末の着地見込みと同じ数え方。§4.6）。
// 月を押すと、その月の収支と累計を吹き出しで出す。吹き出しを押すとその月の振り返りへ移る。
// 吹き出しは、折れ線や棒をいちばん隠さない側（上・下・左・右）に置く。上に余白は取らない。
// マイナスは赤にせず「−」をつけた黒（棒は灰色）。幅は画面に合わせて伸び縮みする（viewBox）。

const WIDTH = 340;
const HEIGHT = 188;
const PAD = { left: 40, right: 40, top: 12, bottom: 26 };
const BAR_WIDTH = 12;
const BUBBLE = { width: 124, height: 50 };
const RADIUS = 8;
const TIP = 6;
const GAP = 8;

// 色は mobile の `colors`（mobile/src/lib/theme.ts）と同じ値。
const C = {
  surface: '#ffffff',
  border: '#e5e7eb',
  text: '#111827',
  textSubtle: '#374151',
  textMuted: '#6b7280',
  textFaint: '#9ca3af',
  neutralSurface: '#f3f4f6',
  money: '#2563eb',
  moneySoft: '#dbeafe',
  moneySurface: '#eff6ff',
  moneyRing: '#93c5fd',
  moneyIncome: '#43b02a',
};

const linePath = (dots: readonly (readonly [number, number])[]) =>
  dots.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

const pressKey = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
};

export default function YearTrendChart({
  points,
  initialMonthKey,
  onSelectMonth,
}: {
  points: YearTrendPoint[];
  /** はじめに吹き出しを出す月（今月）。その年に無ければ最後の月。 */
  initialMonthKey: string;
  /** 吹き出しを押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const layout = useMemo(() => {
    const axes = yearTrendAxes(points);
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const slot = plotWidth / 12;
    const yOf = (axis: { min: number; max: number }, value: number) =>
      PAD.top + ((axis.max - value) / (axis.max - axis.min)) * plotHeight;
    // index は points の並び。横の位置は月で決める（1月が左端）。
    const centerX = (index: number) => PAD.left + slot * (points[index].month - 1 + 0.5);
    const monthX = (month: number) => PAD.left + slot * (month - 0.5);
    const zeroY = yOf(axes.balance, 0);
    const bars: TrendBox[] = points.map((point, index) => {
      const y = yOf(axes.balance, point.balance);
      return { x: centerX(index) - BAR_WIDTH / 2, y: Math.min(zeroY, y), width: BAR_WIDTH, height: Math.max(1, Math.abs(y - zeroY)) };
    });
    const dots = points.map((point, index) => [centerX(index), yOf(axes.cumulative, point.cumulative)] as const);
    // 折れ線の上を通る点（吹き出しが隠す量を測る）。
    const line: (readonly [number, number])[] = [];
    for (let index = 0; index < dots.length - 1; index += 1) {
      const [x1, y1] = dots[index];
      const [x2, y2] = dots[index + 1];
      const steps = Math.max(1, Math.ceil(Math.abs(x2 - x1) / 3));
      for (let step = 0; step <= steps; step += 1) line.push([x1 + ((x2 - x1) * step) / steps, y1 + ((y2 - y1) * step) / steps]);
    }
    if (dots.length === 1) line.push([dots[0][0], dots[0][1]]);
    return { axes, plotHeight, slot, yOf, centerX, monthX, bars, dots, line };
  }, [points]);

  const lastClosed = points.reduce((last, point, index) => (point.closed ? index : last), -1);
  const byKey = (key: string | null) => points.findIndex((point) => point.monthKey === key);
  const selectedIndex = byKey(selectedKey) >= 0 ? byKey(selectedKey) : byKey(initialMonthKey) >= 0 ? byKey(initialMonthKey) : points.length - 1;
  const selected = points[selectedIndex];

  // 吹き出し
  const bar = layout.bars[selectedIndex];
  const dotY = layout.dots[selectedIndex][1];
  const markTop = Math.min(bar.y, dotY);
  const mark: TrendBox = { x: bar.x, y: markTop, width: bar.width, height: Math.max(bar.y + bar.height, dotY) - markTop };
  const { side, x, y } = pickBubble({
    mark,
    bubble: BUBBLE,
    bounds: { x: 2, y: 2, width: WIDTH - 4, height: HEIGHT - PAD.bottom - 2 },
    gap: GAP + TIP / 2,
    line: layout.line,
    bars: layout.bars,
    ownBar: selectedIndex,
  });
  const right = x + BUBBLE.width;
  const bottomEdge = y + BUBBLE.height;
  const pointerX = Math.min(Math.max(mark.x + mark.width / 2, x + RADIUS + TIP + 2), right - RADIUS - TIP - 2);
  const pointerY = Math.min(Math.max(mark.y + mark.height / 2, y + 14), bottomEdge - 14);
  const shape = [
    `M${x + RADIUS} ${y}`,
    side === 'below' ? `H${pointerX - TIP} L${pointerX} ${y - TIP} L${pointerX + TIP} ${y}` : '',
    `H${right - RADIUS} Q${right} ${y} ${right} ${y + RADIUS}`,
    side === 'left' ? `V${pointerY - TIP} L${right + TIP} ${pointerY} L${right} ${pointerY + TIP}` : '',
    `V${bottomEdge - RADIUS} Q${right} ${bottomEdge} ${right - RADIUS} ${bottomEdge}`,
    side === 'above' ? `H${pointerX + TIP} L${pointerX} ${bottomEdge + TIP} L${pointerX - TIP} ${bottomEdge}` : '',
    `H${x + RADIUS} Q${x} ${bottomEdge} ${x} ${bottomEdge - RADIUS}`,
    side === 'right' ? `V${pointerY + TIP} L${x - TIP} ${pointerY} L${x} ${pointerY - TIP}` : '',
    `V${y + RADIUS} Q${x} ${y} ${x + RADIUS} ${y} Z`,
  ].join(' ');
  const amountColor = (value: number) => (value > 0 ? C.moneyIncome : C.text);
  const openSelected = () => onSelectMonth(selected.monthKey);

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full" role="img" aria-label="月ごとの収支（棒）と年の累計（折れ線）">
      {/* 選んだ月の列の下地 */}
      <rect
        x={layout.centerX(selectedIndex) - layout.slot / 2 + 1}
        y={PAD.top}
        width={layout.slot - 2}
        height={layout.plotHeight}
        rx={6}
        fill={C.moneySurface}
      />
      {Array.from({ length: layout.axes.intervals + 1 }, (_, tick) => {
        const balanceValue = layout.axes.balance.min + layout.axes.balance.step * tick;
        const cumulativeValue = layout.axes.cumulative.min + layout.axes.cumulative.step * tick;
        const tickY = layout.yOf(layout.axes.balance, balanceValue);
        const zero = Math.abs(balanceValue) < 1e-6;
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={tickY} y2={tickY} stroke={zero ? C.textFaint : C.border} strokeWidth={zero ? 1 : 0.8} />
            <text x={PAD.left - 5} y={tickY + 3.5} fontSize={9.5} fontWeight={600} fill={C.textMuted} textAnchor="end">
              {formatAxisYen(balanceValue)}
            </text>
            <text x={WIDTH - PAD.right + 5} y={tickY + 3.5} fontSize={9.5} fontWeight={600} fill={C.money} textAnchor="start">
              {formatAxisYen(cumulativeValue)}
            </text>
          </g>
        );
      })}
      {points.map((point, index) => {
        const box = layout.bars[index];
        const negative = point.balance < 0;
        return (
          <g key={point.monthKey}>
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={2}
              fill={point.closed ? (negative ? C.textFaint : C.moneyRing) : negative ? C.neutralSurface : C.moneySoft}
              stroke={point.closed ? undefined : negative ? C.textFaint : C.moneyRing}
              strokeWidth={point.closed ? 0 : 1}
              strokeDasharray={point.closed ? undefined : '3 2'}
              opacity={index === selectedIndex ? 1 : 0.85}
            />
            <text
              x={layout.centerX(index)}
              y={HEIGHT - 8}
              fontSize={9.5}
              fontWeight={700}
              fill={index === selectedIndex ? C.text : C.textSubtle}
              textAnchor="middle"
            >
              {`${point.month}月`}
            </text>
          </g>
        );
      })}
      {Array.from({ length: 12 }, (_, offset) => offset + 1)
        .filter((month) => !points.some((point) => point.month === month))
        .map((month) => (
          <text key={`empty-${month}`} x={layout.monthX(month)} y={HEIGHT - 8} fontSize={9.5} fontWeight={700} fill={C.textFaint} textAnchor="middle">
            {`${month}月`}
          </text>
        ))}
      {lastClosed >= 1 && (
        <path d={linePath(layout.dots.slice(0, lastClosed + 1))} fill="none" stroke={C.money} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {lastClosed < points.length - 1 && (
        <path d={linePath(layout.dots.slice(Math.max(lastClosed, 0)))} fill="none" stroke={C.money} strokeWidth={2.2} strokeDasharray="4 3" strokeLinecap="round" />
      )}
      {layout.dots.map(([dotX, dotYValue], index) => (
        <circle
          key={points[index].monthKey}
          cx={dotX}
          cy={dotYValue}
          r={3}
          fill={points[index].closed ? C.money : C.surface}
          stroke={C.money}
          strokeWidth={1.6}
        />
      ))}
      {/* 月ごとの押せる範囲（列ぜんぶ） */}
      {points.map((point, index) => (
        <rect
          key={`hit-${point.monthKey}`}
          x={layout.centerX(index) - layout.slot / 2}
          y={PAD.top}
          width={layout.slot}
          height={HEIGHT - PAD.top}
          fill="transparent"
          className="cursor-pointer outline-none"
          role="button"
          tabIndex={0}
          aria-label={`${point.month}月の収支を見る`}
          onClick={() => setSelectedKey(point.monthKey)}
          onKeyDown={pressKey(() => setSelectedKey(point.monthKey))}
        />
      ))}
      <g
        className="cursor-pointer outline-none"
        role="button"
        tabIndex={0}
        aria-label={`${selected.month}月の振り返りを開く`}
        onClick={openSelected}
        onKeyDown={pressKey(openSelected)}
      >
        <path d={shape} fill={C.surface} stroke={C.moneyRing} strokeWidth={1.2} style={{ filter: 'drop-shadow(0 1px 2px rgba(17,24,39,0.2))' }} />
        <text x={x + 10} y={y + 17} fontSize={12} fontWeight={800} fill={C.text}>
          {`${selected.month}月`}
        </text>
        <text x={right - 10} y={y + 17} fontSize={15} fontWeight={700} fill={C.textFaint} textAnchor="end">
          ›
        </text>
        <text x={x + 10} y={y + 32} fontSize={10.5} fontWeight={600} fill={C.textMuted}>
          収支
        </text>
        <text x={right - 10} y={y + 32} fontSize={11} fontWeight={800} fill={amountColor(selected.balance)} textAnchor="end">
          {formatSignedYen(selected.balance)}
        </text>
        <text x={x + 10} y={y + 45} fontSize={10.5} fontWeight={600} fill={C.textMuted}>
          累計
        </text>
        <text x={right - 10} y={y + 45} fontSize={11} fontWeight={800} fill={amountColor(selected.cumulative)} textAnchor="end">
          {formatSignedYen(selected.cumulative)}
        </text>
      </g>
    </svg>
  );
}
