import { StyleSheet, View } from 'react-native';
import type { SubsidyPrizeId } from '@/types/app';

// 補助くじの玉（docs/home.md §9）。PWA版の `src/components/sukusuku/living/LotteryBall.tsx` と同じ色。
// 白玉は地の色に溶けないよう、縁を付ける。

export const PRIZE_COLOR: Record<SubsidyPrizeId, { fill: string; edge: string; text: string }> = {
  white: { fill: '#f9fafb', edge: '#d1d5db', text: '#6b7280' },
  blue: { fill: '#3b82f6', edge: '#2563eb', text: '#1d4ed8' },
  red: { fill: '#ef4444', edge: '#dc2626', text: '#b91c1c' },
  gold: { fill: '#fbbf24', edge: '#d97706', text: '#b45309' },
};

/** 玉。prize が無いときは中身の見えない灰色（まだ出ていない玉）。 */
export default function LotteryBall({ prize, size }: { prize: SubsidyPrizeId | null; size: number }) {
  const tone = prize ? PRIZE_COLOR[prize] : { fill: '#e5e7eb', edge: '#9ca3af' };
  return (
    <View
      style={[
        styles.ball,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tone.fill,
          borderColor: tone.edge,
          borderWidth: Math.max(2, size / 16),
        },
      ]}
    >
      {/* つや。 */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.14,
          left: size * 0.2,
          width: size * 0.26,
          height: size * 0.16,
          borderRadius: size * 0.1,
          backgroundColor: 'rgba(255, 255, 255, 0.55)',
          transform: [{ rotate: '-30deg' }],
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  ball: { alignItems: 'center', justifyContent: 'center' },
});
