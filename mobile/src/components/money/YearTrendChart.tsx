import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { formatAxisYen, formatSignedYen } from '@/lib/moneyUtils';
import { pickBubble, yearTrendAxes, type TrendBox, type YearTrendAxes, type YearTrendPoint } from '@/lib/yearTrend';

// 年の振り返りの「推移」（docs/kakei.md §4.8）。PWA版の `src/components/sukusuku/money/YearTrendChart.tsx` と同じ並び・文言。
// 棒＝月ごとの収支（左の軸）、折れ線＝年初からの累計（右の軸）。0 の高さは左右でそろえる。
// 横は使い始めた月にかかわらず、いつも1〜12月の幅（2026-10-18。数えない月は棒・点を出さず、月の名前だけ薄く出す）。
// 締めた月は実線・濃い棒、締めていない月と先の月は見込みなので点線・薄い棒で年末まで伸ばす（年末の着地見込みと同じ数え方。§4.6）。
// 月を押すと、その月の収支と累計を吹き出しで出す。吹き出しを押すとその月の振り返りへ移る。
// 吹き出しは、折れ線や棒をいちばん隠さない側（上・下・左・右）に置く。上に余白は取らない。
// マイナスは赤にせず「−」をつけた黒（棒は灰色）。

const HEIGHT = 188;
const PAD = { left: 40, right: 40, top: 12, bottom: 26 };
const BAR_WIDTH = 12;
const BUBBLE = { width: 124, height: 50 };
const RADIUS = 8;
const TIP = 6;
const GAP = 8;

interface YearTrendChartProps {
  points: YearTrendPoint[];
  /** はじめに吹き出しを出す月（今月）。その年に無ければ最後の月。 */
  initialMonthKey: string;
  /** 吹き出しを押したとき。その月の月の振り返りへ。 */
  onSelectMonth: (monthKey: string) => void;
}

export default function YearTrendChart({ points, initialMonthKey, onSelectMonth }: YearTrendChartProps) {
  const [width, setWidth] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const layout = useMemo((): Layout | null => {
    if (width === 0 || points.length === 0) return null;
    const axes = yearTrendAxes(points);
    const plotWidth = width - PAD.left - PAD.right;
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
  }, [width, points]);

  const lastClosed = points.reduce((last, point, index) => (point.closed ? index : last), -1);
  const selectedIndex = (() => {
    const byKey = (key: string | null) => points.findIndex((point) => point.monthKey === key);
    const picked = byKey(selectedKey);
    if (picked >= 0) return picked;
    const initial = byKey(initialMonthKey);
    return initial >= 0 ? initial : points.length - 1;
  })();

  return (
    <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {layout && (
        <Svg width={width} height={HEIGHT}>
          {/* 選んだ月の列の下地 */}
          <Rect
            x={layout.centerX(selectedIndex) - layout.slot / 2 + 1}
            y={PAD.top}
            width={layout.slot - 2}
            height={layout.plotHeight}
            rx={6}
            fill={colors.moneySurface}
          />
          {Array.from({ length: layout.axes.intervals + 1 }, (_, tick) => {
            const balanceValue = layout.axes.balance.min + layout.axes.balance.step * tick;
            const cumulativeValue = layout.axes.cumulative.min + layout.axes.cumulative.step * tick;
            const y = layout.yOf(layout.axes.balance, balanceValue);
            const zero = Math.abs(balanceValue) < 1e-6;
            return (
              <G key={tick}>
                <Line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke={zero ? colors.textFaint : colors.border} strokeWidth={zero ? 1 : 0.8} />
                {/* 目盛りの数字は上端と下端だけ（0 は線だけ） */}
                {!zero && (
                  <>
                    <SvgText x={PAD.left - 5} y={y + 3.5} fontSize={9.5} fontWeight="600" fill={colors.textMuted} textAnchor="end">
                      {formatAxisYen(balanceValue)}
                    </SvgText>
                    <SvgText x={width - PAD.right + 5} y={y + 3.5} fontSize={9.5} fontWeight="600" fill={colors.money} textAnchor="start">
                      {formatAxisYen(cumulativeValue)}
                    </SvgText>
                  </>
                )}
              </G>
            );
          })}
          {points.map((point, index) => {
            const bar = layout.bars[index];
            const negative = point.balance < 0;
            return (
              <G key={point.monthKey}>
                <Rect
                  x={bar.x}
                  y={bar.y}
                  width={bar.width}
                  height={bar.height}
                  rx={2}
                  fill={point.closed ? (negative ? colors.textFaint : colors.moneyRing) : negative ? colors.neutralSurface : colors.moneySoft}
                  stroke={point.closed ? undefined : negative ? colors.textFaint : colors.moneyRing}
                  strokeWidth={point.closed ? 0 : 1}
                  strokeDasharray={point.closed ? undefined : '3 2'}
                  opacity={index === selectedIndex ? 1 : 0.85}
                />
                <SvgText
                  x={layout.centerX(index)}
                  y={HEIGHT - 8}
                  fontSize={9.5}
                  fontWeight="700"
                  fill={index === selectedIndex ? colors.text : colors.textSubtle}
                  textAnchor="middle"
                >
                  {`${point.month}月`}
                </SvgText>
              </G>
            );
          })}
          {Array.from({ length: 12 }, (_, offset) => offset + 1)
            .filter((month) => !points.some((point) => point.month === month))
            .map((month) => (
              <SvgText key={`empty-${month}`} x={layout.monthX(month)} y={HEIGHT - 8} fontSize={9.5} fontWeight="700" fill={colors.textFaint} textAnchor="middle">
                {`${month}月`}
              </SvgText>
            ))}
          {lastClosed >= 1 && <Path d={linePath(layout.dots.slice(0, lastClosed + 1))} fill="none" stroke={colors.money} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />}
          {lastClosed < points.length - 1 && (
            <Path
              d={linePath(layout.dots.slice(Math.max(lastClosed, 0)))}
              fill="none"
              stroke={colors.money}
              strokeWidth={2.2}
              strokeDasharray="4 3"
              strokeLinecap="round"
            />
          )}
          {layout.dots.map(([x, y], index) => (
            <Circle
              key={points[index].monthKey}
              cx={x}
              cy={y}
              r={3}
              fill={points[index].closed ? colors.money : colors.surface}
              stroke={colors.money}
              strokeWidth={1.6}
            />
          ))}
          {/* 月ごとの押せる範囲（列ぜんぶ） */}
          {points.map((point, index) => (
            <Rect
              key={`hit-${point.monthKey}`}
              x={layout.centerX(index) - layout.slot / 2}
              y={PAD.top}
              width={layout.slot}
              height={HEIGHT - PAD.top}
              fill="transparent"
              onPress={() => setSelectedKey(point.monthKey)}
            />
          ))}
          <Bubble
            point={points[selectedIndex]}
            index={selectedIndex}
            layout={layout}
            width={width}
            onPress={() => onSelectMonth(points[selectedIndex].monthKey)}
          />
        </Svg>
      )}
    </View>
  );
}

const linePath = (dots: readonly (readonly [number, number])[]) =>
  dots.map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');

interface Layout {
  axes: YearTrendAxes;
  plotHeight: number;
  slot: number;
  yOf: (axis: { min: number; max: number }, value: number) => number;
  centerX: (index: number) => number;
  monthX: (month: number) => number;
  bars: TrendBox[];
  dots: (readonly [number, number])[];
  line: (readonly [number, number])[];
}

function Bubble({ point, index, layout, width, onPress }: { point: YearTrendPoint; index: number; layout: Layout; width: number; onPress: () => void }) {
  const bar = layout.bars[index];
  const dotY = layout.dots[index][1];
  const top = Math.min(bar.y, dotY);
  const bottom = Math.max(bar.y + bar.height, dotY);
  const mark: TrendBox = { x: bar.x, y: top, width: bar.width, height: bottom - top };
  const { side, x, y } = pickBubble({
    mark,
    bubble: BUBBLE,
    bounds: { x: 2, y: 2, width: width - 4, height: HEIGHT - PAD.bottom - 2 },
    gap: GAP + TIP / 2,
    line: layout.line,
    bars: layout.bars,
    ownBar: index,
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
  const amountColor = (value: number) => (value > 0 ? colors.moneyIncome : colors.text);
  return (
    <G onPress={onPress}>
      <Path d={shape} fill={colors.surface} stroke={colors.moneyRing} strokeWidth={1.2} />
      <SvgText x={x + 10} y={y + 17} fontSize={12} fontWeight="800" fill={colors.text}>
        {`${point.month}月`}
      </SvgText>
      <SvgText x={right - 10} y={y + 17} fontSize={15} fontWeight="700" fill={colors.textFaint} textAnchor="end">
        ›
      </SvgText>
      <SvgText x={x + 10} y={y + 32} fontSize={10.5} fontWeight="600" fill={colors.textMuted}>
        収支
      </SvgText>
      <SvgText x={right - 10} y={y + 32} fontSize={11} fontWeight="800" fill={amountColor(point.balance)} textAnchor="end">
        {formatSignedYen(point.balance)}
      </SvgText>
      <SvgText x={x + 10} y={y + 45} fontSize={10.5} fontWeight="600" fill={colors.textMuted}>
        累計
      </SvgText>
      <SvgText x={right - 10} y={y + 45} fontSize={11} fontWeight="800" fill={amountColor(point.cumulative)} textAnchor="end">
        {formatSignedYen(point.cumulative)}
      </SvgText>
    </G>
  );
}

const styles = StyleSheet.create({
  chart: { height: HEIGHT },
});
