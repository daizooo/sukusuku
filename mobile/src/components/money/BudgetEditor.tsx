import { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type { MoneyBudget, MoneyBudgetLine, MoneyCategory } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import {
  budgetLineCount,
  budgetLineGroup,
  budgetLineShortLabel,
  budgetLineYearAmount,
  budgetMonths,
  categoryPath,
  formatYear,
  formatYen,
  iconKeyOf,
  manualBudgetFor,
  parseAmountInput,
  parsePeriodMonth,
  periodMonthInput,
  topCategories,
  topCategoryIdOf,
  yearMonthKeys,
  type BudgetLineGroup,
} from '@/lib/moneyUtils';
import { deleteMoneyBudgetLine, saveMoneyBudget, saveMoneyBudgetLine, type MoneyBudgetLineDraft } from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import CategoryPicker from '@/components/money/CategoryPicker';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field } from '@/components/money/feedParts';

// 年間予算（docs/kakei.md §0.7。2026-10-22）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// 予算は**年ごと**に決めるもの（来年の予算も、いつでも決められる）。上の年の送りで年を替える。
// 自動記録ルールとは別に持つ（ルールは記録を作るためだけ。ルールを変えても予算は変わらない）。
// どの予算も「単価 × その年に発生する回数」。回数は発生月（毎月・月を選ぶ・発生月なし）・◯年ごと・期間で決まる。
// - いちばん上は収支の予算の枠（BalanceCard。振り返りと同じ形）。収入・支出を切り替えて内訳の割合
// - 収入: 予算の明細（小分類ごと。開いたときは閉じておく）
// - 変動費: 大分類（予算の分け方が変動費）ごとの月の予算。押すと1月〜12月の月の予算を決める。決めていない年は前の年の12月の額を引き継ぐ
// - 予備費・固定費（確定・見込み）: 予算の明細。どの枠に入るかは、小分類の大分類の予算の分け方（カテゴリで決める）
// 行を押すと明細を直す。「＋ 追加する」で小分類を選んで明細を足す。どの枠も見出しを押すと折りたたむ。

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  /** 変動費の月の予算。 */
  budgets: MoneyBudget[];
  /** 収入・予備費・固定費の予算の明細。 */
  budgetLines: MoneyBudgetLine[];
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  onBudgetLines: (update: (prev: MoneyBudgetLine[]) => MoneyBudgetLine[]) => void;
  onClose: () => void;
}

/** 明細を足す枠。収入は収入のカテゴリ、ほかは大分類の予算の分け方が合うカテゴリから選ぶ。 */
type AddTarget = 'income' | 'reserve' | 'fixed';

interface LineEditing {
  line: MoneyBudgetLine | null;
  categoryId: string;
}

export default function BudgetEditor({
  familyId,
  year: initialYear,
  categories,
  budgets,
  budgetLines,
  onBudgets,
  onBudgetLines,
  onClose,
}: BudgetEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);
  const [editingLine, setEditingLine] = useState<LineEditing | null>(null);
  const [picking, setPicking] = useState<AddTarget | null>(null);

  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  // 変動費の大分類（予算の分け方が変動費）。
  const tops = useMemo(
    () => topCategories(categories, 'living', true).filter((top) => !top.archived && top.budgetGroup === 'variable'),
    [categories],
  );
  const rows = useMemo(
    () =>
      tops.map((top) => {
        const monthly = monthKeys.map((key) => manualBudgetFor(budgets, top.id, key) ?? 0);
        const total = monthly.reduce((sum, value) => sum + value, 0);
        return {
          top,
          total,
          even: monthly.every((value) => value === monthly[0]),
          average: Math.round(total / 12),
          // その年の手入力の予算を決めていない（前の年の12月の額を引き継いでいる）。
          inherited: !budgets.some((entry) => entry.categoryId === top.id && entry.year === year),
        };
      }),
    [tops, monthKeys, budgets, year],
  );
  const variableTotal = rows.reduce((sum, row) => sum + row.total, 0);

  // 予算の明細を、枠ごとに（カテゴリの並び → 明細の並び）。
  const lineRows = useMemo(() => {
    const order = new Map<string, number>();
    const sortKey = (categoryId: string) => {
      const category = categories.find((entry) => entry.id === categoryId);
      const top = categories.find((entry) => entry.id === topCategoryIdOf(categories, categoryId));
      return (top?.position ?? 0) * 10000 + (category && category.parentId !== null ? category.position : 0);
    };
    budgetLines.forEach((line, index) => order.set(line.id, index));
    const sorted = [...budgetLines].sort(
      (a, b) => sortKey(a.categoryId) - sortKey(b.categoryId) || a.position - b.position || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
    );
    const groups: Record<BudgetLineGroup, { line: MoneyBudgetLine; total: number }[]> = {
      income: [],
      variable: [],
      reserve: [],
      confirmed: [],
      estimate: [],
    };
    for (const line of sorted) groups[budgetLineGroup(line, categories)].push({ line, total: budgetLineYearAmount(line, year) });
    return groups;
  }, [budgetLines, categories, year]);
  const sum = (list: { total: number }[]) => list.reduce((total, row) => total + row.total, 0);
  const incomeTotal = sum(lineRows.income);
  const reserveTotal = sum(lineRows.reserve);
  const confirmedTotal = sum(lineRows.confirmed);
  const estimateTotal = sum(lineRows.estimate);
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

  const saveLine = async (target: LineEditing, draft: MoneyBudgetLineDraft) => {
    setEditingLine(null);
    try {
      const position = target.line?.position ?? budgetLines.reduce((max, line) => Math.max(max, line.position + 1), 0);
      const saved = await saveMoneyBudgetLine(supabase, familyId, target.line?.id ?? null, draft, position);
      onBudgetLines((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);
    } catch {
      failed();
    }
  };

  const removeLine = (line: MoneyBudgetLine) =>
    Alert.alert(`${categoryPath(categories, line.categoryId)}の予算を消しますか？`, 'すべての年から消えます。記録はそのまま残ります。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            setEditingLine(null);
            try {
              await deleteMoneyBudgetLine(supabase, line.id);
              onBudgetLines((prev) => prev.filter((entry) => entry.id !== line.id));
            } catch {
              failed();
            }
          })(),
      },
    ]);

  const expenseTotal = variableTotal + confirmedTotal + estimateTotal + reserveTotal;
  const plan = incomeTotal - expenseTotal;

  // 明細の行: 大分類のアイコン・小分類の名前（区別の名前があれば添える）、右に年の額と「単価 × 発生月」。
  const lineRow = (row: { line: MoneyBudgetLine; total: number }, first: boolean) => {
    const category = categories.find((entry) => entry.id === row.line.categoryId);
    const top = categories.find((entry) => entry.id === topCategoryIdOf(categories, row.line.categoryId));
    const name = category?.name ?? categoryPath(categories, row.line.categoryId);
    return (
      <Pressable
        key={row.line.id}
        accessibilityRole="button"
        onPress={() => setEditingLine({ line: row.line, categoryId: row.line.categoryId })}
        style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
      >
        {top ? <CategoryIcon iconKey={iconKeyOf(top)} size={28} /> : <View style={styles.iconSpace} />}
        <Text style={[styles.rowName, styles.flex, row.total === 0 && styles.faintName]} numberOfLines={1}>
          {row.line.name.trim() === '' ? name : `${name}（${row.line.name.trim()}）`}
        </Text>
        <View style={styles.right}>
          <Text style={[styles.rowAmount, row.total === 0 && styles.faintName]}>{formatYen(row.total)}</Text>
          <Text style={styles.note}>{budgetLineShortLabel(row.line)}</Text>
        </View>
        <ChevronRight size={16} color={colors.textFaint} />
      </Pressable>
    );
  };
  const sectionHeader = (title: string, total: number) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.flex} />
      <Text style={styles.sectionTotal}>{formatYen(total)}</Text>
    </View>
  );
  const groupHeader = (title: string, total: number, first: boolean) => (
    <View style={[styles.group, !first && styles.divided]}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.flex} />
      <Text style={styles.groupTotal}>{formatYen(total)}</Text>
    </View>
  );
  const addRow = (target: AddTarget, first: boolean) => (
    <Pressable
      accessibilityRole="button"
      onPress={() => setPicking(target)}
      style={({ pressed }) => [styles.row, !first && styles.divided, pressed && styles.pressed]}
    >
      <Plus size={16} color={colors.money} />
      <Text style={styles.addText}>追加する</Text>
    </Pressable>
  );

  if (picking !== null) {
    const onlyTops =
      picking === 'income'
        ? undefined
        : (top: MoneyCategory) => (picking === 'reserve' ? top.budgetGroup === 'reserve' : top.budgetGroup === 'fixed' || top.budgetGroup === 'estimate');
    return (
      <Modal visible animationType="slide" onRequestClose={() => setPicking(null)}>
        <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
          <CategoryPicker
            kind={picking === 'income' ? 'income' : 'expense'}
            categories={categories}
            onlyTops={onlyTops}
            onPick={(choice) => {
              setPicking(null);
              setEditingLine({ line: null, categoryId: choice.categoryId });
            }}
            onClose={() => setPicking(null)}
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
              { label: '変動費', value: variableTotal, sub: false },
              { label: '固定費', value: confirmedTotal + estimateTotal, sub: false },
              { label: '確定', value: confirmedTotal, sub: true },
              { label: '見込み', value: estimateTotal, sub: true },
              { label: '予備費', value: reserveTotal, sub: false },
            ].map((part) => (
              <View key={part.label} style={[styles.partRow, part.sub && styles.partRowSub]}>
                <Text style={[styles.partLabel, part.sub && styles.partSub]}>{part.label}</Text>
                <Text style={[styles.partValue, part.sub && styles.partSub]}>{formatYen(part.value)}</Text>
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
          <View style={styles.card}>
            {lineRows.income.map((row, index) => lineRow(row, index === 0))}
            {addRow('income', lineRows.income.length === 0)}
          </View>

          {sectionHeader('変動費', variableTotal)}
          {rows.length === 0 ? (
            <Text style={styles.message}>変動費の大分類がありません。「カテゴリ」で大分類の予算の分け方を決めてください</Text>
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
                    {row.total > 0 && <Text style={styles.note}>{row.even ? `月 ${formatYen(row.average)}` : `月 約${formatYen(row.average)}`}</Text>}
                  </View>
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>
          )}

          {sectionHeader('固定費', confirmedTotal + estimateTotal)}
          <View style={styles.card}>
            {groupHeader('確定', confirmedTotal, true)}
            {lineRows.confirmed.map((row) => lineRow(row, false))}
            {groupHeader('見込み', estimateTotal, false)}
            {lineRows.estimate.map((row) => lineRow(row, false))}
            {addRow('fixed', false)}
          </View>

          {sectionHeader('予備費', reserveTotal)}
          <View style={styles.card}>
            {lineRows.reserve.map((row, index) => lineRow(row, index === 0))}
            {addRow('reserve', lineRows.reserve.length === 0)}
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
        {editingLine !== null && (
          <BudgetLineSheet
            key={editingLine.line?.id ?? `new-${editingLine.categoryId}`}
            title={categoryPath(categories, editingLine.categoryId)}
            categoryId={editingLine.categoryId}
            line={editingLine.line}
            year={year}
            onClose={() => setEditingLine(null)}
            onSubmit={(draft) => void saveLine(editingLine, draft)}
            onRemove={editingLine.line ? () => removeLine(editingLine.line as MoneyBudgetLine) : undefined}
          />
        )}
      </View>
    </Modal>
  );
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** 予算の明細を足す・直す。単価・発生月（毎月・月を選ぶ・発生月なし）・◯年ごと・期間。 */
function BudgetLineSheet({
  title,
  categoryId,
  line,
  year,
  onClose,
  onSubmit,
  onRemove,
}: {
  title: string;
  categoryId: string;
  line: MoneyBudgetLine | null;
  year: number;
  onClose: () => void;
  onSubmit: (draft: MoneyBudgetLineDraft) => void;
  onRemove?: () => void;
}) {
  const [name, setName] = useState(line?.name ?? '');
  const [amountText, setAmountText] = useState(line ? String(line.amount) : '');
  const [mode, setMode] = useState<'monthly' | 'months' | 'none'>(line?.noMonth ? 'none' : line?.months ? 'months' : 'monthly');
  const [months, setMonths] = useState<number[]>(line?.months ?? []);
  const [byInterval, setByInterval] = useState(line?.intervalYears != null);
  const [intervalText, setIntervalText] = useState(line?.intervalYears != null ? String(line.intervalYears) : '2');
  const [startText, setStartText] = useState(periodMonthInput(line?.startMonth ?? null));
  const [endText, setEndText] = useState(periodMonthInput(line?.endMonth ?? null));
  const [error, setError] = useState<string | null>(null);

  const toggleMonth = (month: number) =>
    setMonths((prev) => (prev.includes(month) ? prev.filter((value) => value !== month) : [...prev, month].sort((a, b) => a - b)));

  const build = (): MoneyBudgetLineDraft | string => {
    const amount = parseAmountInput(amountText);
    if (amountText.trim() === '' || amount === null) return '単価は0以上の整数（円）で入れてください';
    if (mode === 'months' && months.length === 0) return '発生する月を選んでください';
    const startMonth = parsePeriodMonth(startText);
    const endMonth = parsePeriodMonth(endText);
    if (startMonth === undefined || endMonth === undefined) return '期間は「2027/9」の形で入れてください（無期限は空）';
    if (startMonth !== null && endMonth !== null && startMonth > endMonth) return '期間の終わりを始まりより後にしてください';
    const intervalYears = byInterval ? Number(intervalText.trim()) : null;
    if (intervalYears !== null) {
      if (!Number.isInteger(intervalYears) || intervalYears < 2 || intervalYears > 10) return '何年ごとかを 2〜10 で入れてください';
      if (startMonth === null) return '◯年ごとは、期間の始まり（最初の回の月）を入れてください';
    }
    return {
      categoryId,
      name,
      amount,
      months: mode === 'months' ? months : null,
      noMonth: mode === 'none',
      intervalYears,
      startMonth,
      endMonth,
    };
  };
  const draft = build();
  const preview =
    typeof draft === 'string'
      ? null
      : (() => {
          const sample: MoneyBudgetLine = { ...draft, id: '', position: 0 };
          return `${formatYear(year)}は ${budgetLineCount(sample, year)}回・${formatYen(budgetLineYearAmount(sample, year))}`;
        })();

  const submit = () => {
    const result = build();
    if (typeof result === 'string') return setError(result);
    onSubmit(result);
  };

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={line ? '予算を直す' : '予算を足す'}
        onClose={onClose}
        footer={
          <>
            <PrimaryButton label="保存する" onPress={submit} />
            {onRemove && (
              <Pressable accessibilityRole="button" onPress={onRemove} style={styles.removeButton}>
                <Text style={styles.removeText}>この予算を消す</Text>
              </Pressable>
            )}
          </>
        }
      >
        <Text style={styles.reserveTitle}>{title}</Text>
        <Field label="単価（1回の額）">
          <TextInput
            style={styles.input}
            value={amountText}
            onChangeText={setAmountText}
            keyboardType="number-pad"
            placeholder="額（円）"
            placeholderTextColor={colors.textFaint}
          />
        </Field>
        <Field label="発生月">
          <ChipRow>
            <Chip label="毎月" selected={mode === 'monthly'} onPress={() => setMode('monthly')} />
            <Chip label="月を選ぶ" selected={mode === 'months'} onPress={() => setMode('months')} />
            <Chip label="発生月なし" selected={mode === 'none'} onPress={() => setMode('none')} />
          </ChipRow>
          {mode === 'months' && (
            <ChipRow>
              {MONTHS.map((month) => (
                <Chip key={month} label={`${month}月`} selected={months.includes(month)} onPress={() => toggleMonth(month)} />
              ))}
            </ChipRow>
          )}
        </Field>
        <Field label="頻度">
          <ChipRow>
            <Chip label="毎年" selected={!byInterval} onPress={() => setByInterval(false)} />
            <Chip label="◯年ごと" selected={byInterval} onPress={() => setByInterval(true)} />
          </ChipRow>
          {byInterval && (
            <View style={styles.periodRow}>
              <TextInput
                style={[styles.input, styles.intervalInput]}
                value={intervalText}
                onChangeText={setIntervalText}
                keyboardType="number-pad"
                placeholder="2"
                placeholderTextColor={colors.textFaint}
              />
              <Text style={styles.periodText}>年ごと（期間の始まりの年から数える）</Text>
            </View>
          )}
        </Field>
        <Field label="期間（空なら無期限）">
          <View style={styles.periodRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={startText}
              onChangeText={setStartText}
              placeholder="始まり 例: 2027/9"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.periodText}>〜</Text>
            <TextInput
              style={[styles.input, styles.flex]}
              value={endText}
              onChangeText={setEndText}
              placeholder="終わり 例: 2033/3"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </Field>
        <Field label="名前（区別したいときだけ。例: 時短）">
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="任意"
            placeholderTextColor={colors.textFaint}
          />
        </Field>
        {preview && <Text style={styles.preview}>{preview}</Text>}
        {error && <Text style={styles.error}>{error}</Text>}
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
  addText: { fontSize: 16, fontWeight: '700', color: colors.money },
  faintName: { color: colors.textFaint },
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
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  periodText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  intervalInput: { width: 64, textAlign: 'right' },
  preview: { fontSize: 13, fontWeight: '700', color: colors.textSubtle },
});
