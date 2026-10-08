import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';
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

const CHART_HEIGHT = 200;
const PAD = { left: 52, right: 10, top: 10, bottom: 24 };

const shortDate = (dateKey: string) => {
  const [, month, day] = dateKey.split('-').map(Number);
  return `${month}/${day}`;
};
const fullDate = (dateKey: string) => {
  const [year, month, day] = dateKey.split('-').map(Number);
  return `${year}年${String(month).padStart(2, '0')}月${String(day).padStart(2, '0')}日`;
};

function Chart({ points }: { points: BalancePoint[] }) {
  const [width, setWidth] = useState(0);
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

  return (
    <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
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
    </View>
  );
}

/** 残高の推移。points は全期間の日ごとの残高（古い順）。 */
export default function BalanceTrend({ points, asOf }: { points: BalancePoint[]; asOf: string }) {
  const [period, setPeriod] = useState<TrendPeriod>('all');
  const shown = useMemo(() => filterTrend(points, period, asOf), [points, period, asOf]);
  const changes = useMemo(() => balanceChanges(shown), [shown]);

  if (points.length === 0) {
    return <Text style={styles.empty}>記録も補正もまだないので、推移は出せません</Text>;
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
      <SectionHeader title="対象期間の履歴" />
      <View style={styles.list}>
        {changes.map((point, index) => (
          <View key={point.date} style={[styles.row, index > 0 && styles.rowDivided]}>
            <Text style={type.row}>{fullDate(point.date)}</Text>
            <Text style={[type.amount, point.amount < 0 && type.minus]}>{formatBalance(point.amount)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: CHART_HEIGHT },
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
