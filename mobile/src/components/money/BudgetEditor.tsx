import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  budgetMonths,
  categoryPath,
  estimateBudgetFor,
  estimateCostsInYear,
  fixedBudgetFor,
  formatYear,
  formatYen,
  iconKeyOf,
  manualBudgetFor,
  parseAmountInput,
  recurringInYear,
  recurringPeriodLabel,
  topCategories,
  yearMonthKeys,
  type EstimateCostOccurrence,
} from '@/lib/moneyUtils';
import { toDateString } from '@/lib/dateUtils';
import { saveMoneyBudget, updateMoneyRecurringSkipped } from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import { CategoryIcon, PrimaryButton, ScreenHeader, SectionHeader } from '@/components/money/moneyVisual';

// 予算（docs/kakei.md §3.1・§3.5）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// カテゴリ（CategoryEditor）とは別の設定にした（2026-10-15）。カテゴリは名前・並び・アイコンで年に関係なく、
// 予算は**年ごと**に決めるもの（来年の予算も、いつでも決められる）。上の年の送りで年を替え、大分類ごとにその年の1月〜12月の月の予算を決める。
// 決めていない年は、前の年の12月の額を引き継ぐ（「前年から引き継ぎ」）。固定費（毎月自動で記録するルール）は、その月の予算に自動で足される。
// 固定支出・固定収入は年をまたぐものもあるので、期間（開始月・終了月）と記録する月から、**その年に効くものだけ**を年の額で下に並べる。
// 上の「年の見込み」は、固定収入の年の合計と、支出の予算（固定費を含む）の年の合計、その差。
//
// 2026-10-17（docs/kakei.md §3.6）: 支出の予算を性質で3段に分けて並べる。
// - 変動費: 大分類ごとの手入力の月額（日々のやりくりで守る額）。押すと月ごとの予算を決める
// - 固定費: 自動で記録する固定支出（読むだけ。直すのは「固定支出」）
// - 見積費: 記録を作らない固定支出（車検・ふるさと納税など）の回を月の順に。実績の結びつき（済・これから・記録なし・今年はなし）を出し、
//   押すと「今年はなし」にできる（足す・直すのは「固定支出」）

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  /** 手入力の予算と、固定費から出した予算（fixed: true）。 */
  budgets: MoneyBudget[];
  recurring: MoneyRecurring[];
  records: MoneyRecord[];
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  /** 見積費の「今年はなし」を直したあと。 */
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onClose: () => void;
}

/** 「3月」。 */
const monthLabel = (monthKey: string) => `${Number(monthKey.slice(5, 7))}月`;

/** 見積費の回の状態の言い方（docs/kakei.md §3.6）。 */
function occurrenceStatus(entry: EstimateCostOccurrence, thisMonth: string): string {
  switch (entry.status) {
    case 'done':
      return entry.actualMonth !== null && entry.actualMonth !== entry.plannedMonth
        ? `実績 ${formatYen(entry.actual)}（${monthLabel(entry.plannedMonth)}の予定 → ${monthLabel(entry.actualMonth)}に移しました）`
        : `実績 ${formatYen(entry.actual)}`;
    case 'overdue':
      return entry.placedMonth === thisMonth
        ? `${monthLabel(entry.plannedMonth)}の予定に記録がありません・今月へ送っています`
        : `${monthLabel(entry.plannedMonth)}の予定に記録がありませんでした`;
    case 'skipped':
      return '今年はなし';
    default:
      return entry.basisMonth !== null ? `これから・前回の実績から見込み` : 'これから';
  }
}

/** 見積費の見出し。品名、無ければカテゴリ。 */
function occurrenceTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  return rule.name.trim() || categoryPath(categories, rule.categoryId) || '見積費';
}

/** 固定のルールの見出し。品名、無ければお店、無ければカテゴリ。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = rule.name.trim() || rule.store.trim();
  return name !== '' ? name : categoryPath(categories, rule.categoryId) || (rule.kind === 'income' ? '収入' : '支出');
}

export default function BudgetEditor({
  familyId,
  year: initialYear,
  categories,
  budgets,
  recurring,
  records,
  onBudgets,
  onRecurring,
  onClose,
}: BudgetEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);

  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const tops = useMemo(
    () => topCategories(categories, 'living', true).filter((top) => !top.archived),
    [categories],
  );
  const rows = useMemo(
    () =>
      tops.map((top) => {
        // 変動費＝手入力の額だけ（固定費・見積費は下の段に分けて出す）。
        const monthly = monthKeys.map((key) => manualBudgetFor(budgets, top.id, key) ?? 0);
        const fixed = monthKeys.reduce((sum, key) => sum + fixedBudgetFor(budgets, top.id, key), 0);
        const estimate = monthKeys.reduce((sum, key) => sum + estimateBudgetFor(budgets, top.id, key), 0);
        const total = monthly.reduce((sum, value) => sum + value, 0);
        return {
          top,
          total,
          fixed,
          estimate,
          even: monthly.every((value) => value === monthly[0]),
          average: Math.round(total / 12),
          // その年の手入力の予算を決めていない（前の年の12月の額を引き継いでいる）。
          inherited: !budgets.some((entry) => !entry.fixed && entry.categoryId === top.id && entry.year === year),
        };
      }),
    [tops, monthKeys, budgets, year],
  );
  const variableTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const fixedTotal = rows.reduce((sum, row) => sum + row.fixed, 0);
  const estimateTotal = rows.reduce((sum, row) => sum + row.estimate, 0);
  const expenseTotal = variableTotal + fixedTotal + estimateTotal;
  const today = toDateString(new Date());
  const thisMonth = today.slice(0, 7);
  const occurrences = useMemo(() => estimateCostsInYear(recurring, records, year, today), [recurring, records, year, today]);
  const fixedRows = useMemo(() => recurringInYear(recurring, records, year), [recurring, records, year]);
  const incomeRows = fixedRows.filter((row) => row.rule.kind === 'income');
  const outgoRows = fixedRows.filter((row) => row.rule.kind !== 'income');
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.total, 0);
  const plan = incomeTotal - expenseTotal;

  // 見積費の回を「今年はなし」にする・戻す（その回の予定の月を skippedMonths に出し入れする）。
  const toggleSkip = async (entry: EstimateCostOccurrence) => {
    const skipped = entry.rule.skippedMonths ?? [];
    const next = skipped.includes(entry.plannedMonth)
      ? skipped.filter((monthKey) => monthKey !== entry.plannedMonth)
      : [...skipped, entry.plannedMonth].sort();
    try {
      const saved = await updateMoneyRecurringSkipped(supabase, entry.rule.id, next);
      onRecurring((prev) => prev.map((rule) => (rule.id === saved.id ? saved : rule)));
    } catch {
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
    }
  };

  const openOccurrence = (entry: EstimateCostOccurrence) => {
    const title = `${occurrenceTitle(entry.rule, categories)}（${monthLabel(entry.plannedMonth)}の予定）`;
    if (entry.status === 'done') {
      return Alert.alert(title, `見積 ${formatYen(entry.amount)}・実績 ${formatYen(entry.actual)}。見積額・月を直すのは「固定支出」から。`);
    }
    Alert.alert(
      title,
      entry.status === 'skipped'
        ? 'この回を今年の予算と着地見込みに戻しますか？'
        : 'この回を今年はなしにしますか？ 今年の予算と着地見込みから外します（来年からは元どおり）。',
      [
        { text: 'やめる', style: 'cancel' },
        { text: entry.status === 'skipped' ? '戻す' : '今年はなし', onPress: () => void toggleSkip(entry) },
      ],
    );
  };

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
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
    }
  };

  const fixedRow = (row: (typeof fixedRows)[number], index: number) => {
    const period = recurringPeriodLabel(row.rule);
    const active = row.amounts.filter((value) => value > 0).length;
    return (
      <View key={row.rule.id} style={[styles.row, index > 0 && styles.divided]}>
        <View style={styles.flex}>
          <Text style={styles.rowName} numberOfLines={1}>
            {ruleTitle(row.rule, categories)}
          </Text>
          <Text style={styles.faint} numberOfLines={1}>
            {row.rule.kind === 'income' ? '収入' : '支出'}・{active}か月{period !== '' ? `・${period}` : ''}
          </Text>
        </View>
        <Text style={[styles.rowAmount, row.rule.kind === 'income' && styles.income]}>年 {formatYen(row.total)}</Text>
      </View>
    );
  };

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
              <Text style={styles.summaryLabel}>固定収入</Text>
              <Text style={[styles.summaryValue, styles.income]}>{formatYen(incomeTotal)}</Text>
            </View>
            <View style={[styles.summaryRow, styles.divided]}>
              <Text style={styles.summaryLabel}>支出の予算</Text>
              <Text style={styles.summaryValue}>{formatYen(expenseTotal)}</Text>
            </View>
            {[
              { label: '変動費', value: variableTotal },
              { label: '固定費', value: fixedTotal },
              { label: '見積費', value: estimateTotal },
            ].map((part) => (
              <View key={part.label} style={styles.partRow}>
                <Text style={styles.partLabel}>{part.label}</Text>
                <Text style={styles.partValue}>{formatYen(part.value)}</Text>
              </View>
            ))}
            <View style={[styles.summaryRow, styles.divided]}>
              <Text style={styles.summaryLabel}>収支</Text>
              <Text style={[styles.summaryValue, plan > 0 && styles.income]}>
                {plan < 0 ? '−' : ''}
                {formatYen(plan)}
              </Text>
            </View>
          </View>

          <SectionHeader compact title="変動費（大分類ごとの月の予算）" />
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
                  <View style={styles.flex}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {row.top.name}
                    </Text>
                    <Text style={styles.faint} numberOfLines={1}>
                      {row.total === 0 ? '予算なし' : `${row.even ? '毎月' : '月平均'} ${formatYen(row.average)}`}
                      {row.fixed + row.estimate > 0 ? `・ほかに固定費・見積費 年${formatYen(row.fixed + row.estimate)}` : ''}
                      {row.inherited && row.total > 0 ? '・前年から引き継ぎ' : ''}
                    </Text>
                  </View>
                  <Text style={styles.rowAmount}>{row.total === 0 ? '−' : `年 ${formatYen(row.total)}`}</Text>
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          )}

          <SectionHeader compact title="固定費（自動で記録）" />
          {outgoRows.length === 0 ? (
            <Text style={styles.message}>この年に効く固定支出はありません</Text>
          ) : (
            <View style={styles.card}>{outgoRows.map((row, index) => fixedRow(row, index))}</View>
          )}

          <SectionHeader compact title="見積費（記録は作らない）" />
          {occurrences.length === 0 ? (
            <Text style={styles.message}>この年の見積費はありません。車検・ふるさと納税などは「固定支出」で見積費として足します</Text>
          ) : (
            <View style={styles.card}>
              {occurrences.map((entry, index) => (
                <Pressable
                  key={`${entry.rule.id}-${entry.plannedMonth}`}
                  accessibilityRole="button"
                  onPress={() => openOccurrence(entry)}
                  style={({ pressed }) => [styles.row, index > 0 && styles.divided, pressed && styles.pressed]}
                >
                  <Text style={[styles.occurrenceMonth, entry.status === 'overdue' && styles.overdue]}>
                    {monthLabel(entry.actualMonth ?? entry.plannedMonth)}
                  </Text>
                  <View style={styles.flex}>
                    <Text style={[styles.rowName, entry.status === 'skipped' && styles.skipped]} numberOfLines={1}>
                      {occurrenceTitle(entry.rule, categories)}
                    </Text>
                    <Text style={[styles.faint, entry.status === 'overdue' && styles.overdue]} numberOfLines={2}>
                      {occurrenceStatus(entry, thisMonth)}
                    </Text>
                  </View>
                  <Text style={[styles.rowAmount, entry.status === 'skipped' && styles.skipped]}>{formatYen(entry.amount)}</Text>
                </Pressable>
              ))}
            </View>
          )}

          {incomeRows.length > 0 && (
            <>
              <SectionHeader compact title="固定収入" />
              <View style={styles.card}>{incomeRows.map((row, index) => fixedRow(row, index))}</View>
            </>
          )}
          <Text style={styles.note}>固定費・見積費・固定収入を足す・直すのは、家計の設定の「固定支出」「固定収入」から</Text>
        </ScrollView>

        {editing !== null && (
          <BudgetSheet
            key={`${editing.id}-${year}`}
            category={editing}
            year={year}
            monthAmounts={budgetMonths(budgets, editing.id, year)}
            previousAmounts={budgetMonths(budgets, editing.id, year - 1)}
            fixed={monthKeys.map((key) => fixedBudgetFor(budgets, editing.id, key))}
            estimate={monthKeys.map((key) => estimateBudgetFor(budgets, editing.id, key))}
            onClose={() => setEditing(null)}
            onSubmit={(amounts) => void save(editing, amounts)}
          />
        )}
      </View>
    </Modal>
  );
}

function BudgetSheet({
  category,
  year,
  monthAmounts,
  previousAmounts,
  fixed,
  estimate,
  onClose,
  onSubmit,
}: {
  category: MoneyCategory;
  year: number;
  monthAmounts: (number | null)[];
  previousAmounts: (number | null)[];
  fixed: number[];
  /** その月に足される見積費（docs/kakei.md §3.6）。 */
  estimate: number[];
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
            const manual = text.trim() === '' ? null : parseAmountInput(text);
            const total = (manual ?? 0) + fixed[index] + estimate[index];
            const added = [
              fixed[index] > 0 ? `＋固定費 ${formatYen(fixed[index])}` : '',
              estimate[index] > 0 ? `＋見積費 ${formatYen(estimate[index])}` : '',
            ].join('');
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
                {added !== '' && (
                  <Text style={styles.fixedText}>
                    {added}＝{formatYen(total)}
                  </Text>
                )}
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
  summaryLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  summaryValue: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  income: { color: colors.moneyIncome },
  partRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 14, paddingLeft: 28, paddingBottom: 6 },
  partLabel: { flex: 1, fontSize: 12, fontWeight: '500', color: colors.textFaint },
  partValue: { fontSize: 12, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  occurrenceMonth: { width: 34, fontSize: 13, fontWeight: '700', color: colors.moneyText },
  overdue: { color: colors.moneyEstimate },
  skipped: { color: colors.textFaint, textDecorationLine: 'line-through' },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10 },
  pressed: { backgroundColor: colors.background },
  rowName: { fontSize: 14, fontWeight: '600', color: colors.text },
  rowAmount: { fontSize: 14, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  faint: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 1 },
  message: { fontSize: 13, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  note: { fontSize: 11, fontWeight: '500', color: colors.textFaint, lineHeight: 17, paddingTop: 8 },
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
});
