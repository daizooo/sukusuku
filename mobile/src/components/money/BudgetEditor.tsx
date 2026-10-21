import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyReserve } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  budgetMonths,
  categoryPath,
  formatYear,
  formatYen,
  iconKeyOf,
  manualBudgetFor,
  monthsLabel,
  parseAmountInput,
  recurringInYear,
  recurringPeriodLabel,
  recurringPlanInYear,
  reserveAmountFor,
  reserveCategoryIds,
  topCategories,
  yearMonthKeys,
  type RecurringYearRow,
} from '@/lib/moneyUtils';
import { toDateString } from '@/lib/dateUtils';
import { deleteMoneyReserve, saveMoneyBudget, saveMoneyReserve } from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import CategoryPicker from '@/components/money/CategoryPicker';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 予算（docs/kakei.md §3.1・§3.5・§3.6・§3.7）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// カテゴリ（CategoryEditor）とは別の設定にした（2026-10-15）。カテゴリは名前・並び・アイコンで年に関係なく、
// 予算は**年ごと**に決めるもの（来年の予算も、いつでも決められる）。上の年の送りで年を替える。
//
// 予算を充てるのは変動費と予備費だけ（2026-10-21。docs/kakei.md §0.7。固定費〔確定・見込み〕は予算に足さない）。
// - 変動費: 大分類ごとの手入力の月額。押すと1月〜12月の月の予算を決める。決めていない年は前の年の12月の額を引き継ぐ
// - 予備費: 小分類ごとの年の額。押すと額を決める・予備費から外す。「＋ 追加する」で小分類を選んで額を決める
// 上の枠は、収入・支出（変動費・固定費・予備費）・収支見込み。固定費は予算ではなく、固定支出のルールから数えた見込み（recurringPlanInYear）。
// その下に、収入（固定収入）の一覧。収入の行は、カテゴリを大きく、品名を下に（お店は出さない）。押すと、そのルールの「固定収入」の編集が開く。

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  /** 手入力の予算（変動費）。 */
  budgets: MoneyBudget[];
  recurring: MoneyRecurring[];
  records: MoneyRecord[];
  /** 予備費の年の額（docs/kakei.md §3.7）。 */
  reserves: MoneyReserve[];
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  onReserves: (update: (prev: MoneyReserve[]) => MoneyReserve[]) => void;
  /** 収入の行から、そのルールの「固定収入」の編集を開く。 */
  onOpenRecurring?: (id: string) => void;
  onClose: () => void;
}

/** 記録する月と1回の額（「月 ¥98,000」「奇数月 ¥10,000」）と期間。額が回ごとに違うものは平均（「約¥14,000」）。 */
function scheduleText(row: RecurringYearRow): string {
  const { rule } = row;
  // 毎月のものは「月」（予算の画面。2026-10-18）。
  const label = rule.months === null ? '毎月' : monthsLabel(rule.months);
  const months = label === '毎月' ? '月' : label;
  const values = row.amounts.filter((value) => value > 0);
  const each =
    values.length === 0
      ? ''
      : values.every((value) => value === values[0])
        ? ` ${formatYen(values[0])}`
        : ` 約${formatYen(Math.round(row.total / values.length))}`;
  const period = recurringPeriodLabel(rule);
  return period === '' ? `${months}${each}` : `${months}${each}・${period}`;
}

export default function BudgetEditor({
  familyId,
  year: initialYear,
  categories,
  budgets,
  recurring,
  records,
  reserves,
  onBudgets,
  onReserves,
  onOpenRecurring,
  onClose,
}: BudgetEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);
  // 額を決めている予備費の小分類（新しく足すときは、まだ行の無い小分類）。
  const [editingReserve, setEditingReserve] = useState<MoneyCategory | null>(null);
  const [pickingReserve, setPickingReserve] = useState(false);

  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  // 変動費の大分類。小分類がすべて予備費の大分類（大分類「予備費」）は出さない。
  const tops = useMemo(() => {
    const reserveIds = reserveCategoryIds(reserves);
    return topCategories(categories, 'living', true).filter((top) => {
      if (top.archived) return false;
      const children = categories.filter((category) => category.parentId === top.id && !category.archived);
      return children.length === 0 || children.some((child) => !reserveIds.has(child.id));
    });
  }, [categories, reserves]);
  const rows = useMemo(
    () =>
      tops.map((top) => {
        const monthly = monthKeys.map((key) => manualBudgetFor(budgets, top.id, key) ?? 0);
        const total = monthly.reduce((sum, value) => sum + value, 0);
        return {
          top,
          total,
          // 月の額。月ごとに違えば平均（「約」）。
          monthly: monthly.every((value) => value === monthly[0])
            ? `月 ${formatYen(monthly[0])}`
            : `月 約${formatYen(Math.round(total / 12))}`,
          even: monthly.every((value) => value === monthly[0]),
          average: Math.round(total / 12),
          // その年の手入力の予算を決めていない（前の年の12月の額を引き継いでいる）。
          inherited: !budgets.some((entry) => entry.categoryId === top.id && entry.year === year),
        };
      }),
    [tops, monthKeys, budgets, year],
  );
  const today = toDateString(new Date());
  const fixedRows = useMemo(() => recurringInYear(recurring, records, year), [recurring, records, year]);
  const incomeRows = fixedRows.filter((row) => row.rule.kind === 'income');
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.total, 0);
  // 固定費（確定・見込み）は予算ではなく、ルールから数えた見込み（年末の着地見込みと同じ数え方）。
  const fixedTotal = useMemo(
    () => recurringPlanInYear(recurring, categories, budgets, records, year, today).expense.reduce((sum, value) => sum + value, 0),
    [recurring, categories, budgets, records, year, today],
  );
  const variableTotal = rows.reduce((sum, row) => sum + row.total, 0);
  // 予備費の小分類（カテゴリの並び順。大分類の並び → 小分類の並び）。
  const reserveRows = useMemo(() => {
    const ids = reserveCategoryIds(reserves);
    const position = (id: string | null) => categories.find((category) => category.id === id)?.position ?? 0;
    return categories
      .filter((category) => ids.has(category.id))
      .sort((a, b) => position(a.parentId) - position(b.parentId) || a.position - b.position)
      .map((category) => ({ category, path: categoryPath(categories, category.id), amount: reserveAmountFor(reserves, category.id, year) }));
  }, [categories, reserves, year]);
  const reserveTotal = reserveRows.reduce((sum, row) => sum + row.amount, 0);
  const expenseTotal = variableTotal + fixedTotal + reserveTotal;
  const plan = incomeTotal - expenseTotal;

  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');

  const save = async (category: MoneyCategory, amounts: (number | null)[]) => {
    setEditing(null);
    try {
      const current = budgetMonths(budgets, category.id, year);
      const changed = amounts.some((value, index) => value !== current[index]);
      // 変えていなくても、引き継いでいた額は、その年の予算として決める（保存する）。
      const inherited = rows.find((row) => row.top.id === category.id)?.inherited === true;
      if (!changed && !(inherited && amounts.some((value) => value !== null))) return;
      const saved = await saveMoneyBudget(supabase, familyId, category.id, year, amounts);
      onBudgets((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);
    } catch {
      failed();
    }
  };

  const saveReserve = async (category: MoneyCategory, amount: number) => {
    setEditingReserve(null);
    try {
      const saved = await saveMoneyReserve(supabase, familyId, category.id, year, amount);
      onReserves((prev) => [...prev.filter((entry) => !(entry.categoryId === saved.categoryId && entry.year === saved.year)), saved]);
    } catch {
      failed();
    }
  };

  const removeReserve = (category: MoneyCategory) =>
    Alert.alert(`${categoryPath(categories, category.id)}を予備費から外しますか？`, 'すべての年の額を消します。記録はそのまま残ります。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '外す',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setEditingReserve(null);
            try {
              await deleteMoneyReserve(supabase, category.id);
              onReserves((prev) => prev.filter((entry) => entry.categoryId !== category.id));
            } catch {
              failed();
            }
          })(),
      },
    ]);

  // 収入の行の、カテゴリのアイコン（大分類）と、名前の下に出すカテゴリ（「給与 › 大造」）。
  const categoryOf = (rule: MoneyRecurring) => {
    const category = categories.find((entry) => entry.id === rule.categoryId);
    const top = category && category.parentId !== null ? categories.find((entry) => entry.id === category.parentId) : category;
    return { top: top ?? null, path: categoryPath(categories, rule.categoryId) };
  };
  const ruleIcon = (rule: MoneyRecurring) => {
    const { top } = categoryOf(rule);
    return top ? <CategoryIcon iconKey={iconKeyOf(top)} size={28} /> : <View style={styles.iconSpace} />;
  };
  // カテゴリを大きく、品名を下に（お店は出さない）。カテゴリが無ければ品名を大きく。
  const ruleName = (rule: MoneyRecurring) => {
    const name = rule.name.trim();
    const { path: category } = categoryOf(rule);
    const title = category || name || (rule.kind === 'income' ? '収入' : '支出');
    const path = category !== '' ? name : '';
    return (
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={[styles.rowName, styles.shrink]} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {path !== '' && path !== title && (
          <Text style={styles.categoryText} numberOfLines={1}>
            {path}
          </Text>
        )}
      </View>
    );
  };

  const fixedRow = (row: RecurringYearRow, first = false) => (
    <Pressable
      key={row.rule.id}
      accessibilityRole="button"
      disabled={!onOpenRecurring}
      onPress={() => onOpenRecurring?.(row.rule.id)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      {ruleIcon(row.rule)}
      {ruleName(row.rule)}
      <View style={styles.right}>
        <Text style={[styles.rowAmount, row.rule.kind === 'income' && styles.income]}>{formatYen(row.total)}</Text>
        <Text style={styles.note}>{scheduleText(row)}</Text>
      </View>
      {onOpenRecurring && <ChevronRight size={16} color={colors.textFaint} />}
    </Pressable>
  );

  const sectionHeader = (title: string, total: number, onPress?: () => void) => (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} disabled={!onPress} onPress={onPress} style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.flex} />
      <Text style={styles.sectionTotal}>{formatYen(total)}</Text>
      {onPress && <ChevronRight size={16} color={colors.textFaint} />}
    </Pressable>
  );

  if (pickingReserve) {
    return (
      <Modal visible animationType="slide" onRequestClose={() => setPickingReserve(false)}>
        <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
          <CategoryPicker
            kind="expense"
            categories={categories}
            onPick={(choice) => {
              setPickingReserve(false);
              const category = categories.find((entry) => entry.id === choice.categoryId);
              if (category) setEditingReserve(category);
            }}
            onClose={() => setPickingReserve(false)}
          />
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        <ScreenHeader title="予算" onClose={onClose} />
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
        </View>

        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.card}>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>収入</Text>
              <Text style={[styles.summaryValue, styles.income]}>{formatYen(incomeTotal)}</Text>
            </View>
            <View style={[styles.summaryRow, styles.divided]}>
              <Text style={styles.summaryLabel}>支出</Text>
              <Text style={styles.summaryValue}>{formatYen(expenseTotal)}</Text>
            </View>
            {[
              { label: '変動費', value: variableTotal },
              { label: '固定費（見込み）', value: fixedTotal },
              { label: '予備費', value: reserveTotal },
            ].map((part) => (
              <View key={part.label} style={styles.partRow}>
                <Text style={styles.partLabel}>{part.label}</Text>
                <Text style={styles.partValue}>{formatYen(part.value)}</Text>
              </View>
            ))}
            <View style={[styles.summaryRow, styles.divided]}>
              <Text style={[styles.summaryLabel, styles.strong]}>収支見込み</Text>
              <Text style={[styles.summaryValue, styles.big, plan > 0 && styles.income]}>
                {plan < 0 ? '−' : plan > 0 ? '＋' : ''}
                {formatYen(plan)}
              </Text>
            </View>
          </View>

          {sectionHeader('収入', incomeTotal)}
          {incomeRows.length === 0 ? (
            <Text style={styles.message}>この年の収入の見込みはありません</Text>
          ) : (
            <View style={styles.card}>{incomeRows.map((row, index) => fixedRow(row, index === 0))}</View>
          )}

          {sectionHeader('変動費', variableTotal)}
          {rows.length === 0 ? (
            <Text style={styles.message}>生活費の大分類がありません。先に「カテゴリ」で作ってください</Text>
          ) : (
            <View style={styles.card}>
              {rows.map((row, index) => (
                <Pressable
                  key={row.top.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.top.name}の${formatYear(year)}の予算を決める`}
                  onPress={() => setEditing(row.top)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <CategoryIcon iconKey={iconKeyOf(row.top)} size={28} />
                  <Text style={[styles.rowName, styles.flex]} numberOfLines={1}>
                    {row.top.name}
                  </Text>
                  <View style={styles.right}>
                    <Text style={styles.rowAmount}>{row.total === 0 ? '−' : formatYen(row.total)}</Text>
                    {row.total > 0 && <Text style={styles.note}>{row.monthly}</Text>}
                  </View>
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          )}

          {sectionHeader('予備費', reserveTotal)}
          <View style={styles.card}>
            {reserveRows.map((row, index) => (
              <Pressable
                key={row.category.id}
                accessibilityRole="button"
                accessibilityLabel={`${row.path}の${formatYear(year)}の予備費を決める`}
                onPress={() => setEditingReserve(row.category)}
                style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}
              >
                <Text style={[styles.rowName, styles.flex]} numberOfLines={1}>
                  {row.path}
                </Text>
                <Text style={styles.rowAmount}>{row.amount === 0 ? '−' : formatYen(row.amount)}</Text>
                <ChevronRight size={16} color={colors.textFaint} />
              </Pressable>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickingReserve(true)}
              style={({ pressed }) => [styles.row, reserveRows.length > 0 && styles.divided, pressed && styles.pressed]}
            >
              <Plus size={16} color={colors.money} />
              <Text style={styles.addText}>追加する</Text>
            </Pressable>
          </View>
        </ScrollView>

        {editing !== null && (
          <BudgetSheet
            key={`${editing.id}-${year}`}
            category={editing}
            year={year}
            monthAmounts={budgetMonths(budgets, editing.id, year)}
            previousAmounts={budgetMonths(budgets, editing.id, year - 1)}
            onClose={() => setEditing(null)}
            onSubmit={(amounts) => void save(editing, amounts)}
          />
        )}
        {editingReserve !== null && (
          <ReserveSheet
            key={`${editingReserve.id}-${year}`}
            title={categoryPath(categories, editingReserve.id)}
            year={year}
            amount={reserveAmountFor(reserves, editingReserve.id, year)}
            linked={reserveRows.some((row) => row.category.id === editingReserve.id)}
            onClose={() => setEditingReserve(null)}
            onSubmit={(amount) => void saveReserve(editingReserve, amount)}
            onRemove={() => removeReserve(editingReserve)}
          />
        )}
      </View>
    </Modal>
  );
}

/** 予備費の小分類の、その年の額。予備費の小分類なら「予備費から外す」も出す。 */
function ReserveSheet({
  title,
  year,
  amount,
  linked,
  onClose,
  onSubmit,
  onRemove,
}: {
  title: string;
  year: number;
  amount: number;
  linked: boolean;
  onClose: () => void;
  onSubmit: (amount: number) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(amount > 0 ? String(amount) : '');
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const value = text.trim() === '' ? 0 : parseAmountInput(text);
    if (value === null) return setError('0以上の整数（円）で入れてください');
    onSubmit(value);
  };
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={`予備費（${formatYear(year)}）`}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {linked && (
              <Pressable accessibilityRole="button" onPress={onRemove} style={styles.removeButton}>
                <Text style={styles.removeText}>予備費から外す</Text>
              </Pressable>
            )}
          </>
        }
      >
        <Text style={styles.reserveTitle}>{title}</Text>
        <View style={styles.field}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            keyboardType="number-pad"
            placeholder="年の額（円）"
            placeholderTextColor={colors.textFaint}
          />
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      </LogModalShell>
    </SheetModal>
  );
}

function BudgetSheet({
  category,
  year,
  monthAmounts,
  previousAmounts,
  onClose,
  onSubmit,
}: {
  category: MoneyCategory;
  year: number;
  monthAmounts: (number | null)[];
  previousAmounts: (number | null)[];
  onClose: () => void;
  onSubmit: (amounts: (number | null)[]) => void;
}) {
  const [amounts, setAmounts] = useState<string[]>(() => monthAmounts.map((value) => (value === null ? '' : String(value))));
  const [bulk, setBulk] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const values = amounts.map((text) => (text.trim() === '' ? null : parseAmountInput(text)));
    if (values.some((value, index) => value === null && amounts[index].trim() !== '')) {
      return setError('予算は0以上の整数（円）で入れてください');
    }
    onSubmit(values);
  };

  const fillAll = () => {
    const value = parseAmountInput(bulk);
    if (bulk.trim() === '' || value === null) return setError('まとめて入れる額は0以上の整数（円）で入れてください');
    setError(null);
    setAmounts(Array.from({ length: 12 }, () => String(value)));
  };

  const copyPrevious = () => {
    setError(null);
    setAmounts(previousAmounts.map((value) => (value === null ? '' : String(value))));
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={`${category.name}の予算（${formatYear(year)}）`}
        onClose={onClose}
        footer={<PrimaryButton label="保存する" onPress={submit} />}
      >
        <View style={styles.field}>
          <View style={styles.bulkRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={bulk}
              onChangeText={setBulk}
              keyboardType="number-pad"
              placeholder="同じ額をまとめて入れる"
              placeholderTextColor={colors.textFaint}
            />
            <Pressable accessibilityRole="button" onPress={fillAll} style={styles.bulkButton}>
              <Text style={styles.bulkButtonText}>全ての月に入れる</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={copyPrevious} style={styles.copyButton}>
            <Text style={styles.bulkButtonText}>{formatYear(year - 1)}の額を入れる</Text>
          </Pressable>
          {amounts.map((text, index) => {
            return (
              <View key={index} style={styles.monthRow}>
                <Text style={styles.monthLabel}>{index + 1}月</Text>
                <TextInput
                  style={[styles.input, styles.monthInput]}
                  value={text}
                  onChangeText={(next) => setAmounts((prev) => prev.map((value, at) => (at === index ? next : value)))}
                  keyboardType="number-pad"
                  placeholder="未設定"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            );
          })}
        </View>
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
  barHint: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '500', color: colors.textFaint },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingVertical: 11 },
  summaryLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textMuted },
  summaryValue: { fontSize: 17, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  income: { color: colors.moneyIncome },
  partRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingRight: 14, paddingLeft: 26, paddingBottom: 6 },
  partRowSub: { paddingLeft: 40, paddingBottom: 4 },
  partLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.textMuted },
  partValue: { fontSize: 14, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  partSub: { fontSize: 13, color: colors.textFaint },
  strong: { fontWeight: '700', color: colors.text },
  big: { fontSize: 22 },
  section: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 16, paddingBottom: 6, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sectionTotal: { fontSize: 15, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  group: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, backgroundColor: colors.background },
  groupTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  groupTotal: { fontSize: 15, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  occurrenceMonth: { width: 34, fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  skipped: { color: colors.textFaint, textDecorationLine: 'line-through' },
  badge: { paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, backgroundColor: colors.neutralSurface },
  badgeText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  addText: { fontSize: 16, fontWeight: '700', color: colors.money },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  pressed: { backgroundColor: colors.background },
  rowName: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowAmount: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  faint: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 1 },
  right: { alignItems: 'flex-end' },
  note: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginTop: 2, fontVariant: ['tabular-nums'] },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  categoryText: { fontSize: 13, fontWeight: '500', color: colors.textMuted, marginTop: 2 },
  iconSpace: { width: 28 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  field: { gap: 6 },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
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
  bulkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  bulkButton: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.moneySoft },
  copyButton: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: colors.moneySoft },
  bulkButtonText: { fontSize: 13, fontWeight: '700', color: colors.moneyText },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  monthLabel: { width: 36, fontSize: 13, fontWeight: '700', color: colors.textSubtle },
  monthInput: { width: 120 },
  fixedText: { flex: 1, fontSize: 11, fontWeight: '600', color: colors.textFaint },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  reserveTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  removeButton: { paddingVertical: 12, alignItems: 'center' },
  removeText: { fontSize: 14, fontWeight: '700', color: colors.danger },
});
