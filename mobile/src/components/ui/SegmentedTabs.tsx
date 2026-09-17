import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';

// 表示の切り替え（月/週/日/リスト など）に使う共通の切り替えボタン。
// Web版の `src/components/sukusuku/ui/SegmentedTabs.tsx` にあたる。
//
// 押し間違えないよう高さを揃え、選択中だけ白地＋青文字にするのもWeb版と同じ。

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: string;
}

export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  /** false にすると各ボタンをラベルの幅に合わせる（絞り込みと同じ段に並べるとき）。 */
  fill = true,
}: {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (id: T) => void;
  accessibilityLabel?: string;
  fill?: boolean;
}) {
  return (
    <View accessibilityLabel={accessibilityLabel} style={styles.bar}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={[
              styles.tab,
              fill ? styles.tabFill : styles.tabAuto,
              selected && styles.tabSelected,
            ]}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.border, borderRadius: 12, padding: 4 },
  tab: { minHeight: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tabFill: { flex: 1, paddingHorizontal: 8 },
  tabAuto: { paddingHorizontal: 12 },
  tabSelected: { backgroundColor: colors.surface },
  label: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  labelSelected: { color: colors.accentBlueStrong },
});
