import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { formatMonthKey, shiftMonth } from '@/lib/moneyUtils';

// 家計タブで共通に使う小さな部品（月の送り・使った割合の輪・種類の頭文字・全画面の見出し）。
// PWA版の `src/components/sukusuku/money/moneyVisual.tsx` と同じ見た目。

/** 月の送り（‹ 2026年9月 ›）。 */
export function MonthBar({
  monthKey,
  onChange,
  right,
}: {
  monthKey: string;
  onChange: (monthKey: string) => void;
  right?: ReactNode;
}) {
  return (
    <View style={styles.monthBar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="前の月"
        onPress={() => onChange(shiftMonth(monthKey, -1))}
        hitSlop={8}
        style={styles.monthButton}
      >
        <ChevronLeft size={18} color={colors.textSubtle} />
      </Pressable>
      <Text style={styles.monthLabel}>{formatMonthKey(monthKey)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="次の月"
        onPress={() => onChange(shiftMonth(monthKey, 1))}
        hitSlop={8}
        style={styles.monthButton}
      >
        <ChevronRight size={18} color={colors.textSubtle} />
      </Pressable>
      <View style={styles.flex} />
      {right}
    </View>
  );
}

/** 使った割合の輪。100%を超えたら淡い赤で一周。 */
export function UsageRing({ percent, size = 52 }: { percent: number | null; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const over = percent !== null && percent > 100;
  const filled = percent === null ? 0 : Math.min(percent, 100) / 100;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.neutralSurface} strokeWidth={stroke} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={over ? colors.moneyOverRing : colors.moneyRing}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      <Text style={[styles.ringText, over && styles.over]}>{percent === null ? '−' : `${percent}%`}</Text>
    </View>
  );
}

/** 種類の頭文字の丸（「食」）。 */
export function CategoryBadge({ label, size = 32 }: { label: string; size?: number }) {
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={styles.badgeText}>{label.slice(0, 1) || '・'}</Text>
    </View>
  );
}

/** 全画面の入力の見出し。close は × 、back は ← 。 */
export function ScreenHeader({
  title,
  onClose,
  icon = 'close',
  right,
}: {
  title: string;
  onClose: () => void;
  icon?: 'close' | 'back';
  right?: ReactNode;
}) {
  const Icon = icon === 'back' ? ArrowLeft : X;
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={icon === 'back' ? '戻る' : '閉じる'}
        onPress={onClose}
        hitSlop={10}
      >
        <Icon size={22} color={colors.textSubtle} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={styles.flex} />
      {right}
    </View>
  );
}

/** 下に固定の大きなボタン（淡い青）。 */
export function PrimaryButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.primary, disabled && styles.primaryDisabled]}
    >
      <Text style={styles.primaryText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  monthBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  monthButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  monthLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  ringText: { fontSize: 11, fontWeight: '700', color: colors.money },
  over: { color: colors.moneyOver },
  badge: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.moneySurface },
  badgeText: { fontSize: 13, fontWeight: '700', color: colors.money },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  primary: { borderRadius: 14, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.moneySoft },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { fontSize: 15, fontWeight: '700', color: colors.moneyText },
});
