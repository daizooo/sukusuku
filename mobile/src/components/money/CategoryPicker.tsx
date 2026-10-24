import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Settings2, X } from 'lucide-react-native';
import type { MoneyCategory } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  childCategories,
  iconKeyOf,
  topCategories,
} from '@/lib/moneyUtils';
import { CategoryIcon, ScreenHeader } from '@/components/money/moneyVisual';
import SheetModal from '@/components/ui/SheetModal';

// カテゴリの選択（docs/kakei.md §3.1・§3.2）。PWA版の `src/components/sukusuku/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 大分類を1行ずつ並べ、押すと下からシート（ボトムシート）が出て、その大分類の小分類を2列の大きなボタンで見せる（2026-10-24）。
// 以前は大分類の右に小分類を全部並べていた（のち、行の下に開くアコーディオンにした）が、固定費（確定）23件・予備費14件のように
// 件数が多いと、ボタンの大きさや並びがそろわず、押せる場所がひと目で分からなかった。
// 小分類を持たない大分類は、シートを出さずにそのまま選ぶ。件数は出さない。

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
  /** 出す大分類を絞る（年間予算で、予算の分け方の合う大分類だけを選ばせる）。無ければすべて。 */
  onlyTops?: (top: MoneyCategory) => boolean;
}

export default function CategoryPicker({
  kind,
  categories,
  onPick,
  onClose,
  onEditCategories,
  onlyTops,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const tops = useMemo(
    () => topCategories(categories, categoryKind).filter((top) => !onlyTops || onlyTops(top)),
    [categories, categoryKind, onlyTops],
  );
  const pickCategory = (categoryId: string) => onPick({ categoryId });
  // シートを出している大分類（1つだけ）。大分類が1つしか出ないときは最初から出しておく。
  const [openId, setOpenId] = useState<string | null>(() => (tops.length === 1 ? tops[0].id : null));
  const openTop = tops.find((top) => top.id === openId) ?? null;

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
          const hasChildren = childCategories(categories, top.id).length > 0;
          return (
            <Pressable
              key={top.id}
              accessibilityRole="button"
              accessibilityLabel={top.name}
              onPress={() => (hasChildren ? setOpenId(top.id) : pickCategory(top.id))}
              style={({ pressed }) => [styles.head, pressed && styles.pressed]}
            >
              <CategoryIcon iconKey={iconKeyOf(top)} size={32} />
              <Text style={[styles.topName, styles.flex]} numberOfLines={1}>
                {top.name}
              </Text>
              {hasChildren && <ChevronRight size={18} color={colors.textMuted} />}
            </Pressable>
          );
        })}
      </ScrollView>

      <SheetModal visible={openTop !== null} onClose={() => setOpenId(null)}>
        {openTop && (
          <View style={styles.sheet}>
            <View style={styles.sheetHead}>
              <CategoryIcon iconKey={iconKeyOf(openTop)} size={36} />
              <Text style={[styles.sheetTitle, styles.flex]} numberOfLines={1}>
                {openTop.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="閉じる"
                onPress={() => setOpenId(null)}
                style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
              >
                <X size={20} color={colors.textSubtle} />
              </Pressable>
            </View>
            <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.grid}>
              {childCategories(categories, openTop.id).map((category) => (
                <View key={category.id} style={styles.cell}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${openTop.name} ${category.name}`}
                    onPress={() => pickCategory(category.id)}
                    style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.buttonText}>{category.name}</Text>
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        )}
      </SheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { paddingBottom: 8 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  // 大分類の行（アイコン・名前・矢印）。
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 60,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.listSurface,
  },
  pressed: { backgroundColor: colors.listSurface },
  topName: { fontSize: 16, fontWeight: '700', color: colors.text },
  // ボトムシート（小分類）。
  sheet: { flexShrink: 1, paddingHorizontal: 16, paddingBottom: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 64 },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  closePressed: { backgroundColor: colors.border },
  sheetScroll: { flexGrow: 0 },
  // 2列。セルの外側の余白（4）を引いて、左右の端をシートの余白にそろえる。
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, paddingBottom: 4 },
  cell: { width: '50%', padding: 4 },
  button: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  buttonPressed: { backgroundColor: colors.moneySurface, borderColor: colors.moneyRing },
  buttonText: { fontSize: 15, fontWeight: '600', color: colors.text },
});
