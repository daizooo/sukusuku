import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';
import { colors } from '@/lib/theme';
import { formatAxisYen, niceTicks, type YearMonthRow } from '@/lib/moneyUtils';

// 年の月ごとの収支（棒）と、年初からの累計（折れ線）。docs/kakei.md §0.4。
// PWA版の `src/components/sukusuku/money/YearFlowChart.tsx` と同じ並び・文言。
// 数える月だけに棒と点を出す（記録の無い月・開始月より前の月は空き）。増えた月の棒は緑、減った月は濃い灰。
// 年末の着地見込み（§4.6）を出すときは、締めた月を実線、見込みの月（forecast）を点線（棒は枠だけ・点は白抜き）にする。
// 2026-10-16: 前の形を基本に見やすくした。グラフを大きくし、棒ごとに収支の額（万円）を添え、月は「10月」の形で出す。
// 月の縦の帯を押すと、その月の実績（月の振り返り）へ飛ぶ。凡例は「棒」「線」と書く。

const HEIGHT = 240;
const PAD = { left: 50, right: 8, top: 22, bottom: 30 };

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
    // 隣り合う数える月をつなぐ線。どちらかが見込みなら点線。
    const points = months.flatMap((month, index) => (month.recorded ? [{ month, index }] : []));
    const segments = points.slice(1).map((point, offset) => ({
      key: point.month.monthKey,
      from: points[offset],
      to: point,
      forecast: Boolean(points[offset].month.forecast || point.month.forecast),
    }));
    return { ticks, x, y, slot, segments };
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
              const fill = month.balance >= 0 ? colors.moneyIncome : colors.textSubtle;
              const top = Math.min(geometry.y(0), geometry.y(month.balance));
              const barHeight = Math.max(Math.abs(geometry.y(month.balance) - geometry.y(0)), 1);
              const barWidth = Math.min(geometry.slot * 0.62, 24);
              return (
                <Rect
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
                <SvgText
                  key={`value-${month.monthKey}`}
                  x={geometry.x(index)}
                  y={geometry.y(month.balance) + (above ? -5 : 12)}
                  fontSize={10}
                  fontWeight="700"
                  fill={colors.text}
                  textAnchor="middle"
                >
                  {formatAxisYen(month.balance)}
                </SvgText>
              );
            })}
            {geometry.segments.map((segment) => (
              <Line
                key={`line-${segment.key}`}
                x1={geometry.x(segment.from.index)}
                y1={geometry.y(segment.from.month.cumulative)}
                x2={geometry.x(segment.to.index)}
                y2={geometry.y(segment.to.month.cumulative)}
                stroke={colors.money}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={segment.forecast ? '5 4' : undefined}
              />
            ))}
            {months.map((month, index) =>
              month.recorded ? (
                <Circle
                  key={`dot-${month.monthKey}`}
                  cx={geometry.x(index)}
                  cy={geometry.y(month.cumulative)}
                  r={3.5}
                  fill={month.forecast ? colors.surface : colors.money}
                  stroke={month.forecast ? colors.money : undefined}
                  strokeWidth={month.forecast ? 1.5 : undefined}
                />
              ) : null,
            )}
            {months.map((month, index) => (
              <SvgText
                key={`month-${month.monthKey}`}
                x={geometry.x(index)}
                y={HEIGHT - 9}
                fontSize={11}
                fontWeight="600"
                fill={month.recorded ? colors.text : colors.textFaint}
                textAnchor="middle"
              >
                {Number(month.monthKey.slice(5, 7))}月
              </SvgText>
            ))}
          </Svg>
        )}
        {/* 月の縦の帯を押すと、その月の実績へ。 */}
        {geometry && (
          <View style={[styles.hits, { left: PAD.left, right: PAD.right }]}>
            {months.map((month) => (
              <Pressable
                key={`hit-${month.monthKey}`}
                accessibilityRole="button"
                accessibilityLabel={`${Number(month.monthKey.slice(5, 7))}月の実績を見る`}
                disabled={!month.recorded}
                onPress={() => onSelectMonth(month.monthKey)}
                style={styles.hit}
              />
            ))}
          </View>
        )}
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: colors.moneyIncome }]} />
          <Text style={styles.legendText}>月の収支（棒）</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.swatchLine, { backgroundColor: colors.money }]} />
          <Text style={styles.legendText}>年初からの累計（線）</Text>
        </View>
        {months.some((month) => month.recorded && month.forecast) && (
          <View style={styles.legendItem}>
            <View style={styles.swatchDash}>
              <View style={[styles.dash, { backgroundColor: colors.money }]} />
              <View style={[styles.dash, { backgroundColor: colors.money }]} />
            </View>
            <Text style={styles.legendText}>見込み（点線）</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chart: { height: HEIGHT },
  hits: { position: 'absolute', top: 0, bottom: 0, flexDirection: 'row' },
  hit: { flex: 1 },
  legend: { flexDirection: 'row', gap: 16, justifyContent: 'center', paddingBottom: 8 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 12, fontWeight: '600', color: colors.textSubtle },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  swatchLine: { width: 14, height: 3, borderRadius: 2 },
  swatchDash: { width: 14, flexDirection: 'row', justifyContent: 'space-between' },
  dash: { width: 5, height: 3, borderRadius: 1 },
});
