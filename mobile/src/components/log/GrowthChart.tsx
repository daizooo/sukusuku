import { useState } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { colors } from '@/lib/theme';

// 成長曲線の折れ線。Web版は recharts の LineChart を使っているが、
// React Nativeには無いので react-native-svg で同じ形に描く。
//
// 出すものはWeb版と同じ。横に薄い目盛り線、下に横軸のラベル、左に縦軸の目盛り、
// 点を打った太めの折れ線。値の無い記録は飛ばして線をつなぐ（recharts の connectNulls）。

export interface GrowthChartPoint {
  /** 横軸のラベル。生後ヶ月、未入力なら記録日。 */
  axisLabel: string;
  value: number | null;
}

interface GrowthChartProps {
  title: string;
  points: GrowthChartPoint[];
  /** 線の色。身長は青、体重は薔薇（Web版と同じ）。 */
  color: string;
  /** 縦軸の余white。Web版の domain=['dataMin - n', 'dataMax + n'] と同じ。 */
  padding: number;
}

const HEIGHT = 192;
const AXIS_LEFT = 34;
const AXIS_BOTTOM = 18;
const TOP = 8;
const RIGHT = 10;
/** 縦軸の目盛りの本数（上下の端を含む）。 */
const TICKS = 4;

export default function GrowthChart({ title, points, color, padding }: GrowthChartProps) {
  // 幅は親に合わせる。測れるまでは描かない。
  const [width, setWidth] = useState(0);
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  const values = points.map((point) => point.value).filter((v): v is number => v !== null);
  const min = values.length > 0 ? Math.min(...values) - padding : 0;
  const max = values.length > 0 ? Math.max(...values) + padding : 1;
  const span = max - min || 1;

  const plotWidth = Math.max(width - AXIS_LEFT - RIGHT, 1);
  const plotHeight = HEIGHT - TOP - AXIS_BOTTOM;

  const xAt = (index: number) =>
    AXIS_LEFT + (points.length <= 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);
  const yAt = (value: number) => TOP + (1 - (value - min) / span) * plotHeight;

  // 値の無い記録は飛ばしてつなぐ。
  const drawn = points
    .map((point, index) => ({ point, index }))
    .filter((entry): entry is { point: GrowthChartPoint & { value: number }; index: number } =>
      entry.point.value !== null,
    );
  const path = drawn
    .map((entry, i) => `${i === 0 ? 'M' : 'L'}${xAt(entry.index)},${yAt(entry.point.value)}`)
    .join(' ');

  // 横軸のラベルは詰まると読めないので、幅に入るぶんだけ間引く。
  const labelStep = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 44))));

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.plot} onLayout={onLayout}>
        {width > 0 && (
          <Svg width={width} height={HEIGHT}>
            {/* 目盛りと、その値 */}
            {Array.from({ length: TICKS }, (_, i) => {
              const value = min + (span * i) / (TICKS - 1);
              const y = yAt(value);
              return (
                <Line
                  key={`grid-${i}`}
                  x1={AXIS_LEFT}
                  x2={width - RIGHT}
                  y1={y}
                  y2={y}
                  stroke={colors.border}
                  strokeDasharray="3 3"
                />
              );
            })}
            {Array.from({ length: TICKS }, (_, i) => {
              const value = min + (span * i) / (TICKS - 1);
              return (
                <SvgText
                  key={`tick-${i}`}
                  x={AXIS_LEFT - 4}
                  y={yAt(value) + 3}
                  fontSize={10}
                  fill={colors.textMuted}
                  textAnchor="end"
                >
                  {Math.round(value * 10) / 10}
                </SvgText>
              );
            })}

            {/* 横軸のラベル */}
            {points.map((point, index) =>
              index % labelStep === 0 ? (
                <SvgText
                  key={`label-${index}`}
                  x={xAt(index)}
                  y={HEIGHT - 4}
                  fontSize={10}
                  fill={colors.textMuted}
                  textAnchor="middle"
                >
                  {point.axisLabel}
                </SvgText>
              ) : null,
            )}

            {/* 折れ線と点 */}
            {path !== '' && (
              <Path d={path} stroke={color} strokeWidth={3} fill="none" strokeLinejoin="round" />
            )}
            {drawn.map((entry) => (
              <Circle
                key={`dot-${entry.index}`}
                cx={xAt(entry.index)}
                cy={yAt(entry.point.value)}
                r={4}
                fill={color}
              />
            ))}
          </Svg>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
  },
  title: { fontSize: 14, fontWeight: '700', color: colors.textSubtle, marginBottom: 16 },
  plot: { height: HEIGHT, width: '100%' },
});
