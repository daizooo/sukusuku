import { useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyReserve } from '@/types/app';
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
  monthKeyOfDate,
  monthsLabel,
  parseAmountInput,
  recurringInYear,
  recurringPeriodLabel,
  reserveAmountFor,
  topCategories,
  yearMonthKeys,
  type EstimateCostOccurrence,
  type RecurringYearRow,
} from '@/lib/moneyUtils';
import { toDateString } from '@/lib/dateUtils';
import { saveMoneyBudget, saveMoneyReserve, setMoneyCategoryReserve, updateMoneyRecurringSkipped } from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import CategoryPicker from '@/components/money/CategoryPicker';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 予算（docs/kakei.md §3.1・§3.5・§3.6・§3.7）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// カテゴリ（CategoryEditor）とは別の設定にした（2026-10-15）。カテゴリは名前・並び・アイコンで年に関係なく、
// 予算は**年ごと**に決めるもの（来年の予算も、いつでも決められる）。上の年の送りで年を替える。
//
// 支出の予算は「変動費・固定費・予備費」の3つ（2026-10-18）。
// - 変動費: 大分類ごとの手入力の月額。押すと1月〜12月の月の予算を決める。決めていない年は前の年の12月の額を引き継ぐ
// - 固定費: 固定支出のルール。「確定」（額が固定額のもの）と「予定」（額が変わるもの。電気のように自動で記録して額を見込むものと、
//   車検・ふるさと納税のように記録を作らないもの）に分け、それぞれ折りたためる。記録を作らない回は月の順に並べ、実績があれば「済」。
//   押すと「今年はなし」にできる。足す・直すのは「固定支出」
// - 予備費: 年の額と、紐づけた小分類（この小分類の記録は予備費の予算で数える）。見出しを押すと額を決め、枠の中で小分類を紐づける・外す
// 上の枠は、収入・支出（内訳つき）・収支見込み。その下に、収入（固定収入）の一覧。固定費と収入の行は、カテゴリを大きく、品名を下に（お店は出さない）。
// 押すと、そのルールの「固定支出」「固定収入」の編集が開く。

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  /** 手入力の予算と、固定費から出した予算（fixed: true）。 */
  budgets: MoneyBudget[];
  recurring: MoneyRecurring[];
  records: MoneyRecord[];
  /** 予備費の年の額（docs/kakei.md §3.7）。 */
  reserves: MoneyReserve[];
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  /** 記録を作らない固定支出の「今年はなし」を直したあと。 */
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onReserves: (update: (prev: MoneyReserve[]) => MoneyReserve[]) => void;
  /** 予備費に小分類を紐づけた・外したあと。 */
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  /** 固定費の行から、そのルールの「固定支出」の編集を開く。 */
  onOpenRecurring?: (id: string) => void;
  onClose: () => void;
}

/** 「3月」。 */
const monthLabel = (monthKey: string) => `${Number(monthKey.slice(5, 7))}月`;

/** 記録する月と1回の額（「毎月 ¥98,000」「奇数月 ¥10,000」）と期間。額が回ごとに違うものは平均（「約¥14,000」）。 */
function scheduleText(row: RecurringYearRow): string {
  const { rule } = row;
  const months = rule.months === null ? '毎月' : monthsLabel(rule.months);
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

/** 固定のルールの見出し。品名、無ければお店、無ければカテゴリ。 */
function ruleTitle(rule: MoneyRecurring, categories: MoneyCategory[]): string {
  const name = rule.name.trim() || rule.store.trim();
  return name !== '' ? name : categoryPath(categories, rule.categoryId) || '支出';
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
  onCategories,
  onOpenRecurring,
  onClose,
}: BudgetEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);
  const [editingReserve, setEditingReserve] = useState(false);
  const [pickingReserve, setPickingReserve] = useState(false);
  // 固定費の「確定」「予定」と、予備費の小分類の開閉。
  const [open, setOpen] = useState({ confirmed: false, planned: true, reserve: true });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const tops = useMemo(
    () => topCategories(categories, 'living', true).filter((top) => !top.archived),
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
          // 月の額。月ごとに違えば平均（「約」）。
          monthly: monthly.every((value) => value === monthly[0])
            ? `月 ${formatYen(monthly[0])}`
            : `月 約${formatYen(Math.round(total / 12))}`,
          even: monthly.every((value) => value === monthly[0]),
          average: Math.round(total / 12),
          // その年の手入力の予算を決めていない（前の年の12月の額を引き継いでいる）。
          inherited: !budgets.some((entry) => !entry.fixed && entry.categoryId === top.id && entry.year === year),
        };
      }),
    [tops, monthKeys, budgets, year],
  );
  const today = toDateString(new Date());
  const occurrences = useMemo(() => estimateCostsInYear(recurring, records, year, today), [recurring, records, year, today]);
  const fixedRows = useMemo(() => recurringInYear(recurring, records, year), [recurring, records, year]);
  const incomeRows = fixedRows.filter((row) => row.rule.kind === 'income');
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.total, 0);
  const outgoRows = fixedRows.filter((row) => row.rule.kind === 'expense');
  const confirmedRows = outgoRows.filter((row) => row.rule.amountMode === 'fixed');
  const plannedRows = outgoRows.filter((row) => row.rule.amountMode !== 'fixed');
  const counted = occurrences.filter((entry) => entry.status !== 'skipped');
  const variableTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const confirmedTotal = confirmedRows.reduce((sum, row) => sum + row.total, 0);
  const plannedTotal =
    plannedRows.reduce((sum, row) => sum + row.total, 0) + counted.reduce((sum, entry) => sum + entry.amount, 0);
  const reserveAmount = reserveAmountFor(reserves, year);
  const reserveLinked = categories.filter((category) => category.reserve && !category.archived);
  const expenseTotal = variableTotal + confirmedTotal + plannedTotal + reserveAmount;
  const plan = incomeTotal - expenseTotal;

  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');

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

  // 記録しない回: 「今年はなし」（戻す）か、固定支出の編集へ。
  const openOccurrence = (entry: EstimateCostOccurrence) => {
    const title = `${ruleTitle(entry.rule, categories)}（${monthLabel(entry.plannedMonth)}）`;
    const open = onOpenRecurring ? [{ text: '固定支出を開く', onPress: () => onOpenRecurring(entry.rule.id) }] : [];
    if (entry.status === 'done') {
      return Alert.alert(title, `予定 ${formatYen(entry.amount)}・実績 ${formatYen(entry.actual)}`, [
        { text: '閉じる', style: 'cancel' },
        ...open,
      ]);
    }
    Alert.alert(title, undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: entry.status === 'skipped' ? '今年の予算に戻す' : '今年はなし', onPress: () => void toggleSkip(entry) },
      ...open,
    ]);
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
      failed();
    }
  };

  const saveReserve = async (amount: number) => {
    setEditingReserve(false);
    try {
      const saved = await saveMoneyReserve(supabase, familyId, year, amount);
      onReserves((prev) => [...prev.filter((entry) => entry.year !== saved.year), saved]);
    } catch {
      failed();
    }
  };

  const setReserveLink = async (categoryId: string, value: boolean) => {
    setPickingReserve(false);
    try {
      const saved = await setMoneyCategoryReserve(supabase, categoryId, value);
      onCategories((prev) => prev.map((category) => (category.id === saved.id ? saved : category)));
    } catch {
      failed();
    }
  };

  const unlink = (category: MoneyCategory) =>
    Alert.alert(`${categoryPath(categories, category.id)}を予備費から外しますか？`, undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: '外す', style: 'destructive', onPress: () => void setReserveLink(category.id, false) },
    ]);

  const groupHeader = (key: keyof typeof open, title: string, total: number | null, first: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ expanded: open[key] }}
      onPress={() => toggle(key)}
      style={[styles.group, !first && styles.divided]}
    >
      {open[key] ? <ChevronDown size={16} color={colors.textFaint} /> : <ChevronRight size={16} color={colors.textFaint} />}
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.flex} />
      {total !== null && <Text style={styles.groupTotal}>{formatYen(total)}</Text>}
    </Pressable>
  );

  // 固定費の行の、カテゴリのアイコン（大分類）と、名前の下に出すカテゴリ（「住居費 › 家賃・ローン」）。
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
  const ruleName = (rule: MoneyRecurring, badge?: boolean, skipped?: boolean) => {
    const name = rule.name.trim();
    const { path: category } = categoryOf(rule);
    const title = category || name || (rule.kind === 'income' ? '収入' : '支出');
    const path = category !== '' ? name : '';
    return (
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={[styles.rowName, styles.shrink, skipped && styles.skipped]} numberOfLines={1}>
            {title}
          </Text>
          {badge && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>済</Text>
            </View>
          )}
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
        <Text style={styles.rowAmount}>{formatYen(row.total)}</Text>
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
            monthKey={monthKeyOfDate(new Date())}
            categories={categories}
            budgets={budgets}
            records={records}
            onPick={(choice) => void setReserveLink(choice.categoryId, true)}
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
              { label: '変動費', value: variableTotal, sub: false },
              { label: '固定費', value: confirmedTotal + plannedTotal, sub: false },
              { label: '確定', value: confirmedTotal, sub: true },
              { label: '予定', value: plannedTotal, sub: true },
              { label: '予備費', value: reserveAmount, sub: false },
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
          {incomeRows.length === 0 ? (
            <Text style={styles.message}>この年の固定収入はありません</Text>
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

          {sectionHeader('固定費', confirmedTotal + plannedTotal)}
          <View style={styles.card}>
            {groupHeader('confirmed', '確定', confirmedTotal, true)}
            {open.confirmed && confirmedRows.map((row) => fixedRow(row))}
            {groupHeader('planned', '予定', plannedTotal, false)}
            {open.planned && plannedRows.map((row) => fixedRow(row))}
            {open.planned &&
              occurrences.map((entry) => (
                <Pressable
                  key={`${entry.rule.id}-${entry.plannedMonth}`}
                  accessibilityRole="button"
                  onPress={() => openOccurrence(entry)}
                  style={({ pressed }) => [styles.row, styles.divided, pressed && styles.pressed]}
                >
                  {ruleIcon(entry.rule)}
                  {ruleName(entry.rule, entry.status === 'done', entry.status === 'skipped')}
                  <View style={styles.right}>
                    <Text style={[styles.rowAmount, entry.status === 'skipped' && styles.skipped]}>{formatYen(entry.amount)}</Text>
                    <Text style={styles.note}>{monthLabel(entry.actualMonth ?? entry.plannedMonth)}</Text>
                  </View>
                </Pressable>
              ))}
          </View>

          {sectionHeader('予備費', reserveAmount, () => setEditingReserve(true))}
          <View style={styles.card}>
            {groupHeader('reserve', '小分類', null, true)}
            {open.reserve &&
              reserveLinked.map((category) => (
                <Pressable
                  key={category.id}
                  accessibilityRole="button"
                  onPress={() => unlink(category)}
                  style={({ pressed }) => [styles.row, styles.divided, pressed && styles.pressed]}
                >
                  <Text style={[styles.rowName, styles.flex]} numberOfLines={1}>
                    {categoryPath(categories, category.id)}
                  </Text>
                  <ChevronRight size={16} color={colors.textFaint} />
                </Pressable>
              ))}
            {open.reserve && (
              <Pressable
                accessibilityRole="button"
                onPress={() => setPickingReserve(true)}
                style={({ pressed }) => [styles.row, styles.divided, pressed && styles.pressed]}
              >
                <Plus size={16} color={colors.money} />
                <Text style={styles.addText}>追加する</Text>
              </Pressable>
            )}
          </View>
        </ScrollView>

        {editing !== null && (
          <BudgetSheet
            key={`${editing.id}-${year}`}
            category={editing}
            year={year}
            monthAmounts={budgetMonths(budgets, editing.id, year)}
            previousAmounts={budgetMonths(budgets, editing.id, year - 1)}
            fixed={monthKeys.map((key) => fixedBudgetFor(budgets, editing.id, key) + estimateBudgetFor(budgets, editing.id, key))}
            onClose={() => setEditing(null)}
            onSubmit={(amounts) => void save(editing, amounts)}
          />
        )}
        {editingReserve && (
          <ReserveSheet
            year={year}
            amount={reserveAmount}
            onClose={() => setEditingReserve(false)}
            onSubmit={(amount) => void saveReserve(amount)}
          />
        )}
      </View>
    </Modal>
  );
}

/** 予備費の年の額。 */
function ReserveSheet({
  year,
  amount,
  onClose,
  onSubmit,
}: {
  year: number;
  amount: number;
  onClose: () => void;
  onSubmit: (amount: number) => void;
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
      <LogModalShell title={`予備費（${formatYear(year)}）`} onClose={onClose} footer={<PrimaryButton label="保存する" onPress={submit} />}>
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
  fixed,
  onClose,
  onSubmit,
}: {
  category: MoneyCategory;
  year: number;
  monthAmounts: (number | null)[];
  previousAmounts: (number | null)[];
  /** その月に足される固定費（確定と予定）。 */
  fixed: number[];
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
            const total = (manual ?? 0) + fixed[index];
            const added = fixed[index] > 0 ? `＋固定費 ${formatYen(fixed[index])}` : '';
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
});
