import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '@/lib/theme';

// 表示の切り替え（月/週/日/リストなど）に使う切り替えボタン。
// Web版の `src/components/sukusuku/ui/SegmentedTabs.tsx` を置き換えたもの。
//
// 押し間違えないよう、どのタブでも高さ44px・太字で揃える。
// fill=false にすると各ボタンをラベルの幅に合わせるため、絞り込みなど他の操作と
// 同じ段に並べても、長いラベルだけが省略されることがない。

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  fill = true,
  style,
}: {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (id: T) => void;
  accessibilityLabel?: string;
  fill?: boolean;
  style?: object;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[styles.bar, style]}>
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.id)}
            style={[styles.tab, fill ? styles.tabFill : styles.tabHug, selected && styles.tabSelected]}
          >
            {option.icon}
            <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.borderStrongSoft, padding: 4, borderRadius: 12 },
  tab: {
    minHeight: 36,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabFill: { flex: 1, paddingHorizontal: 8 },
  tabHug: { paddingHorizontal: 12 },
  tabSelected: { backgroundColor: colors.surface },
  label: { fontSize: 14, fontWeight: '700', color: colors.textSubtle, flexShrink: 1 },
  labelSelected: { color: colors.navActiveText },
});
