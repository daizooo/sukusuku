import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyCategoryKind } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { budgetFor, childCategories, formatYen, guessIconKey, iconKeyOf, MONEY_ICONS, topCategories } from '@/lib/moneyUtils';
import { formatFiscalYear, parseAmountInput } from '@/lib/specialUtils';
import {
  insertDefaultMoneyCategories,
  insertMoneyCategory,
  saveMoneyBudget,
  updateMoneyCategory,
} from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 種類と予算（docs/kakei.md §3.1）。PWA版の `src/components/sukusuku/money/CategoryEditor.tsx` と同じ並び・文言。
//
// 大分類（予算を置く単位）と小分類の追加・名前の変更・並べ替え・使わなくする。予算は大分類ごと・年度ごとの月額で、
// その年度に入れていなければ前の年度の額のまま（ここで直すと、その年度の額になる）。
// 種類がまだ無い家族には「標準の種類で始める」（Zaim のカテゴリをもとにした並び）。

interface CategoryEditorProps {
  familyId: string;
  fiscalYear: number;
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
  fiscalYear: initialYear,
  categories,
  budgets,
  onCategories,
  onBudgets,
  onClose,
}: CategoryEditorProps) {
  const insets = useSafeAreaInsets();
  const [fiscalYear, setFiscalYear] = useState(initialYear);
  const [kind, setKind] = useState<MoneyCategoryKind>('living');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);

  const tops = useMemo(() => topCategories(categories, kind, true), [categories, kind]);
  const ordered = [...tops.filter((top) => !top.archived), ...tops.filter((top) => top.archived)];
  const totalBudget =
    kind === 'living'
      ? tops.filter((top) => !top.archived).reduce((sum, top) => sum + (budgetFor(budgets, top.id, fiscalYear) ?? 0), 0)
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

  /** 並びを1つ動かす。きょうだいの並びを数え直し、変わったものだけ保存する。 */
  const move = async (category: MoneyCategory, delta: -1 | 1) => {
    const siblings = siblingsOf(category);
    const index = siblings.findIndex((entry) => entry.id === category.id);
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const changed = reordered
      .map((entry, position) => ({ entry, position }))
      .filter(({ entry, position }) => entry.position !== position);
    onCategories((prev) =>
      prev.map((entry) => {
        const hit = changed.find((change) => change.entry.id === entry.id);
        return hit ? { ...entry, position: hit.position } : entry;
      }),
    );
    try {
      await Promise.all(changed.map(({ entry, position }) => updateMoneyCategory(supabase, entry.id, { position })));
    } catch {
      failed('並べ替え');
    }
  };

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
          position: siblings.reduce((max, entry) => Math.max(max, entry.position + 1), 0),
        });
        onCategories((prev) => [...prev, category]);
      } else {
        category = target.category;
        if (result.name.trim() !== category.name || result.icon !== category.icon) {
          category = await updateMoneyCategory(supabase, category.id, { name: result.name, icon: result.icon });
          replace(category);
        }
      }
      if (result.budget !== null && result.budget !== budgetFor(budgets, category.id, fiscalYear)) {
        const saved = await saveMoneyBudget(supabase, familyId, category.id, fiscalYear, result.budget);
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
        <ScreenHeader title="種類と予算" onClose={onClose} />
        <View style={styles.bar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="前の年度"
            onPress={() => setFiscalYear((year) => year - 1)}
            hitSlop={8}
            style={styles.yearButton}
          >
            <ChevronLeft size={18} color={colors.textSubtle} />
          </Pressable>
          <Text style={styles.year}>{formatFiscalYear(fiscalYear)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="次の年度"
            onPress={() => setFiscalYear((year) => year + 1)}
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

        <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
          {categories.length === 0 && (
            <View style={styles.seed}>
              <Text style={styles.seedText}>
                種類がまだありません。Zaim のカテゴリをもとにした標準の種類で始めて、名前や並びをあとで直せます。
              </Text>
              <PrimaryButton label="標準の種類で始める" onPress={() => void seed()} disabled={busy} />
            </View>
          )}
          {ordered.map((top) => {
            const children = childCategories(categories, top.id, true);
            const budget = kind === 'living' ? budgetFor(budgets, top.id, fiscalYear) : null;
            return (
              <View key={top.id} style={[styles.card, top.archived && styles.archived]}>
                <Pressable accessibilityRole="button" onPress={() => setEditing({ category: top })} style={styles.topRow}>
                  <CategoryIcon iconKey={iconKeyOf(top)} />
                  <Text style={styles.topName}>{top.name}</Text>
                  {top.archived && <Text style={styles.archivedLabel}>使わない</Text>}
                  <View style={styles.flex} />
                  {kind === 'living' && (
                    <Text style={styles.budget}>{budget === null ? '予算なし' : `月 ${formatYen(budget)}`}</Text>
                  )}
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
                <View style={styles.chips}>
                  {children.map((child) => (
                    <Pressable
                      key={child.id}
                      accessibilityRole="button"
                      onPress={() => setEditing({ category: child })}
                      style={[styles.chip, child.archived && styles.archived]}
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
            fiscalYear={fiscalYear}
            budget={editing.category ? budgetFor(budgets, editing.category.id, fiscalYear) : null}
            onClose={() => setEditing(null)}
            onSubmit={(result) => void save(result)}
            onMove={
              editing.category
                ? (delta) => {
                    const category = editing.category!;
                    setEditing(null);
                    void move(category, delta);
                  }
                : undefined
            }
            onToggleArchive={editing.category ? () => void toggleArchive(editing.category!) : undefined}
          />
        )}
      </View>
    </Modal>
  );
}

interface SheetResult {
  name: string;
  /** アイコン（大分類だけ）。null は名前から選ぶ。 */
  icon: string | null;
  /** 大分類の月の予算。入れなかった・小分類は null。 */
  budget: number | null;
}

function CategorySheet({
  category,
  isTop,
  showBudget,
  fiscalYear,
  budget,
  onClose,
  onSubmit,
  onMove,
  onToggleArchive,
}: {
  category: MoneyCategory | null;
  isTop: boolean;
  showBudget: boolean;
  fiscalYear: number;
  budget: number | null;
  onClose: () => void;
  onSubmit: (result: SheetResult) => void;
  onMove?: (delta: -1 | 1) => void;
  onToggleArchive?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [amount, setAmount] = useState(budget === null ? '' : String(budget));
  const [icon, setIcon] = useState<string | null>(category?.icon ?? null);
  const [error, setError] = useState<string | null>(null);
  const withBudget = isTop && showBudget;

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    const value = amount.trim() === '' ? null : parseAmountInput(amount);
    if (withBudget && amount.trim() !== '' && value === null) return setError('予算は0以上の整数（円）で入れてください');
    onSubmit({ name, icon: isTop ? icon : (category?.icon ?? null), budget: withBudget ? value : null });
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
            <View style={styles.icons}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="名前から選ぶ"
                accessibilityState={{ selected: icon === null }}
                onPress={() => setIcon(null)}
                style={[styles.iconChoice, icon === null && styles.iconChoiceSelected]}
              >
                <CategoryIcon iconKey={guessIconKey(name)} size={34} />
                <Text style={styles.iconAuto}>自動</Text>
              </Pressable>
              {MONEY_ICONS.map((entry) => (
                <Pressable
                  key={entry.key}
                  accessibilityRole="button"
                  accessibilityLabel={entry.label}
                  accessibilityState={{ selected: icon === entry.key }}
                  onPress={() => setIcon(entry.key)}
                  style={[styles.iconChoice, icon === entry.key && styles.iconChoiceSelected]}
                >
                  <CategoryIcon iconKey={entry.key} size={34} />
                </Pressable>
              ))}
            </View>
          </View>
        )}
        {withBudget && (
          <View style={styles.field}>
            <Text style={styles.label}>{formatFiscalYear(fiscalYear)}の月の予算（円）</Text>
            <TextInput
              style={styles.input}
              value={amount}
              onChangeText={setAmount}
              keyboardType="number-pad"
              placeholder="未設定"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.hint}>次の年度も、直すまで同じ額を使います</Text>
          </View>
        )}
        {onMove && (
          <View style={styles.moveRow}>
            <Text style={styles.label}>並び</Text>
            <Pressable accessibilityRole="button" onPress={() => onMove(-1)} style={styles.moveButton}>
              <ArrowUp size={16} color={colors.textSubtle} />
              <Text style={styles.moveText}>上へ</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => onMove(1)} style={styles.moveButton}>
              <ArrowDown size={16} color={colors.textSubtle} />
              <Text style={styles.moveText}>下へ</Text>
            </Pressable>
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
  iconAuto: { position: 'absolute', bottom: -1, fontSize: 9, fontWeight: '700', color: colors.textMuted },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  moveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.neutralSurface,
  },
  moveText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '700', color: colors.money },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
