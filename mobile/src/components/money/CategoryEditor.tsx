import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronLeft, ChevronRight, GripVertical, Plus } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyCategoryKind } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  budgetFor,
  CATEGORY_ICON_COLORS,
  childCategories,
  formatYen,
  guessIconKey,
  iconKeyOf,
  MONEY_ICONS,
  topCategories,
} from '@/lib/moneyUtils';
import { formatYear, parseAmountInput } from '@/lib/specialUtils';
import {
  insertDefaultMoneyCategories,
  insertMoneyCategory,
  saveMoneyBudget,
  updateMoneyCategory,
} from '@/lib/api/money';
import { useDragReorder } from '@/components/list/useDragReorder';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// カテゴリと予算（docs/kakei.md §3.1）。PWA版の `src/components/sukusuku/money/CategoryEditor.tsx` と同じ並び・文言。
//
// 大分類（予算を置く単位）と小分類の追加・名前の変更・並べ替え・使わなくする。並べ替えは一覧のまま指で動かす
// （大分類は左の持ち手をつかむ、小分類は長押し。リストと同じ操作。components/list/useDragReorder.ts）。
// 大分類のアイコンは絵と色を選ぶ（アイコンをタップすると色を選べる。出金元のアイコンの色と同じ候補）。予算は大分類ごと・年ごとの月額で、
// その年に入れていなければ前の年の額のまま（ここで直すと、その年の額になる）。
// 種類がまだ無い家族には「標準の種類で始める」（Zaim のカテゴリをもとにした並び）。

interface CategoryEditorProps {
  familyId: string;
  year: number;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  onClose: () => void;
}

type Editing =
  | { category: MoneyCategory }
  | { category: null; parentId: string | null }
  | null;

const KIND_OPTIONS: { id: MoneyCategoryKind; label: string }[] = [
  { id: 'living', label: '生活費' },
  { id: 'income', label: '収入' },
];

export default function CategoryEditor({
  familyId,
  year: initialYear,
  categories,
  budgets,
  onCategories,
  onBudgets,
  onClose,
}: CategoryEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [kind, setKind] = useState<MoneyCategoryKind>('living');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);

  const tops = useMemo(() => topCategories(categories, kind, true), [categories, kind]);
  const ordered = [...tops.filter((top) => !top.archived), ...tops.filter((top) => top.archived)];
  const totalBudget =
    kind === 'living'
      ? tops.filter((top) => !top.archived).reduce((sum, top) => sum + (budgetFor(budgets, top.id, year) ?? 0), 0)
      : 0;

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');
  const replace = (updated: MoneyCategory) =>
    onCategories((prev) => prev.map((category) => (category.id === updated.id ? updated : category)));

  const seed = async () => {
    setBusy(true);
    try {
      const created = await insertDefaultMoneyCategories(supabase, familyId);
      onCategories((prev) => [...prev, ...created]);
    } catch {
      failed('作成');
    } finally {
      setBusy(false);
    }
  };

  const siblingsOf = (category: { parentId: string | null; kind: MoneyCategoryKind }) =>
    category.parentId === null
      ? topCategories(categories, category.kind, true)
      : childCategories(categories, category.parentId, true);

  /** 指で動かしたあとの並び。きょうだいの並びを数え直し、変わったものだけ保存する。 */
  const reorder = (_sectionKey: string, orderedIds: string[]) => {
    const changed = orderedIds
      .map((id, position) => ({ entry: categories.find((category) => category.id === id), position }))
      .filter(
        (change): change is { entry: MoneyCategory; position: number } =>
          change.entry !== undefined && change.entry.position !== change.position,
      );
    if (changed.length === 0) return;
    onCategories((prev) =>
      prev.map((entry) => {
        const hit = changed.find((change) => change.entry.id === entry.id);
        return hit ? { ...entry, position: hit.position } : entry;
      }),
    );
    void Promise.all(changed.map(({ entry, position }) => updateMoneyCategory(supabase, entry.id, { position }))).catch(() =>
      failed('並べ替え'),
    );
  };
  const drag = useDragReorder(reorder);

  const save = async (result: SheetResult) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    try {
      let category: MoneyCategory;
      if (target.category === null) {
        const siblings = siblingsOf({ parentId: target.parentId, kind });
        category = await insertMoneyCategory(supabase, familyId, {
          kind,
          parentId: target.parentId,
          name: result.name,
          icon: result.icon,
          iconColor: result.iconColor,
          position: siblings.reduce((max, entry) => Math.max(max, entry.position + 1), 0),
        });
        onCategories((prev) => [...prev, category]);
      } else {
        category = target.category;
        if (
          result.name.trim() !== category.name ||
          result.icon !== category.icon ||
          result.iconColor !== category.iconColor
        ) {
          category = await updateMoneyCategory(supabase, category.id, {
            name: result.name,
            icon: result.icon,
            iconColor: result.iconColor,
          });
          replace(category);
        }
      }
      if (result.budget !== null && result.budget !== budgetFor(budgets, category.id, year)) {
        const saved = await saveMoneyBudget(supabase, familyId, category.id, year, result.budget);
        onBudgets((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);
      }
    } catch {
      failed('保存');
    }
  };

  const toggleArchive = async (category: MoneyCategory) => {
    setEditing(null);
    try {
      replace(await updateMoneyCategory(supabase, category.id, { archived: !category.archived }));
    } catch {
      failed('保存');
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title="カテゴリと予算" onClose={onClose} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前の年"
            onPress={() => setYear((current) => current - 1)}
            hitSlop={8}
            style={styles.yearButton}
          >
            <ChevronLeft size={18} color={colors.textSubtle} />
          </Pressable>
          <Text style={styles.year}>{formatYear(year)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="次の年"
            onPress={() => setYear((current) => current + 1)}
            hitSlop={8}
            style={styles.yearButton}
          >
            <ChevronRight size={18} color={colors.textSubtle} />
          </Pressable>
          <View style={styles.flex} />
          {KIND_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: kind === option.id }}
              onPress={() => setKind(option.id)}
              style={[styles.kind, kind === option.id && styles.kindSelected]}
            >
              <Text style={[styles.kindText, kind === option.id && styles.kindTextSelected]}>{option.label}</Text>
            </Pressable>
          ))}
        </View>
        {kind === 'living' && tops.length > 0 && (
          <Text style={styles.total}>月の予算の合計 {formatYen(totalBudget)}</Text>
        )}

        <ScrollView style={styles.flex} contentContainerStyle={styles.content} scrollEnabled={!drag.isActive}>
          {categories.length === 0 && (
            <View style={styles.seed}>
              <Text style={styles.seedText}>
                種類がまだありません。Zaim のカテゴリをもとにした標準の種類で始めて、名前や並びをあとで直せます。
              </Text>
              <PrimaryButton label="標準の種類で始める" onPress={() => void seed()} disabled={busy} />
            </View>
          )}
          <View {...drag.panHandlers} style={styles.list}>
          {ordered.map((top) => {
            const children = childCategories(categories, top.id, true);
            const budget = kind === 'living' ? budgetFor(budgets, top.id, year) : null;
            const topSection = `tops-${kind}`;
            return (
              <View
                key={top.id}
                {...drag.measureProps(top.id)}
                style={[styles.card, top.archived && styles.archived, drag.styleFor(top.id), drag.isDragging(top.id) && styles.lifted]}
              >
                <View style={styles.topLine}>
                  <View accessibilityLabel={`${top.name}を並べ替え`} {...drag.gripProps(topSection, ordered, top.id)} style={styles.grip}>
                    <GripVertical size={18} color={colors.borderStrong} />
                  </View>
                <Pressable accessibilityRole="button" onPress={() => setEditing({ category: top })} style={[styles.topRow, styles.flex]}>
                  <CategoryIcon iconKey={iconKeyOf(top)} />
                  <Text style={styles.topName}>{top.name}</Text>
                  {top.archived && <Text style={styles.archivedLabel}>使わない</Text>}
                  <View style={styles.flex} />
                  {kind === 'living' && (
                    <Text style={styles.budget}>{budget === null ? '予算なし' : `月 ${formatYen(budget)}`}</Text>
                  )}
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
                </View>
                <View style={styles.chips}>
                  {children.map((child) => (
                    <Pressable
                      key={child.id}
                      accessibilityRole="button"
                      onPress={() => setEditing({ category: child })}
                      {...drag.holdProps(`children-${top.id}`, children, child.id)}
                      {...drag.measureProps(child.id)}
                      style={[
                        styles.chip,
                        child.archived && styles.archived,
                        drag.styleFor(child.id),
                        drag.isDragging(child.id) && styles.lifted,
                      ]}
                    >
                      <Text style={styles.chipText}>{child.name}</Text>
                    </Pressable>
                  ))}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${top.name}に小分類を足す`}
                    onPress={() => setEditing({ category: null, parentId: top.id })}
                    style={[styles.chip, styles.addChip]}
                  >
                    <Plus size={14} color={colors.money} />
                    <Text style={styles.addChipText}>小分類</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
          </View>
          {categories.length > 0 && (
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing({ category: null, parentId: null })}
              style={styles.addTop}
            >
              <Plus size={18} color={colors.money} />
              <Text style={styles.addTopText}>大分類を足す</Text>
            </Pressable>
          )}
        </ScrollView>

        {editing !== null && (
          <CategorySheet
            key={editing.category?.id ?? `new-${editing.category === null ? editing.parentId : ''}`}
            category={editing.category}
            isTop={editing.category === null ? editing.parentId === null : editing.category.parentId === null}
            showBudget={kind === 'living'}
            year={year}
            budget={editing.category ? budgetFor(budgets, editing.category.id, year) : null}
            onClose={() => setEditing(null)}
            onSubmit={(result) => void save(result)}
            onToggleArchive={editing.category ? () => void toggleArchive(editing.category!) : undefined}
          />
        )}
      </View>
    </Modal>
  );
}

interface SheetResult {
  name: string;
  /** アイコン（大分類だけ。小分類は今のまま）。 */
  icon: string | null;
  /** アイコンの色（大分類だけ）。null は標準（アイコンごとの色）。 */
  iconColor: string | null;
  /** 大分類の月の予算。入れなかった・小分類は null。 */
  budget: number | null;
}

function CategorySheet({
  category,
  isTop,
  showBudget,
  year,
  budget,
  onClose,
  onSubmit,
  onToggleArchive,
}: {
  category: MoneyCategory | null;
  isTop: boolean;
  showBudget: boolean;
  year: number;
  budget: number | null;
  onClose: () => void;
  onSubmit: (result: SheetResult) => void;
  onToggleArchive?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [amount, setAmount] = useState(budget === null ? '' : String(budget));
  // 自動は無し。決めていない種類は、今の名前から近いものを選んだ状態で始める。
  const [icon, setIcon] = useState<string>(category ? (category.icon ?? guessIconKey(category.name)) : 'other');
  const [iconColor, setIconColor] = useState<string | null>(category?.iconColor ?? null);
  const [pickingColor, setPickingColor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const withBudget = isTop && showBudget;

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    const value = amount.trim() === '' ? null : parseAmountInput(amount);
    if (withBudget && amount.trim() !== '' && value === null) return setError('予算は0以上の整数（円）で入れてください');
    onSubmit({
      name,
      icon: isTop ? icon : (category?.icon ?? null),
      iconColor: isTop ? iconColor : (category?.iconColor ?? null),
      budget: withBudget ? value : null,
    });
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={category ? (isTop ? '大分類を編集' : '小分類を編集') : isTop ? '大分類を足す' : '小分類を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onToggleArchive && category && (
              <Pressable accessibilityRole="button" onPress={onToggleArchive} style={styles.secondary}>
                <Text style={category.archived ? styles.secondaryText : styles.deleteText}>
                  {category.archived ? 'また使う' : '使わなくする（記録には残ります）'}
                </Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <Text style={styles.label}>名前</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={isTop ? '例: 食費' : '例: 外食'}
            placeholderTextColor={colors.textFaint}
          />
        </View>
        {isTop && (
          <View style={styles.field}>
            <Text style={styles.label}>アイコン</Text>
            {/* アイコンをタップすると色を選べる（出金元のアイコンの色と同じ候補）。 */}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="アイコンの色を選ぶ"
              accessibilityState={{ expanded: pickingColor }}
              onPress={() => setPickingColor((open) => !open)}
              style={styles.preview}
            >
              <CategoryIcon iconKey={iconColor ? `${icon}|${iconColor}` : icon} size={48} />
              <Text style={styles.previewText}>タップして色を選ぶ</Text>
            </Pressable>
            {pickingColor && (
              <View style={styles.colors}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="標準の色"
                  accessibilityState={{ selected: iconColor === null }}
                  onPress={() => setIconColor(null)}
                  style={[styles.swatch, styles.swatchDefault, iconColor === null && styles.swatchSelected]}
                >
                  <CategoryIcon iconKey={icon} size={26} />
                </Pressable>
                {CATEGORY_ICON_COLORS.map((entry) => (
                  <Pressable
                    key={entry.color}
                    accessibilityRole="button"
                    accessibilityLabel={entry.label}
                    accessibilityState={{ selected: iconColor === entry.color }}
                    onPress={() => setIconColor(entry.color)}
                    style={[styles.swatch, { backgroundColor: entry.color }, iconColor === entry.color && styles.swatchSelected]}
                  >
                    {iconColor === entry.color && <Check size={18} color="#ffffff" />}
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.icons}>
              {MONEY_ICONS.map((entry) => (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityLabel={entry.label}
                  accessibilityState={{ selected: icon === entry.key }}
                  onPress={() => setIcon(entry.key)}
                  style={[styles.iconChoice, icon === entry.key && styles.iconChoiceSelected]}
                >
                  <CategoryIcon iconKey={iconColor ? `${entry.key}|${iconColor}` : entry.key} size={34} />
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {withBudget && (
          <View style={styles.field}>
            <Text style={styles.label}>{formatYear(year)}の月の予算（円）</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder="未設定"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.hint}>次の年も、直すまで同じ額を使います</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  yearButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  year: { fontSize: 16, fontWeight: '700', color: colors.text },
  kind: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.neutralSurface },
  kindSelected: { backgroundColor: colors.moneySoft },
  kindText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  kindTextSelected: { color: colors.moneyText, fontWeight: '700' },
  total: { fontSize: 12, fontWeight: '600', color: colors.textMuted, paddingHorizontal: 16, paddingBottom: 6 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  seed: { gap: 12, paddingVertical: 16 },
  seedText: { fontSize: 14, fontWeight: '500', color: colors.textMuted, lineHeight: 21 },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 12,
    gap: 10,
  },
  archived: { opacity: 0.5 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topName: { fontSize: 15, fontWeight: '700', color: colors.text },
  archivedLabel: { fontSize: 11, fontWeight: '600', color: colors.textFaint },
  budget: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.neutralSurface,
  },
  chipText: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  addChip: { backgroundColor: colors.moneySurface },
  addChipText: { fontSize: 13, fontWeight: '600', color: colors.money },
  addTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  addTopText: { fontSize: 15, fontWeight: '700', color: colors.money },
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
  },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  icons: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  iconChoice: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconChoiceSelected: { borderColor: colors.money },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  previewText: { fontSize: 13, fontWeight: '600', color: colors.money },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingVertical: 4 },
  swatch: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  swatchDefault: { backgroundColor: colors.neutralSurface },
  swatchSelected: { borderWidth: 3, borderColor: colors.text },
  list: { gap: 10 },
  topLine: { flexDirection: 'row', alignItems: 'center' },
  grip: { width: 28, alignSelf: 'stretch', marginLeft: -8, marginVertical: -4, alignItems: 'center', justifyContent: 'center' },
  lifted: { opacity: 0.9, elevation: 8 },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '700', color: colors.money },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
