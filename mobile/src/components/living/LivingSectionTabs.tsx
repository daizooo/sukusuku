import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ShieldCheck, ShoppingBasket, type LucideIcon } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 暮らしタブの区分の切り替え（docs/home.md §2）。防災備蓄・日用品（・のちに特別費）は
// 持つデータも見方も別物なので、面の切り替え（期限順/必要数）とは別の段にし、
// 区分ごとの色とアイコンで見分けられるようにする。Web版の
// `src/components/sukusuku/living/LivingSectionTabs.tsx` と同じ項目・並び・文言。

export type LivingSection = 'stock' | 'products';

export const LIVING_SECTIONS: {
  id: LivingSection;
  label: string;
  /** 見出し行に出す、その区分で何をするかの一言。 */
  hint: string;
  color: string;
  Icon: LucideIcon;
}[] = [
  {
    id: 'stock',
    label: '防災備蓄',
    hint: '期限切れと不足に気づく',
    color: colors.livingStock,
    Icon: ShieldCheck,
  },
  {
    id: 'products',
    label: '日用品',
    hint: 'よく買うものを買い出しリストへ',
    color: colors.livingProducts,
    Icon: ShoppingBasket,
  },
];

export default function LivingSectionTabs({
  value,
  onChange,
}: {
  value: LivingSection;
  onChange: (id: LivingSection) => void;
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel="暮らしの区分" style={styles.bar}>
      {LIVING_SECTIONS.map(({ id, label, color, Icon }) => {
        const selected = id === value;
        return (
          <Pressable
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(id)}
            style={[styles.tab, selected ? { backgroundColor: color, borderColor: color } : styles.tabIdle]}
          >
            <Icon size={18} color={selected ? colors.primaryText : color} />
            <Text numberOfLines={1} style={[styles.label, { color: selected ? colors.primaryText : colors.textSubtle }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  tabIdle: { backgroundColor: colors.surface, borderColor: colors.border },
  label: { fontSize: 15, fontWeight: '700' },
});
