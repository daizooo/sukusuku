import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Settings2 } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  budgetFor,
  childCategories,
  formatYen,
  frequentCategoryIds,
  iconKeyOf,
  livingSpendByTop,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader } from '@/components/money/moneyVisual';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。PWA版の `src/components/sukusuku/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 上によく使う小分類（1行。入りきらなければ横に送る）。その下に大分類を1行ずつ: 左に大分類（アイコン・名前・小さく今月の残り）、
// 右に小分類のボタン（入りきらなければ折り返す）。押すと大分類も決まる。
// スクロールしなくても1画面に収まるように詰める（2026-10-20。以前は大分類ごとの枠と見出しの帯で、縦に長かった）。小分類を主役に、大分類は小さく。

export interface CategoryChoice {
  categoryId: string;
}

interface CategoryPickerProps {
  kind: 'expense' | 'income';
  /** 記録の日付の月（今月の残りに使う）。 */
  monthKey: string;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
  /** カテゴリ・予算の編集へ。無ければ歯車を出さない（家計の設定の中から開いたとき）。 */
  onEditCategories?: () => void;
}

export default function CategoryPicker({
  kind,
  monthKey,
  categories,
  budgets,
  records,
  onPick,
  onClose,
  onEditCategories,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const tops = useMemo(() => topCategories(categories, categoryKind), [categories, categoryKind]);
  const frequent = useMemo(
    () => frequentCategoryIds(records, categories, categoryKind),
    [records, categories, categoryKind],
  );
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  const pickCategory = (categoryId: string) => onPick({ categoryId });
  const nameOf = (id: string) => categories.find((category) => category.id === id)?.name ?? '';

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="カテゴリを選ぶ"
        icon="back"
        onClose={onClose}
        right={
          onEditCategories && (
            <Pressable accessibilityRole="button" accessibilityLabel="カテゴリ・予算を編集" onPress={onEditCategories} hitSlop={8}>
              <Settings2 size={20} color={colors.textMuted} />
            </Pressable>
          )
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        {tops.length === 0 && (
          <Text style={styles.empty}>カテゴリがまだありません。右上の歯車からカテゴリを作れます</Text>
        )}
        {frequent.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.frequent} contentContainerStyle={styles.frequentRow}>
            <Text style={styles.sectionTitle}>よく使う</Text>
            {frequent.map((id) => (
              <Pressable key={id} accessibilityRole="button" onPress={() => pickCategory(id)} style={styles.frequentChip}>
                <Text style={styles.frequentText}>{nameOf(id)}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          const budget = categoryKind === 'living' ? budgetFor(budgets, top.id, monthKey) : null;
          const remaining = budget === null ? null : budget - (spend.get(top.id) ?? 0);
          return (
            <View key={top.id} style={styles.topRow}>
              <View style={styles.top}>
                <CategoryIcon iconKey={iconKeyOf(top)} size={20} />
                <View style={styles.flex}>
                  <Text style={styles.topName} numberOfLines={1}>
                    {top.name}
                  </Text>
                  {remaining !== null && (
                    <Text style={[styles.remaining, remaining < 0 && styles.over]} numberOfLines={1}>
                      {remaining < 0 ? `${formatYen(remaining)} 超過` : `残り ${formatYen(remaining)}`}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.chips}>
                {(children.length > 0 ? children : [top]).map((category) => (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${top.name} ${category.name}`}
                    onPress={() => pickCategory(category.id)}
                    style={({ pressed }) => [styles.chip, pressed && styles.chipPressed]}
                  >
                    <Text style={styles.chipText}>{category.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { paddingBottom: 24 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  // よく使う（1行）。
  frequent: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  frequentRow: { alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: colors.textMuted, marginRight: 2 },
  frequentChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.moneySoft },
  frequentText: { fontSize: 13, fontWeight: '600', color: colors.moneyText },
  // 大分類を1行ずつ（左に大分類、右に小分類）。
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
    borderBottomColor: colors.listSurface,
  },
  top: { width: 92, flexDirection: 'row', alignItems: 'center', gap: 5 },
  topName: { fontSize: 11.5, fontWeight: '700', color: colors.textSubtle },
  remaining: { fontSize: 9, fontWeight: '500', color: colors.textFaint },
  over: { color: colors.moneyOver },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  chip: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: colors.neutralSurface },
  chipPressed: { backgroundColor: colors.moneySurface },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.text },
});
