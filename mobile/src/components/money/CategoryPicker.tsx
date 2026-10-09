import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Settings2 } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, SpecialActual, SpecialItem, SpecialKind } from '@/types/app';
import { colors } from '@/lib/theme';
import {
  budgetFor,
  childCategories,
  yearOfMonth,
  formatYen,
  frequentCategoryIds,
  iconKeyOf,
  livingSpendByTop,
  topCategories,
} from '@/lib/moneyUtils';
import { appliesInYear, buildYearRows, formatYear } from '@/lib/specialUtils';
import { CategoryIcon, ScreenHeader } from '@/components/money/moneyVisual';

// 種類の選択（docs/kakei.md §3.1・§3.2）。PWA版の `src/components/sukusuku/money/CategoryPicker.tsx` と同じ並び・文言。
//
// 上によく使う小分類。その下に大分類ごとの枠（見出しに今月の残り、中に小分類のチップ）。押すと大分類も決まる。
// 大分類ごとに枠で囲み、見出しに色を付けて、どこからどこまでが同じ大分類かを分かるようにする。
// 支出なら最後に特別費: その年の予定（まだ済でないものを上に。選ぶと予算の額が入る）と、予定外の項目。
// 収入なら収入の種類と、特別収入。

export interface CategoryChoice {
  categoryId: string | null;
  specialItemId: string | null;
  specialPlanId: string | null;
  /** 特別費の予定を選んだときの予算の額。 */
  amount: number | null;
}

interface CategoryPickerProps {
  kind: SpecialKind;
  /** 記録の日付の月（今月の残り・特別費の年に使う）。 */
  monthKey: string;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  records: MoneyRecord[];
  specialItems: SpecialItem[];
  specialActuals: SpecialActual[];
  onPick: (choice: CategoryChoice) => void;
  onClose: () => void;
  /** カテゴリと予算の編集へ。無ければ歯車を出さない（家計の設定の中から開いたとき）。 */
  onEditCategories?: () => void;
}

export default function CategoryPicker({
  kind,
  monthKey,
  categories,
  budgets,
  records,
  specialItems,
  specialActuals,
  onPick,
  onClose,
  onEditCategories,
}: CategoryPickerProps) {
  const categoryKind = kind === 'income' ? 'income' : 'living';
  const year = yearOfMonth(monthKey);
  const tops = useMemo(() => topCategories(categories, categoryKind), [categories, categoryKind]);
  const frequent = useMemo(
    () => frequentCategoryIds(records, categories, categoryKind),
    [records, categories, categoryKind],
  );
  const spend = useMemo(() => livingSpendByTop(records, categories, monthKey), [records, categories, monthKey]);
  // 特別費の予定（まだ済でないものを上に）と、その年に出る項目。
  const specialRows = useMemo(() => {
    const rows = buildYearRows(specialItems, specialActuals, year, kind).filter((row) => row.planId !== null);
    return [...rows.filter((row) => row.actual === null), ...rows.filter((row) => row.actual !== null)];
  }, [specialItems, specialActuals, year, kind]);
  const unplannedItems = useMemo(
    () => specialItems.filter((item) => item.kind === kind && appliesInYear(item, year)),
    [specialItems, kind, year],
  );

  const pickCategory = (categoryId: string) =>
    onPick({ categoryId, specialItemId: null, specialPlanId: null, amount: null });
  const nameOf = (id: string) => categories.find((category) => category.id === id)?.name ?? '';

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="種類を選ぶ"
        icon="back"
        onClose={onClose}
        right={
          onEditCategories && (
            <Pressable accessibilityRole="button" accessibilityLabel="カテゴリと予算を編集" onPress={onEditCategories} hitSlop={8}>
              <Settings2 size={20} color={colors.textMuted} />
            </Pressable>
          )
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        {tops.length === 0 && (
          <Text style={styles.empty}>種類がまだありません。右上の歯車から種類を作れます</Text>
        )}
        {frequent.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>よく使う</Text>
            <View style={styles.chips}>
              {frequent.map((id) => (
                <Pressable key={id} accessibilityRole="button" onPress={() => pickCategory(id)} style={[styles.chip, styles.chipStrong]}>
                  <Text style={[styles.chipText, styles.chipTextStrong]}>{nameOf(id)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {tops.map((top) => {
          const children = childCategories(categories, top.id);
          const budget = categoryKind === 'living' ? budgetFor(budgets, top.id, monthKey) : null;
          const remaining = budget === null ? null : budget - (spend.get(top.id) ?? 0);
          return (
            <View key={top.id} style={styles.topCard}>
              <View style={styles.topRow}>
                <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
                <Text style={[styles.topName, styles.flex]}>{top.name}</Text>
                {remaining !== null && (
                  <Text style={[styles.remaining, remaining < 0 && styles.over]}>
                    今月 {remaining < 0 ? `${formatYen(remaining)} 超過` : `残り ${formatYen(remaining)}`}
                  </Text>
                )}
              </View>
              <View style={[styles.chips, styles.topChips]}>
                {(children.length > 0 ? children : [top]).map((category) => (
                  <Pressable
                    key={category.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${top.name} ${category.name}`}
                    onPress={() => pickCategory(category.id)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText}>{category.name}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}

        {(specialRows.length > 0 || unplannedItems.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.topName}>
              {kind === 'income' ? '特別収入' : '特別費'}（{formatYear(year)}の予定）
            </Text>
            {specialRows.map((row) => (
              <Pressable
                key={row.key}
                accessibilityRole="button"
                onPress={() =>
                  onPick({ categoryId: null, specialItemId: row.item.id, specialPlanId: row.planId, amount: row.budget })
                }
                style={styles.planRow}
              >
                <View style={styles.flex}>
                  <Text style={styles.planName}>{row.item.name}</Text>
                  <Text style={styles.planSub}>
                    {row.month === null ? '月未定' : `${row.month}月`}
                    {row.actual !== null ? '・済' : ''}
                  </Text>
                </View>
                <Text style={styles.planAmount}>予算 {formatYen(row.budget)}</Text>
              </Pressable>
            ))}
            {unplannedItems.length > 0 && (
              <>
                <Text style={styles.subTitle}>予定外として記録</Text>
                <View style={styles.chips}>
                  {unplannedItems.map((item) => (
                    <Pressable
                      key={item.id}
                      accessibilityRole="button"
                      onPress={() => onPick({ categoryId: null, specialItemId: item.id, specialPlanId: null, amount: null })}
                      style={styles.chip}
                    >
                      <Text style={styles.chipText}>{item.name}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
          </View>
        )}
        <Text style={styles.hint}>
          {kind === 'income' ? '特別収入' : '特別費'}の項目は「年」から足せます
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 24 },
  section: { gap: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  topCard: { borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: colors.neutralSurface,
  },
  topChips: { padding: 12 },
  topName: { fontSize: 15, fontWeight: '700', color: colors.text },
  remaining: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  over: { color: colors.moneyOver },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipStrong: { borderColor: colors.moneySoft, backgroundColor: colors.moneySoft },
  chipText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  chipTextStrong: { color: colors.moneyText },
  planRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  planName: { fontSize: 14, fontWeight: '700', color: colors.text },
  planSub: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  planAmount: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  subTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 4 },
  hint: { fontSize: 12, fontWeight: '500', color: colors.textFaint },
});
