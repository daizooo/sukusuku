import { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronDown, ChevronUp, Settings2 } from 'lucide-react-native';
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
// 大分類を1行ずつ並べ、押した1つだけ開いて小分類のボタンを出す（アコーディオン。2026-10-24）。
// 以前は大分類の右に小分類を全部並べていて、固定費（確定）23件・予備費14件のように件数が多いと見にくかった。
// 別の大分類を押すと、開いていたものは閉じる。開いた行は画面の上に寄せる（下の方の大分類でも小分類が見える）。
// 小分類を持たない大分類は、開かずにそのまま選ぶ。

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
  // 開いている大分類（1つだけ）。大分類が1つしか出ないときは最初から開いておく。
  const [openId, setOpenId] = useState<string | null>(() => (tops.length === 1 ? tops[0].id : null));
  const scrollRef = useRef<ScrollView>(null);
  // 各大分類の行の位置（上端）と、開いている小分類の面の高さ。開いた行を上に寄せるために測る。
  const rowY = useRef<Record<string, number>>({});
  const panelHeight = useRef(0);

  const toggle = (top: MoneyCategory) => {
    if (openId === top.id) {
      setOpenId(null);
      return;
    }
    // 開いていた行が上にあれば、閉じたぶん（面の高さ）だけ新しい行の位置は上がる。
    const openIndex = tops.findIndex((entry) => entry.id === openId);
    const index = tops.findIndex((entry) => entry.id === top.id);
    const closing = openIndex >= 0 && openIndex < index ? panelHeight.current : 0;
    setOpenId(top.id);
    scrollRef.current?.scrollTo({ y: Math.max(0, (rowY.current[top.id] ?? 0) - closing), animated: true });
  };

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
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content}>
        {tops.length === 0 && (
          <Text style={styles.empty}>カテゴリがまだありません。右上の歯車からカテゴリを作れます</Text>
        )}
        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          const open = openId === top.id;
          const hasChildren = children.length > 0;
          return (
            <View key={top.id} onLayout={(e) => { rowY.current[top.id] = e.nativeEvent.layout.y; }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={top.name}
                accessibilityState={{ expanded: hasChildren ? open : undefined }}
                onPress={() => (hasChildren ? toggle(top) : pickCategory(top.id))}
                style={({ pressed }) => [styles.head, open && styles.headOpen, pressed && styles.pressed]}
              >
                <CategoryIcon iconKey={iconKeyOf(top)} size={30} />
                <Text style={[styles.topName, styles.flex]} numberOfLines={1}>
                  {top.name}
                </Text>
                {hasChildren && (
                  <>
                    <Text style={styles.count}>{children.length}件</Text>
                    {open ? <ChevronUp size={18} color={colors.textFaint} /> : <ChevronDown size={18} color={colors.textFaint} />}
                  </>
                )}
              </Pressable>
              {open && hasChildren && (
                <View style={styles.panel} onLayout={(e) => { panelHeight.current = e.nativeEvent.layout.height; }}>
                  {children.map((category) => (
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
              )}
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
  content: { paddingBottom: 8 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  // 大分類の行（アイコン・名前・件数・矢印）。
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.listSurface,
  },
  headOpen: { backgroundColor: colors.neutralSurface },
  pressed: { backgroundColor: colors.listSurface },
  topName: { fontSize: 15, fontWeight: '700', color: colors.text },
  count: { fontSize: 12, fontWeight: '500', color: colors.textFaint },
  // 開いた大分類の小分類（折り返して並べる）。
  panel: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    backgroundColor: colors.neutralSurface,
    borderBottomWidth: 1,
    borderBottomColor: colors.listSurface,
  },
  chip: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 8, backgroundColor: colors.surface },
  chipPressed: { backgroundColor: colors.moneySurface },
  chipText: { fontSize: 15, fontWeight: '600', color: colors.text },
});
