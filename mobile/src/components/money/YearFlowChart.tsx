import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { formatAxisYen, niceTicks, type YearMonthRow } from '@/lib/moneyUtils';
import { type } from '@/components/money/moneyVisual';

// 年の月ごとの収支（棒）と、年初からの累計（折れ線）。docs/kakei.md §0.4。
// PWA版の `src/components/sukusuku/money/YearFlowChart.tsx` と同じ並び・文言。
// 数える月だけに棒と点を出す（記録の無い月・開始月より前の月は空き）。増えた月の棒は緑、減った月は濃い灰。

const HEIGHT = 170;
const PAD = { left: 52, right: 10, top: 12, bottom: 24 };

type Month = Pick<YearMonthRow, 'monthKey' | 'recorded' | 'balance' | 'cumulative'>;

export default function YearFlowChart({ months }: { months: Month[] }) {
  const [width, setWidth] = useState(0);
  const geometry = useMemo(() => {
    const counted = months.filter((month) => month.recorded);
    if (counted.length === 0 || width === 0) return null;
    const values = [0, ...counted.flatMap((month) => [month.balance, month.cumulative])];
    const ticks = niceTicks(Math.min(...values), Math.max(...values));
    const low = ticks[0];
    const high = ticks[ticks.length - 1];
    const plotWidth = width - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;
    const slot = plotWidth / months.length;
    const x = (index: number) => PAD.left + (index + 0.5) * slot;
    const y = (value: number) => PAD.top + (high === low ? plotHeight / 2 : (1 - (value - low) / (high - low)) * plotHeight);
    const line = months
      .map((month, index) => (month.recorded ? `${x(index)},${y(month.cumulative)}` : null))
      .filter((point): point is string => point !== null)
      .join(' ');
    return { ticks, x, y, slot, line };
  }, [months, width]);

  return (
    <View>
      <View style={styles.chart} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {geometry && (
          <Svg width={width} height={HEIGHT}>
            {geometry.ticks.map((tick) => (
              <Line
                key={tick}
                x1={PAD.left}
                x2={width - PAD.right}
                y1={geometry.y(tick)}
                y2={geometry.y(tick)}
                stroke={colors.borderStrong}
                strokeWidth={1}
                strokeDasharray={tick === 0 ? undefined : '4 4'}
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
            {months.map((month, index) => {
              if (!month.recorded) return null;
              const top = Math.min(geometry.y(0), geometry.y(month.balance));
              const barHeight = Math.max(Math.abs(geometry.y(month.balance) - geometry.y(0)), 1);
              const barWidth = Math.min(geometry.slot * 0.5, 22);
              return (
                <Rect
                  key={month.monthKey}
                  x={geometry.x(index) - barWidth / 2}
                  y={top}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill={month.balance >= 0 ? colors.moneyIncome : colors.textSubtle}
                />
              );
            })}
            {geometry.line.includes(' ') ? (
              <Polyline points={geometry.line} fill="none" stroke={colors.money} strokeWidth={2.5} strokeLinejoin="round" />
            ) : null}
            {months.map((month, index) =>
              month.recorded ? (
                <Circle key={`dot-${month.monthKey}`} cx={geometry.x(index)} cy={geometry.y(month.cumulative)} r={3.5} fill={colors.money} />
              ) : null,
            )}
            {months.map((month, index) => (
              <SvgText
                key={`month-${month.monthKey}`}
                x={geometry.x(index)}
                y={HEIGHT - 6}
                fontSize={11}
                fontWeight="500"
                fill={month.recorded ? colors.textMuted : colors.textFaint}
                textAnchor="middle"
              >
                {Number(month.monthKey.slice(5, 7))}
              </SvgText>
            ))}
          </Svg>
        )}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.moneyIncome }]} />
          <Text style={type.faint}>月の収支</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatchLine, { backgroundColor: colors.money }]} />
          <Text style={type.faint}>年初からの累計</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: HEIGHT },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', paddingBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  swatchLine: { width: 14, height: 3, borderRadius: 2 },
});
