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
  manualBudgetFor,
  monthsLabel,
  parseAmountInput,
  recurringInYear,
  estimateCostsInYear,
  recurringPlanInYear,
  reserveAmountFor,
  reserveCategoryIds,
  topCategories,
  topCategoryIdOf,
  yearMonthKeys,
  type EstimateCostOccurrence,
  type RecurringYearRow,
} from '@/lib/moneyUtils';
import { toDateString } from '@/lib/dateUtils';
import { deleteMoneyReserve, saveMoneyBudget, saveMoneyReserve, updateMoneyRecurringSkipped } from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import CategoryPicker from '@/components/money/CategoryPicker';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { AmountRow, BalanceCard, SECTION_DOTS, SectionCard, SubHeading } from '@/components/money/reviewParts';

// 予算（docs/kakei.md §3.1・§3.5・§3.6・§3.7）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// カテゴリ（CategoryEditor）とは別の設定にした（2026-10-15）。カテゴリは名前・並び・アイコンで年に関係なく、
// 予算は**年ごと**に決めるもの（来年の予算も、いつでも決められる）。上の年の送りで年を替える。
//
// 年間予算（2026-10-22に「予算」から改名。docs/kakei.md §0.7）。年間予算は 変動費・予備費・固定費。固定費は額の決まった予算で、毎月は追わない。
// - いちばん上は収支見込みの枠（BalanceCard。振り返りと同じ形）。収入・支出を切り替えて内訳の割合
// - 収入: 自動記録ルール（収入）の一覧（開いたときは閉じておく）
// - 変動費: 大分類ごとの手入力の月額（カテゴリの並び）。押すと1月〜12月の月の予算を決める。決めていない年は前の年の12月の額を引き継ぐ
// - 予備費: 小分類ごとの年の額。押すと額を決める・予備費から外す。「＋ 追加する」で小分類を選んで額を決める
// - 固定費: 額は自動記録ルールから（予算の額＝記録と同じ額）。「確定」「見込み」に分ける。帯に出すルールは回ごと（実績があれば「済」。押すと「今年はなし」）。
//   大分類に変動費の予算があるもの（電気・ガス・水道）は変動費で数えるので、ここには出さない
// どの枠も見出しを押すと折りたたむ。

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
  /** 帯に出すルールの「今年はなし」を直したあと。 */
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onReserves: (update: (prev: MoneyReserve[]) => MoneyReserve[]) => void;
  /** 収入・固定費の行から、その自動記録ルールの編集を開く。 */
  onOpenRecurring?: (id: string) => void;
  onClose: () => void;
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
  onRecurring,
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
  // 収入の大分類ごと（上の枠の内訳）。
  const incomeParts = useMemo(() => {
    const sums = new Map<string, number>();
    for (const row of incomeRows) {
      const topId = row.rule.categoryId === null ? null : topCategoryIdOf(categories, row.rule.categoryId);
      const name = categories.find((category) => category.id === topId)?.name ?? 'その他';
      sums.set(name, (sums.get(name) ?? 0) + row.total);
    }
    return [...sums].map(([name, amount]) => ({ name, amount })).filter((part) => part.amount > 0);
  }, [incomeRows, categories]);
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.total, 0);
  // 固定費（確定・見込み）。額は自動記録ルールから（年末の着地見込みと同じ数え方）。大分類に変動費の予算があるもの（電気・ガス・水道）は変動費で数える。
  const plan = useMemo(
    () => recurringPlanInYear(recurring, categories, budgets, records, year, today),
    [recurring, categories, budgets, records, year, today],
  );
  const confirmedTotal = plan.confirmed.reduce((sum, value) => sum + value, 0);
  const estimateTotal = plan.estimate.reduce((sum, value) => sum + value, 0);
  const inVariable = (categoryId: string | null) => {
    const topId = categoryId === null ? null : topCategoryIdOf(categories, categoryId);
    return topId !== null && monthKeys.some((key) => manualBudgetFor(budgets, topId, key) !== null);
  };
  const confirmedRows = fixedRows.filter((row) => row.rule.kind === 'expense' && row.rule.amountMode === 'fixed' && !inVariable(row.rule.categoryId));
  const estimateAutoRows = fixedRows.filter((row) => row.rule.kind === 'expense' && row.rule.amountMode !== 'fixed' && !inVariable(row.rule.categoryId));
  const occurrences = useMemo(
    () => estimateCostsInYear(recurring, records, year, today).filter((entry) => !inVariable(entry.rule.categoryId)),
    // inVariable は budgets・categories・monthKeys から決まる
    [recurring, records, year, today, budgets, categories, monthKeys],
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
  const [open, setOpen] = useState({ income: false, variable: true, reserve: true, fixed: true });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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

  // 記録を作らない回を「今年はなし」にする・戻す（その回の予定の月を skippedMonths に出し入れする）。
  const toggleSkip = async (entry: EstimateCostOccurrence) => {
    const skipped = entry.rule.skippedMonths ?? [];
    const next = skipped.includes(entry.plannedMonth)
      ? skipped.filter((monthKey) => monthKey !== entry.plannedMonth)
      : [...skipped, entry.plannedMonth].sort();
    try {
      const saved = await updateMoneyRecurringSkipped(supabase, entry.rule.id, next);
      onRecurring((prev) => prev.map((rule) => (rule.id === saved.id ? saved : rule)));
    } catch {
      failed();
    }
  };

  // 帯に出すルールの回: 「今年はなし」（戻す）か、自動記録ルールの編集へ。
  const openOccurrence = (entry: EstimateCostOccurrence) => {
    const title = `${ruleTitle(entry.rule)}（${Number(entry.plannedMonth.slice(5, 7))}月）`;
    const open = onOpenRecurring ? [{ text: 'ルールを開く', onPress: () => onOpenRecurring(entry.rule.id) }] : [];
    if (entry.status === 'done') {
      return Alert.alert(title, `見込み ${formatYen(entry.amount)}・実績 ${formatYen(entry.actual)}`, [{ text: '閉じる', style: 'cancel' }, ...open]);
    }
    Alert.alert(title, undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: entry.status === 'skipped' ? '今年の予算に戻す' : '今年はなし', onPress: () => void toggleSkip(entry) },
      ...open,
    ]);
  };

  // ルールの名前（品名、無ければカテゴリの小分類）。
  const ruleTitle = (rule: MoneyRecurring) =>
    rule.name.trim() || categories.find((category) => category.id === rule.categoryId)?.name || (rule.kind === 'income' ? '収入' : '支出');
  // 1回の額と、記録する月（毎月は「/月」）。
  const eachOf = (row: RecurringYearRow) => {
    const values = row.amounts.filter((value) => value > 0);
    const each = values.length === 0 ? 0 : values.every((value) => value === values[0]) ? values[0] : Math.round(row.total / values.length);
    return { amount: values.length > 1 && !values.every((value) => value === values[0]) ? `約${formatYen(each)}` : formatYen(each), unit: row.rule.months === null ? '/月' : monthsLabel(row.rule.months) };
  };
  const ruleRow = (row: RecurringYearRow) => {
    const { amount, unit } = eachOf(row);
    return (
      <AmountRow
        key={row.rule.id}
        name={ruleTitle(row.rule)}
        amount={amount}
        right={{ text: unit, muted: true }}
        onPress={onOpenRecurring ? () => onOpenRecurring(row.rule.id) : undefined}
      />
    );
  };
  const occurrenceRow = (entry: EstimateCostOccurrence) => (
    <AmountRow
      key={`${entry.rule.id}-${entry.plannedMonth}`}
      name={ruleTitle(entry.rule)}
      sub={entry.status === 'done' ? '済' : entry.status === 'skipped' ? '今年はなし' : undefined}
      faint={entry.status === 'skipped'}
      amount={formatYen(entry.status === 'done' ? entry.actual : entry.amount)}
      right={{ text: entry.rule.dayKnown === false && entry.status !== 'done' ? '日付未定' : `${Number((entry.actualMonth ?? entry.plannedMonth).slice(5, 7))}月`, muted: true }}
      onPress={() => openOccurrence(entry)}
    />
  );
  const confirmedOccurrences = occurrences.filter((entry) => entry.rule.amountMode === 'fixed');
  const estimateOccurrences = occurrences.filter((entry) => entry.rule.amountMode !== 'fixed');

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
        <ScreenHeader title="年間予算" onClose={onClose} />
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
          <BalanceCard
            label={`収支見込み（${formatYear(year)}）`}
            incomeParts={incomeParts}
            expenseParts={[
              { name: '変動費', amount: variableTotal + reserveTotal, note: '変動費＋予備費' },
              { name: '固定費', amount: confirmedTotal + estimateTotal, note: '固定費＋変動固定費' },
            ]}
          />

          <SectionCard
            title="収入"
            dot={SECTION_DOTS.income}
            chip={{ text: formatYen(incomeTotal), tone: 'good' }}
            open={open.income}
            onToggle={() => toggle('income')}
          >
            {incomeRows.length === 0 && <Text style={styles.message}>この年の収入の見込みはありません</Text>}
            {incomeRows.map(ruleRow)}
          </SectionCard>

          <SectionCard
            title="変動費"
            dot={SECTION_DOTS.variable}
            chip={{ text: formatYen(variableTotal), tone: 'neutral' }}
            open={open.variable}
            onToggle={() => toggle('variable')}
          >
            {rows.length === 0 && <Text style={styles.message}>生活費の大分類がありません。先に「カテゴリ」で作ってください</Text>}
            {rows.map((row) => (
              <AmountRow
                key={row.top.id}
                name={row.top.name}
                amount={row.total === 0 ? '−' : row.even ? formatYen(row.average) : `約${formatYen(row.average)}`}
                faint={row.total === 0}
                right={{ text: '/月', muted: true }}
                onPress={() => setEditing(row.top)}
              />
            ))}
          </SectionCard>

          <SectionCard
            title="予備費"
            dot={SECTION_DOTS.reserve}
            chip={{ text: formatYen(reserveTotal), tone: 'neutral' }}
            open={open.reserve}
            onToggle={() => toggle('reserve')}
          >
            {reserveRows.map((row) => (
              <AmountRow
                key={row.category.id}
                name={row.path}
                amount={row.amount === 0 ? '−' : formatYen(row.amount)}
                right={{ text: '/年', muted: true }}
                onPress={() => setEditingReserve(row.category)}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => setPickingReserve(true)}
              style={({ pressed }) => [styles.addRow, pressed && styles.pressed]}
            >
              <Plus size={16} color={colors.money} />
              <Text style={styles.addText}>追加する</Text>
            </Pressable>
          </SectionCard>

          <SectionCard
            title="固定費"
            dot={SECTION_DOTS.fixed}
            chip={{ text: formatYen(confirmedTotal + estimateTotal), tone: 'neutral' }}
            open={open.fixed}
            onToggle={() => toggle('fixed')}
          >
            <SubHeading title="確定" amount={formatYen(confirmedTotal)} />
            {confirmedRows.map(ruleRow)}
            {confirmedOccurrences.map(occurrenceRow)}
            <SubHeading title="見込み" amount={formatYen(estimateTotal)} />
            {estimateAutoRows.map(ruleRow)}
            {estimateOccurrences.map(occurrenceRow)}
          </SectionCard>
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
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
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
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 38, paddingRight: 18, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
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
