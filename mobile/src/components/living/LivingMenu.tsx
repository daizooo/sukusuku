import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ShieldCheck, ShoppingBasket, Ticket, type LucideIcon } from 'lucide-react-native';
import { colors } from '@/lib/theme';

// 暮らしタブのメニュー（docs/home.md §2）。防災備蓄・日用品・補助くじ（・のちに特別費）は
// 持つデータも見方も別物で、頻繁に開くタブでもないため、切り替えではなく
// アイコンを並べたメニューにして、押すとその画面へ入る。Web版の
// `src/components/sukusuku/living/LivingMenu.tsx` と同じ項目・並び・文言。

export type LivingSection = 'stock' | 'products' | 'lottery';

export const LIVING_SECTIONS: {
  id: LivingSection;
  label: string;
  /** メニューのカードに出す、その画面で何をするかの一言。 */
  hint: string;
  color: string;
  surface: string;
  Icon: LucideIcon;
}[] = [
  {
    id: 'stock',
    label: '防災備蓄',
    hint: '期限切れと不足に気づく',
    color: colors.livingStock,
    surface: colors.livingStockSurface,
    Icon: ShieldCheck,
  },
  {
    id: 'products',
    label: '日用品',
    hint: 'よく買うものを買い出しリストへ',
    color: colors.livingProducts,
    surface: colors.livingProductsSurface,
    Icon: ShoppingBasket,
  },
  {
    id: 'lottery',
    label: '福引チャンス',
    hint: '家族のお金で買ってもらえるかも・・・',
    color: colors.livingLottery,
    surface: colors.livingLotterySurface,
    Icon: Ticket,
  },
];

export default function LivingMenu({
  onOpen,
  attention,
}: {
  onOpen: (id: LivingSection) => void;
  /** 区分ごとの「要確認」の件数。0・無いときは出さない。 */
  attention: Partial<Record<LivingSection, number>>;
}) {
  return (
    <View style={styles.grid}>
      {LIVING_SECTIONS.map(({ id, label, hint, color, surface, Icon }) => {
        const count = attention[id] ?? 0;
        return (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityLabel={count > 0 ? `${label}（要確認 ${count}件）` : label}
            onPress={() => onOpen(id)}
            style={({ pressed }) => [styles.card, pressed && { backgroundColor: surface }]}
          >
            <View style={[styles.icon, { backgroundColor: surface }]}>
              <Icon size={30} color={color} />
            </View>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.hint}>{hint}</Text>
            {count > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>要確認 {count}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 16, paddingTop: 4 },
  card: {
    // 2列。gap の分を引いた半分の幅。
    width: '47.5%',
    flexGrow: 1,
    minHeight: 148,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  icon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  label: { fontSize: 16, fontWeight: '700', color: colors.text },
  hint: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 4 },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: colors.alertSurface,
  },
  badgeText: { fontSize: 11, fontWeight: '700', color: colors.alertText },
});
