import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Settings2 } from 'lucide-react-native';
import type { MoneyCategory } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  childCategories,
  iconKeyOf,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader } from '@/components/money/moneyVisual';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。PWA版の `src/components/sukusuku/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 大分類を1行ずつ: 左に大分類（アイコン・名前。予算の残りは出さない）、
// 右に小分類のボタン（入りきらなければ折り返す）。押すと大分類も決まる。
// スクロールしなくても1画面に収まるように詰める（2026-10-20。以前は大分類ごとの枠と見出しの帯で、縦に長かった）。小分類を主役に、大分類は小さく。
// 大分類の行は与えられた高さいっぱいに縦に伸ばす（下に余白を残さない）。入りきらないときだけスクロールする。

export interface CategoryChoice {
  categoryId: string;
}

interface CategoryPickerProps {
  kind: 'expense' | 'income';
  categories: MoneyCategory[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
  /** カテゴリ・予算の編集へ。無ければ歯車を出さない（家計の設定の中から開いたとき）。 */
  onEditCategories?: () => void;
}

export default function CategoryPicker({
  kind,
  categories,
  onPick,
  onClose,
  onEditCategories,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const tops = useMemo(() => topCategories(categories, categoryKind), [categories, categoryKind]);
  const pickCategory = (categoryId: string) => onPick({ categoryId });

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
        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          return (
            <View key={top.id} style={styles.topRow}>
              <View style={styles.top}>
                <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
                <Text style={[styles.topName, styles.flex]} numberOfLines={1}>
                  {top.name}
                </Text>
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
  content: { flexGrow: 1, paddingBottom: 8 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  // 大分類を1行ずつ（左に大分類、右に小分類）。
  // flexGrow で高さいっぱいに均等に伸ばす（flexBasis は中身の高さのまま。小さい画面では縮まずスクロールになる）。
  topRow: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.listSurface,
  },
  top: { width: 104, flexDirection: 'row', alignItems: 'center', gap: 6 },
  topName: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  chip: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, backgroundColor: colors.neutralSurface },
  chipPressed: { backgroundColor: colors.moneySurface },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
});
