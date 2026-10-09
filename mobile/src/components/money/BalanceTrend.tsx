import { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { colors } from '@/lib/theme';
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
import { SectionHeader, type } from '@/components/money/moneyVisual';

// 残高の推移（docs/kakei.md §9.3）。PWA版の `src/components/sukusuku/money/BalanceTrend.tsx` と同じ並び・文言。
// 折れ線（日ごとの残高）・期間の切り替え（はじめは全期間）・対象期間の履歴（残高が変わった日。新しい順）。
// 総残高と出金元ごとの推移で同じものを使う。親のスクロールの中に置く（この中ではスクロールしない）。
// グラフに触れる（なぞる）と、その日の日付と残高を線の上に出す。指を離しても、次に触れるか期間を変えるまで残す。
// グラフの中の横の動きは日付の選択に使い、画面の切り替えのスワイプ（useSwipeTabs）へは渡さない。

const TOOLTIP_AREA = 44; // 日付と残高の吹き出しを置く、グラフの上の余白
const CHART_HEIGHT = 200 + TOOLTIP_AREA;
const PAD = { left: 52, right: 10, top: 10 + TOOLTIP_AREA, bottom: 24 };
const TOOLTIP_WIDTH = 168;
const TOOLTIP_HEIGHT = 38;
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

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
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<{ points: BalancePoint[]; index: number } | null>(null);
  // 期間を変えて points が入れ替わったら、選んでいた日は捨てる。
  const selectedIndex = selected && selected.points === points ? selected.index : null;
  const geometry = useMemo(() => {
    if (points.length === 0 || width === 0) return null;
    const values = points.map((point) => point.amount);
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const plotWidth = width - PAD.left - PAD.right;
    const plotHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
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
  }, [points, width]);

  // 触れた位置（グラフ左端からの x）にいちばん近い日を選ぶ。
  const latest = useRef({ points, width });
  latest.current = { points, width };
  const select = useRef((event: GestureResponderEvent) => {
    const { points: current, width: currentWidth } = latest.current;
    const plotWidth = currentWidth - PAD.left - PAD.right;
    if (current.length === 0 || plotWidth <= 0) return;
    const ratio = (event.nativeEvent.locationX - PAD.left) / plotWidth;
    const index = Math.min(current.length - 1, Math.max(0, Math.round(ratio * (current.length - 1))));
    setSelected({ points: current, index });
  }).current;
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: select,
        onPanResponderMove: select,
      }),
    [select],
  );

  const selectedPoint = selectedIndex === null ? null : points[selectedIndex];
  const tooltipLeft =
    geometry && selectedIndex !== null
      ? Math.min(Math.max(geometry.x(selectedIndex) - TOOLTIP_WIDTH / 2, 4), Math.max(width - TOOLTIP_WIDTH - 4, 4))
      : 0;

  return (
    <View
      style={styles.chart}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      {...swipeBoundary}
      {...panResponder.panHandlers}
    >
      {geometry && (
        <Svg width={width} height={CHART_HEIGHT}>
          {geometry.ticks.map((tick) => (
            <Line
              key={tick}
              x1={PAD.left}
              x2={width - PAD.right}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke={colors.borderStrong}
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          ))}
          {geometry.ticks.map((tick) => (
            <SvgText
              key={`label-${tick}`}
              x={PAD.left - 6}
              y={geometry.y(tick) + 4}
              fontSize={11}
              fontWeight="500"
              fill={colors.textFaint}
              textAnchor="end"
            >
              {formatAxisYen(tick)}
            </SvgText>
          ))}
          {points.length > 1 ? (
            <Polyline points={geometry.line} fill="none" stroke={colors.money} strokeWidth={2.5} strokeLinejoin="round" />
          ) : (
            <Circle cx={geometry.x(0)} cy={geometry.y(points[0].amount)} r={4} fill={colors.money} />
          )}
          {selectedPoint && selectedIndex !== null && (
            <>
              <Line
                x1={geometry.x(selectedIndex)}
                x2={geometry.x(selectedIndex)}
                y1={PAD.top}
                y2={CHART_HEIGHT - PAD.bottom}
                stroke={colors.money}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
              <Circle
                cx={geometry.x(selectedIndex)}
                cy={geometry.y(selectedPoint.amount)}
                r={5}
                fill={colors.surface}
                stroke={colors.money}
                strokeWidth={2.5}
              />
            </>
          )}
          {geometry.labels.map((index) => (
            <SvgText
              key={`date-${index}`}
              x={geometry.x(index)}
              y={CHART_HEIGHT - 6}
              fontSize={11}
              fontWeight="500"
              fill={colors.textFaint}
              textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            >
              {shortDate(points[index].date)}
            </SvgText>
          ))}
        </Svg>
      )}
      {selectedPoint && (
        <View pointerEvents="none" style={[styles.tooltip, { left: tooltipLeft }]}>
          <Text style={styles.tooltipDate}>{fullDateWithWeekday(selectedPoint.date)}</Text>
          <Text style={styles.tooltipAmount}>{formatBalance(selectedPoint.amount)}</Text>
        </View>
      )}
    </View>
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
    return <Text style={styles.empty}>{emptyText}</Text>;
  }
  return (
    <View>
      <Chart points={shown} />
      <View accessibilityRole="tablist" style={styles.periods}>
        {TREND_PERIODS.map((entry) => {
          const selected = entry.id === period;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setPeriod(entry.id)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{entry.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {showHistory && (
        <>
          <SectionHeader title="対象期間の履歴" />
          <View style={styles.list}>
            {changes.map((point, index) => (
              <View key={point.date} style={[styles.row, index > 0 && styles.rowDivided]}>
                <Text style={type.row}>{fullDate(point.date)}</Text>
                <Text style={[type.amount, point.amount < 0 && type.minus]}>{formatBalance(point.amount)}</Text>
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: CHART_HEIGHT },
  tooltip: {
    position: 'absolute',
    top: 0,
    width: TOOLTIP_WIDTH,
    height: TOOLTIP_HEIGHT,
    borderRadius: 8,
    backgroundColor: colors.money,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tooltipDate: { fontSize: 11, fontWeight: '600', color: '#ffffff' },
  tooltipAmount: { fontSize: 14, fontWeight: '700', color: '#ffffff' },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  periods: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginTop: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.neutralSurface },
  chipSelected: { backgroundColor: colors.moneySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  chipTextSelected: { color: colors.moneyText, fontWeight: '700' },
  list: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
});
