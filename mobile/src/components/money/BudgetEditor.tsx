import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type {
  MoneyBudgetGroup,
  MoneyCategory,
  MoneyHolidayRule,
  MoneyRecord,
  MoneyRecurring,
  MoneyRecurringDraft,
  MoneyStore,
  MoneyWallet,
} from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';
import { toDateString, WEEKDAY_LABELS } from '@/lib/dateUtils';
import {
  amountModeOfGroup,
  budgetLineCount,
  budgetLineOf,
  budgetLineYearAmount,
  budgetRowNote,
  childCategories,
  formatYear,
  formatYen,
  guessIconKey,
  HOLIDAY_RULE_LABEL,
  iconKeyOf,
  isBudgetRow,
  manualBudgetFor,
  monthsLabel,
  parseAmountInput,
  parsePeriodMonth,
  periodMonthInput,
  recurringDayLabel,
  recurringPeriodLabel,
  spendGroupOf,
  storeChoices,
  topCategories,
  topCategoryIdOf,
  variableBudgetsOf,
  WEEK_OF_MONTH_OPTIONS,
  yearMonthKeys,
  type BudgetLineGroup,
  type SpendGroup,
} from '@/lib/moneyUtils';
import {
  deleteMoneyRecurring,
  insertMoneyCategory,
  insertMoneyRecurring,
  insertMoneyStore,
  setMoneyRecurringArchived,
  updateMoneyCategory,
  updateMoneyRecurring,
} from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import CategoryPicker from '@/components/money/CategoryPicker';
import StorePicker from '@/components/money/StorePicker';
import { CategoryIcon, PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field, WalletChoices } from '@/components/money/feedParts';

// 年間予算（docs/kakei.md §0.8。2026-10-23）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// 予算が本体。予算1件＝自動記録ルールの表（money_recurring）の1行で、「単価 × その年に発生する回数」。自動記録はその行のオン／オフで、
// オンにすると日・休日・出金元・お店を決める（サーバーがその日に記録を作る）。オフは記録なし。カテゴリ・予算・自動記録をここで全部決める。
// 種類は5つ（収入・変動費・固定費〔確定〕・固定費〔見込み〕・予備費）。支出の種類は大分類の予算の分け方で決まる（小分類の種類を変えると、
// その種類の大分類へ移る）。自動記録の確定／見込みも種類で決まる（固定費〔見込み〕・変動費は見込み）。収入だけは行ごとに決める。
// - 一覧: 上の年の送りで年を替える。収入／支出の切り替え。支出は種類ごとにまとめ、名前の下に「毎月 · 自動 27日」のように記録の仕方を出す
// - 小分類の画面: 題を押すと名前を直す。題の横の札を押すと種類を変える。予算が1件なら、その1枚で全部決まる。何件もあれば一覧で、押すと1件の画面
// - 変動費の大分類の画面: 大分類まとめての月の予算と、小分類（それぞれ予算を持てる）。月の予算は、まとめての予算 ＋ 小分類の予算
// 見出し・切り替えは固定し、スクロールは中身だけ。戻る操作は1つ前の画面へ。

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onClose: () => void;
}

/** 種類の名前。 */
const GROUP_LABEL: Record<BudgetLineGroup, string> = {
  income: '収入',
  variable: '変動費',
  confirmed: '固定費（確定）',
  estimate: '固定費（見込み）',
  reserve: '予備費',
};

/** 種類の札の色。 */
const GROUP_TONE: Record<BudgetLineGroup, { text: string; surface: string }> = {
  income: { text: colors.labelGakuText, surface: colors.labelGakuSurface },
  variable: { text: colors.moneyText, surface: colors.moneySoft },
  confirmed: { text: colors.quickContactIcon, surface: colors.quickContactSurface },
  estimate: { text: colors.moneyEstimate, surface: colors.moneyEstimateSurface },
  reserve: { text: colors.labelIzumiText, surface: colors.labelIzumiSurface },
};

/** 支出の種類の、選ぶ画面での添え書き。 */
const GROUP_NOTE: Record<SpendGroup, string> = {
  variable: '月の予算で見る',
  confirmed: '額が決まっている',
  estimate: '額が変わる',
  reserve: '年の残りで見る',
};

const SPEND_GROUPS: SpendGroup[] = ['variable', 'confirmed', 'estimate', 'reserve'];

/** 支出の種類 → 大分類の予算の分け方。 */
const budgetGroupOf = (group: SpendGroup): MoneyBudgetGroup => (group === 'confirmed' ? 'fixed' : group);

/** 新しく大分類を作るときの名前（その種類の大分類が1つも無いとき）。 */
const NEW_TOP_NAME: Record<Exclude<SpendGroup, 'variable'>, string> = {
  confirmed: '固定費',
  estimate: '固定費（見込み）',
  reserve: '予備費',
};

type Screen =
  | { type: 'list' }
  | { type: 'category'; categoryId: string }
  | { type: 'top'; topId: string }
  | { type: 'row'; ruleId: string | null; categoryId: string | null };

type Sheet =
  | { type: 'rename'; categoryId: string }
  | { type: 'group'; categoryId: string }
  | { type: 'add'; group: BudgetLineGroup | 'child'; parentId?: string }
  | null;

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

/** 行の、保存の形（id などを外したもの）。 */
const draftOf = (rule: MoneyRecurring): MoneyRecurringDraft => ({
  kind: rule.kind,
  day: rule.day,
  weekOfMonth: rule.weekOfMonth,
  weekday: rule.weekday,
  months: rule.months,
  startMonth: rule.startMonth,
  endMonth: rule.endMonth,
  holiday: rule.holiday,
  amountMode: rule.amountMode,
  amount: rule.amount,
  walletId: rule.walletId,
  toWalletId: rule.toWalletId,
  store: rule.store,
  categoryId: rule.categoryId,
  name: rule.name,
  makesRecord: rule.makesRecord,
  skippedMonths: rule.skippedMonths,
  intervalYears: rule.intervalYears,
  dayKnown: rule.dayKnown,
  noMonth: rule.noMonth,
});

export default function BudgetEditor({
  familyId,
  year: initialYear,
  categories,
  recurring,
  wallets,
  stores,
  records,
  onCategories,
  onRecurring,
  onStores,
  onClose,
}: BudgetEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [tab, setTab] = useState<'expense' | 'income'>('expense');
  const [stack, setStack] = useState<Screen[]>([{ type: 'list' }]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const screen = stack[stack.length - 1];
  const push = (next: Screen) => setStack((prev) => [...prev, next]);
  const pop = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  const rows = useMemo(() => recurring.filter(isBudgetRow).sort(byPosition), [recurring]);
  const rowsOf = (categoryId: string) => rows.filter((rule) => rule.categoryId === categoryId);
  const yearTotal = (rule: MoneyRecurring) => budgetLineYearAmount(budgetLineOf(rule), year);
  const sumOf = (list: readonly MoneyRecurring[]) => list.reduce((sum, rule) => sum + yearTotal(rule), 0);
  const variableBudgets = useMemo(() => variableBudgetsOf(recurring, categories), [recurring, categories]);
  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const groupOf = (categoryId: string): BudgetLineGroup =>
    categories.find((entry) => entry.id === categoryId)?.kind === 'income' ? 'income' : spendGroupOf(categoryId, categories);
  const category = (id: string | null) => categories.find((entry) => entry.id === id) ?? null;
  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');

  // 変動費の大分類（月の予算の1月〜12月）。
  const variableTops = useMemo(
    () =>
      topCategories(categories, 'living').filter((top) => top.budgetGroup === 'variable').map((top) => {
        const monthly = monthKeys.map((key) => manualBudgetFor(variableBudgets, top.id, key) ?? 0);
        const total = monthly.reduce((sum, value) => sum + value, 0);
        return { top, monthly, total };
      }),
    [categories, monthKeys, variableBudgets],
  );
  // 予算のある小分類（種類ごと。カテゴリの並び）。
  const groupEntries = (group: BudgetLineGroup) => {
    const tops = group === 'income' ? topCategories(categories, 'income') : topCategories(categories, 'living').filter((top) => spendGroupOf(top.id, categories) === group);
    const list: { category: MoneyCategory; rules: MoneyRecurring[]; total: number }[] = [];
    for (const top of tops) {
      for (const entry of [top, ...childCategories(categories, top.id)]) {
        const own = rowsOf(entry.id);
        if (own.length > 0) list.push({ category: entry, rules: own, total: sumOf(own) });
      }
    }
    return list;
  };
  // カテゴリの無い行（古いルール。押してカテゴリを決める）。
  const orphans = recurring.filter((rule) => !rule.archived && rule.kind !== 'transfer' && rule.categoryId === null).sort(byPosition);

  const incomeEntries = groupEntries('income');
  const totals = {
    income: incomeEntries.reduce((sum, entry) => sum + entry.total, 0),
    variable: variableTops.reduce((sum, entry) => sum + entry.total, 0),
    confirmed: groupEntries('confirmed').reduce((sum, entry) => sum + entry.total, 0),
    estimate: groupEntries('estimate').reduce((sum, entry) => sum + entry.total, 0),
    reserve: groupEntries('reserve').reduce((sum, entry) => sum + entry.total, 0),
  };
  const expenseTotal = totals.variable + totals.confirmed + totals.estimate + totals.reserve;
  const plan = totals.income - expenseTotal;

  // ---- 保存 ----

  const putRule = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));
  const putCategory = (saved: MoneyCategory) => onCategories((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);

  const saveRule = async (target: MoneyRecurring | null, draft: MoneyRecurringDraft, registerStore: boolean): Promise<boolean> => {
    try {
      const saved =
        target === null
          ? await insertMoneyRecurring(supabase, familyId, draft, recurring.reduce((max, rule) => Math.max(max, rule.position + 1), 0))
          : await updateMoneyRecurring(supabase, target.id, draft);
      putRule(saved);
      // 「お店に登録して使う」を選んだお店は、お店の設定にも登録する（docs/kakei.md §3.5）。
      if (registerStore && draft.store !== '' && !stores.some((entry) => entry.name === draft.store && !entry.archived)) {
        const savedStore = await insertMoneyStore(supabase, familyId, draft.store);
        onStores((prev) => [...prev.filter((entry) => entry.id !== savedStore.id), savedStore]);
      }
      return true;
    } catch {
      failed();
      return false;
    }
  };

  const removeRule = (rule: MoneyRecurring, after: () => void) =>
    Alert.alert('この予算を消しますか？', 'すべての年から消えます。自動で作った記録はそのまま残ります。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '消す',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              await deleteMoneyRecurring(supabase, rule.id);
              onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
              after();
            } catch {
              failed();
            }
          })(),
      },
    ]);

  /** 種類が変わった行の、自動記録の確定／見込みを直す（支出だけ）。 */
  const followGroup = async (categoryIds: readonly string[], group: SpendGroup) => {
    const mode = amountModeOfGroup(group);
    for (const rule of rows.filter((entry) => entry.kind === 'expense' && categoryIds.includes(entry.categoryId as string))) {
      if (rule.amountMode !== mode) putRule(await updateMoneyRecurring(supabase, rule.id, { ...draftOf(rule), amountMode: mode }));
    }
  };

  /** 小分類をその種類の大分類へ移す（変動費は大分類を選ぶ）。大分類なら、大分類の種類を変える。 */
  const changeGroup = async (target: MoneyCategory, group: SpendGroup, variableTopId?: string) => {
    setSheet(null);
    try {
      if (target.parentId === null) {
        putCategory(await updateMoneyCategory(supabase, target.id, { budgetGroup: budgetGroupOf(group) }));
        await followGroup([target.id, ...childCategories(categories, target.id, true).map((entry) => entry.id)], group);
        return;
      }
      let topId = variableTopId ?? null;
      if (topId === null) {
        const found = topCategories(categories, 'living').find((top) => spendGroupOf(top.id, categories) === group);
        if (found) topId = found.id;
        else {
          const name = NEW_TOP_NAME[group as Exclude<SpendGroup, 'variable'>];
          let top = await insertMoneyCategory(supabase, familyId, {
            kind: 'living',
            parentId: null,
            name,
            icon: guessIconKey(name),
            position: topCategories(categories, 'living', true).reduce((max, entry) => Math.max(max, entry.position + 1), 0),
          });
          top = await updateMoneyCategory(supabase, top.id, { budgetGroup: budgetGroupOf(group) });
          putCategory(top);
          topId = top.id;
        }
      }
      const position = childCategories(categories, topId, true).reduce((max, entry) => Math.max(max, entry.position + 1), 0);
      putCategory(await updateMoneyCategory(supabase, target.id, { parentId: topId, position }));
      await followGroup([target.id], group);
    } catch {
      failed();
    }
  };

  const rename = async (target: MoneyCategory, name: string) => {
    setSheet(null);
    if (name.trim() === '' || name.trim() === target.name) return;
    try {
      putCategory(await updateMoneyCategory(supabase, target.id, { name }));
    } catch {
      failed();
    }
  };

  /** 小分類（大分類）を作って開く。 */
  const createCategory = async (kind: MoneyCategory['kind'], parentId: string | null, name: string, group?: SpendGroup) => {
    setSheet(null);
    try {
      const siblings = parentId === null ? topCategories(categories, kind, true) : childCategories(categories, parentId, true);
      let created = await insertMoneyCategory(supabase, familyId, {
        kind,
        parentId,
        name,
        icon: parentId === null ? guessIconKey(name) : null,
        position: siblings.reduce((max, entry) => Math.max(max, entry.position + 1), 0),
      });
      if (parentId === null && group !== undefined && group !== 'variable') {
        created = await updateMoneyCategory(supabase, created.id, { budgetGroup: budgetGroupOf(group) });
      }
      onCategories((prev) => [...prev, created]);
      push(parentId === null && group === 'variable' ? { type: 'top', topId: created.id } : { type: 'category', categoryId: created.id });
    } catch {
      failed();
    }
  };

  /** 小分類を使わなくする（その予算も使わなくする。記録は残る）。 */
  const archiveCategory = (target: MoneyCategory) =>
    Alert.alert(`${target.name}を使わなくしますか？`, '予算と自動記録も止まります。記録はそのまま残ります。', [
      { text: 'やめる', style: 'cancel' },
      {
        text: '使わない',
        style: 'destructive',
        onPress: () =>
          void (async () => {
            try {
              putCategory(await updateMoneyCategory(supabase, target.id, { archived: true }));
              for (const rule of rowsOf(target.id)) putRule(await setMoneyRecurringArchived(supabase, rule.id, true));
              pop();
            } catch {
              failed();
            }
          })(),
      },
    ]);

  // ---- 戻る ----

  const onRequestClose = () => {
    if (sheet !== null) return setSheet(null);
    if (stack.length > 1) return pop();
    onClose();
  };

  // ---- 画面 ----

  const header = (target: MoneyCategory) => (
    <TitleBar
      title={target.name}
      group={groupOf(target.id)}
      onBack={pop}
      onRename={() => setSheet({ type: 'rename', categoryId: target.id })}
      onGroup={target.kind === 'income' ? undefined : () => setSheet({ type: 'group', categoryId: target.id })}
    />
  );

  const rowEditor = (rule: MoneyRecurring | null, categoryId: string | null, title: ReactNode, extra: ReactNode, showName: boolean, back: () => void) => {
    const kind = rule?.kind === 'income' || category(categoryId)?.kind === 'income' ? 'income' : 'expense';
    return (
      <RowEditor
        key={rule?.id ?? `new-${categoryId ?? ''}`}
        rule={rule}
        initialCategoryId={categoryId}
        kind={kind}
        year={year}
        categories={categories}
        wallets={wallets}
        stores={stores}
        records={records}
        title={title}
        extra={extra}
        showName={showName}
        onSubmit={async (draft, registerStore) => {
          if (await saveRule(rule, draft, registerStore)) back();
        }}
        onRemove={rule ? () => removeRule(rule, back) : undefined}
      />
    );
  };

  let body: ReactNode;
  if (screen.type === 'row') {
    const rule = recurring.find((entry) => entry.id === screen.ruleId) ?? null;
    const target = category(screen.categoryId ?? rule?.categoryId ?? null);
    const siblings = target ? rowsOf(target.id).length : 0;
    body = rowEditor(
      rule,
      screen.categoryId ?? rule?.categoryId ?? null,
      target ? header(target) : <ScreenHeader title="カテゴリなし" icon="back" onClose={pop} />,
      null,
      siblings > 1 || (rule?.name.trim() ?? '') !== '' || rule === null,
      pop,
    );
  } else if (screen.type === 'category') {
    const target = category(screen.categoryId);
    const own = target ? rowsOf(target.id) : [];
    if (target === null) {
      body = <ScreenHeader title="年間予算" icon="back" onClose={pop} />;
    } else if (own.length <= 1) {
      // 予算が1件（または0件）なら、この1枚で全部決める。
      body = rowEditor(
        own[0] ?? null,
        target.id,
        header(target),
        <View style={styles.extra}>
          {own.length === 1 && (
            <Pressable accessibilityRole="button" onPress={() => push({ type: 'row', ruleId: null, categoryId: target.id })} style={styles.linkRow}>
              <Plus size={16} color={colors.money} />
              <Text style={styles.linkText}>予算を足す（同じ小分類で別の額・月）</Text>
            </Pressable>
          )}
          <Pressable accessibilityRole="button" onPress={() => archiveCategory(target)} style={styles.linkRow}>
            <Text style={styles.dangerText}>この小分類を使わない</Text>
          </Pressable>
        </View>,
        false,
        () => undefined,
      );
    } else {
      body = (
        <>
          {header(target)}
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.group}>
              {own.map((rule, index) => (
                <ItemRow
                  key={rule.id}
                  first={index === 0}
                  label={rule.name.trim() || `${index + 1}件目`}
                  note={budgetRowNote(rule)}
                  value={formatYen(rule.amount)}
                  onPress={() => push({ type: 'row', ruleId: rule.id, categoryId: target.id })}
                />
              ))}
              <AddRow label="追加" onPress={() => push({ type: 'row', ruleId: null, categoryId: target.id })} />
            </View>
            <View style={styles.total}>
              <Text style={styles.totalLabel}>{formatYear(year)}</Text>
              <Text style={styles.totalValue}>{formatYen(sumOf(own))}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => archiveCategory(target)} style={styles.linkRow}>
              <Text style={styles.dangerText}>この小分類を使わない</Text>
            </Pressable>
          </ScrollView>
        </>
      );
    }
  } else if (screen.type === 'top') {
    const top = category(screen.topId);
    if (top === null) {
      body = <ScreenHeader title="年間予算" icon="back" onClose={pop} />;
    } else {
      const own = rowsOf(top.id);
      const children = childCategories(categories, top.id);
      const entry = variableTops.find((item) => item.top.id === top.id);
      body = (
        <>
          {header(top)}
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.groupTitle}>月の予算（まとめて）</Text>
            <View style={styles.group}>
              {own.map((rule, index) => (
                <ItemRow
                  key={rule.id}
                  first={index === 0}
                  label={whenLabel(rule)}
                  note={rule.name.trim() || undefined}
                  value={formatYen(rule.amount)}
                  onPress={() => push({ type: 'row', ruleId: rule.id, categoryId: top.id })}
                />
              ))}
              <AddRow first={own.length === 0} label="追加" onPress={() => push({ type: 'row', ruleId: null, categoryId: top.id })} />
            </View>
            <Text style={styles.groupTitle}>小分類</Text>
            <View style={styles.group}>
              {children.map((child, index) => {
                const childRows = rowsOf(child.id);
                return (
                  <ItemRow
                    key={child.id}
                    first={index === 0}
                    label={child.name}
                    note={childRows.length === 1 ? budgetRowNote(childRows[0]) : childRows.length > 1 ? `${childRows.length}件` : undefined}
                    value={childRows.length === 0 ? '予算なし' : formatYen(sumOf(childRows))}
                    muted={childRows.length === 0}
                    onPress={() => push({ type: 'category', categoryId: child.id })}
                  />
                );
              })}
              <AddRow first={children.length === 0} label="追加" onPress={() => setSheet({ type: 'add', group: 'child', parentId: top.id })} />
            </View>
            {entry && (
              <>
                <View style={styles.total}>
                  <Text style={styles.totalLabel}>{formatYear(year)}</Text>
                  <Text style={styles.totalValue}>{formatYen(entry.total)}</Text>
                </View>
                <Text style={styles.note}>月の予算は、まとめての予算に小分類の予算を足したもの</Text>
              </>
            )}
          </ScrollView>
        </>
      );
    }
  } else {
    const groupSection = (group: Exclude<BudgetLineGroup, 'variable' | 'income'>) => {
      const entries = groupEntries(group);
      return (
        <View key={group} style={styles.section}>
          <SectionTitle group={group} total={totals[group]} />
          <View style={styles.group}>
            {entries.map((entry, index) => (
              <ItemRow
                key={entry.category.id}
                first={index === 0}
                label={entry.category.name}
                note={entry.rules.length === 1 ? budgetRowNote(entry.rules[0]) : `${entry.rules.length}件`}
                value={formatYen(entry.total)}
                onPress={() => push({ type: 'category', categoryId: entry.category.id })}
              />
            ))}
            <AddRow first={entries.length === 0} label="追加" onPress={() => setSheet({ type: 'add', group })} />
          </View>
        </View>
      );
    };
    const orphanRows = orphans.filter((rule) => rule.kind === tab);
    body = (
      <>
        <ScreenHeader title="年間予算" onClose={onClose} />
        <View style={styles.bar}>
          <Pressable accessibilityRole="button" accessibilityLabel="前の年" onPress={() => setYear((current) => current - 1)} hitSlop={8} style={styles.yearButton}>
            <ChevronLeft size={18} color={colors.textSubtle} />
          </Pressable>
          <Text style={styles.year}>{formatYear(year)}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="次の年" onPress={() => setYear((current) => current + 1)} hitSlop={8} style={styles.yearButton}>
            <ChevronRight size={18} color={colors.textSubtle} />
          </Pressable>
          <View style={styles.flex} />
          <Text style={styles.planLabel}>収支見込み</Text>
          <Text style={[styles.planValue, plan > 0 && styles.income]}>
            {plan < 0 ? '−' : plan > 0 ? '＋' : ''}
            {formatYen(plan)}
          </Text>
        </View>
        <View style={styles.segment}>
          {(['income', 'expense'] as const).map((entry) => (
            <Pressable
              key={entry}
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === entry }}
              onPress={() => setTab(entry)}
              style={[styles.segmentItem, tab === entry && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, tab === entry && styles.segmentTextSelected]}>
                {entry === 'income' ? `収入 ${formatYen(totals.income)}` : `支出 ${formatYen(expenseTotal)}`}
              </Text>
            </Pressable>
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {tab === 'income' ? (
            <View style={styles.section}>
              <SectionTitle group="income" total={totals.income} />
              <View style={styles.group}>
                {incomeEntries.map((entry, index) => (
                  <ItemRow
                    key={entry.category.id}
                    first={index === 0}
                    label={entry.category.parentId === null ? entry.category.name : `${category(entry.category.parentId)?.name ?? ''} › ${entry.category.name}`}
                    note={entry.rules.length === 1 ? budgetRowNote(entry.rules[0]) : `${entry.rules.length}件`}
                    value={formatYen(entry.total)}
                    onPress={() => push({ type: 'category', categoryId: entry.category.id })}
                  />
                ))}
                <AddRow first={incomeEntries.length === 0} label="追加" onPress={() => setSheet({ type: 'add', group: 'income' })} />
              </View>
            </View>
          ) : (
            <>
              <View style={styles.section}>
                <SectionTitle group="variable" total={totals.variable} />
                <View style={styles.group}>
                  {variableTops.map((entry, index) => {
                    const even = entry.monthly.every((value) => value === entry.monthly[0]);
                    const average = Math.round(entry.total / 12);
                    return (
                      <ItemRow
                        key={entry.top.id}
                        first={index === 0}
                        icon={iconKeyOf(entry.top)}
                        label={entry.top.name}
                        note={entry.total === 0 ? undefined : even ? `月 ${formatYen(average)}` : `月 約${formatYen(average)}`}
                        value={entry.total === 0 ? '予算なし' : formatYen(entry.total)}
                        muted={entry.total === 0}
                        onPress={() => push({ type: 'top', topId: entry.top.id })}
                      />
                    );
                  })}
                  <AddRow first={variableTops.length === 0} label="追加" onPress={() => setSheet({ type: 'add', group: 'variable' })} />
                </View>
              </View>
              {groupSection('confirmed')}
              {groupSection('estimate')}
              {groupSection('reserve')}
            </>
          )}
          {orphanRows.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.groupTitle}>カテゴリなし（押してカテゴリを決める）</Text>
              <View style={styles.group}>
                {orphanRows.map((rule, index) => (
                  <ItemRow
                    key={rule.id}
                    first={index === 0}
                    label={rule.name.trim() || (rule.kind === 'income' ? '収入' : '支出')}
                    note={budgetRowNote(rule)}
                    value={formatYen(yearTotal(rule))}
                    onPress={() => push({ type: 'row', ruleId: rule.id, categoryId: null })}
                  />
                ))}
              </View>
            </View>
          )}
        </ScrollView>
      </>
    );
  }

  const sheetTarget = sheet !== null && sheet.type !== 'add' ? category(sheet.categoryId) : null;

  return (
    <Modal visible animationType="slide" onRequestClose={onRequestClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        {body}
      </View>
      {sheet?.type === 'rename' && sheetTarget && (
        <RenameSheet name={sheetTarget.name} onClose={() => setSheet(null)} onSubmit={(name) => void rename(sheetTarget, name)} />
      )}
      {sheet?.type === 'group' && sheetTarget && (
        <GroupSheet
          current={spendGroupOf(sheetTarget.id, categories)}
          isTop={sheetTarget.parentId === null}
          currentTopId={topCategoryIdOf(categories, sheetTarget.id)}
          variableTops={topCategories(categories, 'living').filter((top) => top.budgetGroup === 'variable')}
          onClose={() => setSheet(null)}
          onPick={(group, topId) => void changeGroup(sheetTarget, group, topId)}
        />
      )}
      {sheet?.type === 'add' && (
        <AddSheet
          group={sheet.group}
          categories={categories}
          parentId={sheet.parentId ?? null}
          hasRows={(id) => rowsOf(id).length > 0}
          onClose={() => setSheet(null)}
          onPick={(categoryId) => {
            setSheet(null);
            push({ type: 'category', categoryId });
          }}
          onCreate={(name, parentId) => {
            if (sheet.group === 'child') return void createCategory('living', parentId, name);
            if (sheet.group === 'income') return void createCategory('income', parentId, name);
            if (sheet.group === 'variable') return void createCategory('living', null, name, 'variable');
            void (async () => {
              // 固定費・予備費の小分類は、その種類の大分類の下に作る（無ければ大分類も作る）。
              const group = sheet.group as Exclude<SpendGroup, 'variable'>;
              const found = topCategories(categories, 'living').find((top) => spendGroupOf(top.id, categories) === group);
              if (found) return createCategory('living', found.id, name);
              setSheet(null);
              try {
                const topName = NEW_TOP_NAME[group];
                let top = await insertMoneyCategory(supabase, familyId, {
                  kind: 'living',
                  parentId: null,
                  name: topName,
                  icon: guessIconKey(topName),
                  position: topCategories(categories, 'living', true).reduce((max, entry) => Math.max(max, entry.position + 1), 0),
                });
                top = await updateMoneyCategory(supabase, top.id, { budgetGroup: budgetGroupOf(group) });
                onCategories((prev) => [...prev, top]);
                const child = await insertMoneyCategory(supabase, familyId, { kind: 'living', parentId: top.id, name, icon: null, position: 0 });
                onCategories((prev) => [...prev, child]);
                push({ type: 'category', categoryId: child.id });
              } catch {
                failed();
              }
            })();
          }}
        />
      )}
    </Modal>
  );
}

/** 変動費の大分類の、まとめての予算の行の見出し（「毎月」「12月」「1〜11月」）。期間があれば添える。 */
function whenLabel(rule: MoneyRecurring): string {
  const when = rule.noMonth ? '発生月なし' : rule.months === null ? '毎月' : monthsLabel(rule.months);
  const period = recurringPeriodLabel(rule);
  return period === '' ? when : `${when}（${period}）`;
}

// ---- 部品 ----

function TitleBar({
  title,
  group,
  onBack,
  onRename,
  onGroup,
}: {
  title: string;
  group: BudgetLineGroup;
  onBack: () => void;
  onRename: () => void;
  onGroup?: () => void;
}) {
  const tone = GROUP_TONE[group];
  return (
    <View style={styles.titleBar}>
      <Pressable accessibilityRole="button" accessibilityLabel="戻る" onPress={onBack} hitSlop={10}>
        <ArrowLeft size={22} color={colors.textSubtle} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`${title}の名前を直す`} onPress={onRename} style={styles.titlePress}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="種類を変える"
        disabled={!onGroup}
        onPress={onGroup}
        style={[styles.tag, { backgroundColor: tone.surface }]}
      >
        <Text style={[styles.tagText, { color: tone.text }]}>{GROUP_LABEL[group]}</Text>
        {onGroup && <ChevronDown size={12} color={tone.text} />}
      </Pressable>
    </View>
  );
}

function SectionTitle({ group, total }: { group: BudgetLineGroup; total: number }) {
  return (
    <View style={styles.sectionHead}>
      <View style={[styles.dot, { backgroundColor: GROUP_TONE[group].text }]} />
      <Text style={styles.sectionTitle}>{GROUP_LABEL[group]}</Text>
      <View style={styles.flex} />
      <Text style={styles.sectionTotal}>{formatYen(total)}</Text>
    </View>
  );
}

function ItemRow({
  label,
  note,
  value,
  first,
  muted,
  icon,
  onPress,
}: {
  label: string;
  note?: string;
  value: string;
  first: boolean;
  muted?: boolean;
  icon?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.item, !first && styles.divided, pressed && styles.pressed]}
    >
      {icon && <CategoryIcon iconKey={icon} size={26} />}
      <View style={styles.flex}>
        <Text style={styles.itemLabel} numberOfLines={1}>
          {label}
        </Text>
        {note && (
          <Text style={styles.itemNote} numberOfLines={1}>
            {note}
          </Text>
        )}
      </View>
      <Text style={[styles.itemValue, muted && styles.mutedValue]}>{value}</Text>
      <ChevronRight size={16} color={colors.textFaint} />
    </Pressable>
  );
}

function AddRow({ label, onPress, first }: { label: string; onPress: () => void; first?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.item, !first && styles.divided, pressed && styles.pressed]}
    >
      <Plus size={16} color={colors.money} />
      <Text style={styles.addText}>{label}</Text>
    </Pressable>
  );
}

/** 「項目 ……… 値 ›」の1行（押すと選ぶ画面）。 */
function SettingRow({
  label,
  value,
  onPress,
  first,
  placeholder,
}: {
  label: string;
  value: string;
  onPress: () => void;
  first?: boolean;
  placeholder?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}を選ぶ`}
      onPress={onPress}
      style={({ pressed }) => [styles.item, !first && styles.divided, pressed && styles.pressed]}
    >
      <Text style={styles.settingLabel}>{label}</Text>
      <Text style={[styles.settingValue, placeholder && styles.mutedValue]} numberOfLines={1}>
        {value}
      </Text>
      <ChevronRight size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];

type RowSheet = 'when' | 'period' | 'day' | 'wallet' | null;

/** 予算1件の画面: 金額・いつ・期間（・区別の名前）と、自動記録（オンで日・出金元・お店）。 */
function RowEditor({
  rule,
  initialCategoryId,
  kind,
  year,
  categories,
  wallets,
  stores,
  records,
  title,
  extra,
  showName,
  onSubmit,
  onRemove,
}: {
  rule: MoneyRecurring | null;
  initialCategoryId: string | null;
  kind: 'expense' | 'income';
  year: number;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  title: ReactNode;
  extra: ReactNode;
  showName: boolean;
  onSubmit: (draft: MoneyRecurringDraft, registerStore: boolean) => Promise<void>;
  onRemove?: () => void;
}) {
  const isIncome = kind === 'income';
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [amountText, setAmountText] = useState(rule ? String(rule.amount) : '');
  const [mode, setMode] = useState<'monthly' | 'months' | 'none'>(rule?.noMonth ? 'none' : rule?.months ? 'months' : 'monthly');
  const [months, setMonths] = useState<number[]>(rule?.months ?? []);
  const [byInterval, setByInterval] = useState(rule?.intervalYears != null);
  const [intervalText, setIntervalText] = useState(rule?.intervalYears != null ? String(rule.intervalYears) : '2');
  const [startText, setStartText] = useState(periodMonthInput(rule?.startMonth ?? null));
  const [endText, setEndText] = useState(periodMonthInput(rule?.endMonth ?? null));
  const [name, setName] = useState(rule?.name ?? '');
  const [makesRecord, setMakesRecord] = useState(rule?.makesRecord ?? false);
  const [byWeekday, setByWeekday] = useState(rule?.weekOfMonth != null);
  const [dayText, setDayText] = useState(rule && rule.dayKnown && rule.weekOfMonth == null ? String(rule.day) : '');
  const [weekOfMonth, setWeekOfMonth] = useState<number | null>(rule?.weekOfMonth ?? null);
  const [weekday, setWeekday] = useState<number | null>(rule?.weekday ?? null);
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(rule?.holiday ?? (isIncome ? 'prev' : 'next'));
  const [walletId, setWalletId] = useState<string | null>(rule?.walletId ?? null);
  const [store, setStore] = useState(rule?.store ?? '');
  const [registerStore, setRegisterStore] = useState(false);
  // 収入の自動記録の額: 毎回同じ（確定）か、変わる（見込み）。支出は種類で決まる。
  const [incomeFixed, setIncomeFixed] = useState(rule?.amountMode === 'fixed');
  const [sheet, setSheet] = useState<RowSheet>(null);
  const [picking, setPicking] = useState<'store' | 'category' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const storeOptions = useMemo(() => storeChoices(stores, records, toDateString(new Date())), [stores, records]);

  const group: BudgetLineGroup | null =
    categoryId === null ? null : categories.find((entry) => entry.id === categoryId)?.kind === 'income' ? 'income' : spendGroupOf(categoryId, categories);
  const noMonth = mode === 'none';
  const auto = makesRecord && !noMonth;

  const build = (): MoneyRecurringDraft | string => {
    const amount = parseAmountInput(amountText);
    if (amountText.trim() === '' || amount === null) return '金額は0以上の整数（円）で入れてください';
    if (mode === 'months' && months.length === 0) return '発生する月を選んでください';
    const startMonth = parsePeriodMonth(startText);
    const endMonth = parsePeriodMonth(endText);
    if (startMonth === undefined || endMonth === undefined) return '期間は「2027/9」の形で入れてください（ずっとなら空）';
    if (startMonth !== null && endMonth !== null && startMonth > endMonth) return '期間の終わりを始まりより後にしてください';
    const intervalYears = byInterval ? Number(intervalText.trim()) : null;
    if (intervalYears !== null) {
      if (!Number.isInteger(intervalYears) || intervalYears < 2 || intervalYears > 10) return '何年ごとかを 2〜10 で入れてください';
      if (startMonth === null) return '◯年ごとは、期間の始まり（最初の回の月）を入れてください';
    }
    if (categoryId === null) return 'カテゴリを選んでください';
    let day = rule?.day ?? 1;
    if (auto) {
      if (byWeekday) {
        if (weekOfMonth === null || weekday === null) return '第何週の何曜日かを選んでください';
        day = 1;
      } else {
        day = Number(dayText.trim());
        if (!Number.isInteger(day) || day < 1 || day > 31) return `${isIncome ? '振込日' : '引き落とし日'}を 1〜31 で入れてください（末日は31）`;
      }
      if (walletId === null) return isIncome ? '入金先を選んでください' : '出金元を選んでください';
    }
    return {
      kind,
      day,
      weekOfMonth: auto && byWeekday ? weekOfMonth : null,
      weekday: auto && byWeekday ? weekday : null,
      months: mode === 'months' ? months : null,
      startMonth,
      endMonth,
      holiday,
      amountMode: isIncome ? (incomeFixed ? 'fixed' : 'estimate') : amountModeOfGroup(group === 'income' || group === null ? 'confirmed' : group),
      amount,
      walletId,
      toWalletId: null,
      store,
      categoryId,
      name,
      makesRecord: auto,
      skippedMonths: rule?.skippedMonths ?? [],
      intervalYears,
      dayKnown: auto,
      noMonth,
    };
  };
  const draft = build();
  const preview =
    typeof draft === 'string'
      ? null
      : (() => {
          const line = budgetLineOf({ ...draft, id: '', position: 0, archived: false, createdAt: '', deferredUntil: null });
          return { count: budgetLineCount(line, year), total: budgetLineYearAmount(line, year) };
        })();

  const submit = async () => {
    const result = build();
    if (typeof result === 'string') return setError(result);
    setError(null);
    setSaving(true);
    try {
      await onSubmit(result, result.store !== '' && registerStore);
    } finally {
      setSaving(false);
    }
  };

  if (picking === 'store') {
    return (
      <StorePicker
        value={store}
        registered={storeOptions.registered}
        others={storeOptions.others}
        canRegister
        onPick={(value, register) => {
          setStore(value);
          setRegisterStore(register);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    );
  }
  if (picking === 'category') {
    return (
      <CategoryPicker
        kind={kind}
        categories={categories}
        onPick={(choice) => {
          setCategoryId(choice.categoryId);
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    );
  }

  const when = noMonth ? '発生月なし' : mode === 'monthly' ? '毎月' : months.length === 0 ? '選ぶ' : monthsLabel(months);
  const whenValue = byInterval ? `${when}・${intervalText.trim() || '?'}年ごと` : when;
  const periodValue = (() => {
    const start = startText.trim();
    const end = endText.trim();
    if (start === '' && end === '') return 'ずっと';
    return `${start}〜${end}`;
  })();
  const dayValue = byWeekday
    ? weekOfMonth !== null && weekday !== null
      ? recurringDayLabel({ day: 1, weekOfMonth, weekday })
      : '選ぶ'
    : dayText.trim() === ''
      ? '選ぶ'
      : recurringDayLabel({ day: Number(dayText.trim()) || 1 });
  const wallet = wallets.find((entry) => entry.id === walletId);

  return (
    <>
      {title}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {initialCategoryId === null && (
          <View style={styles.group}>
            <SettingRow
              first
              label="カテゴリ"
              value={categoryId === null ? '選ぶ' : (categories.find((entry) => entry.id === categoryId)?.name ?? '選ぶ')}
              placeholder={categoryId === null}
              onPress={() => setPicking('category')}
            />
          </View>
        )}
        <View style={styles.group}>
          <View style={styles.item}>
            <Text style={styles.settingLabel}>金額</Text>
            <TextInput
              style={styles.amountInput}
              value={amountText}
              onChangeText={setAmountText}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={colors.textFaint}
            />
            <Text style={styles.yen}>円</Text>
          </View>
          <SettingRow label="いつ" value={whenValue} onPress={() => setSheet('when')} />
          <SettingRow label="期間" value={periodValue} placeholder={periodValue === 'ずっと'} onPress={() => setSheet('period')} />
          {showName && (
            <View style={[styles.item, styles.divided]}>
              <Text style={styles.settingLabel}>区別</Text>
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={setName}
                placeholder="任意（例: 妻・時短）"
                placeholderTextColor={colors.textFaint}
              />
            </View>
          )}
        </View>

        <View style={styles.group}>
          <View style={styles.item}>
            <Text style={[styles.settingLabel, styles.flex]}>自動記録</Text>
            <Switch
              value={auto}
              disabled={noMonth}
              onValueChange={setMakesRecord}
              trackColor={{ true: colors.money, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          </View>
          {auto && (
            <>
              <SettingRow label={isIncome ? '振込日' : '日'} value={`${dayValue}（${HOLIDAY_RULE_LABEL[holiday]}）`} placeholder={dayValue === '選ぶ'} onPress={() => setSheet('day')} />
              <SettingRow
                label={isIncome ? '入金先' : '出金元'}
                value={wallet?.name ?? '選ぶ'}
                placeholder={!wallet}
                onPress={() => setSheet('wallet')}
              />
              {!isIncome && <SettingRow label="お店" value={store || 'なし'} placeholder={store === ''} onPress={() => setPicking('store')} />}
              {isIncome && (
                <View style={[styles.item, styles.divided]}>
                  <Text style={[styles.settingLabel, styles.flex]}>毎回同じ額</Text>
                  <Switch
                    value={incomeFixed}
                    onValueChange={setIncomeFixed}
                    trackColor={{ true: colors.money, false: colors.borderStrong }}
                    thumbColor={colors.surface}
                  />
                </View>
              )}
            </>
          )}
        </View>
        <Text style={styles.note}>
          {noMonth
            ? '発生月なしは自動記録できません'
            : auto
              ? group === 'estimate' || group === 'variable' || (isIncome && !incomeFixed)
                ? 'その日に見込みの記録を作ります（額は過去の記録から。無ければこの金額）'
                : 'その日にこの金額で記録を作ります'
              : group === 'confirmed' || group === 'estimate'
                ? '記録は作りません。発生月に記録が無ければ、月の締めで知らせます'
                : '記録は作りません'}
        </Text>

        {preview && (
          <View style={styles.total}>
            <Text style={styles.totalLabel}>{formatYear(year)}</Text>
            <Text style={styles.totalValue}>
              {formatYen(preview.total)}（{preview.count}回）
            </Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="保存する" disabled={saving} onPress={() => void submit()} />
        {onRemove && (
          <Pressable accessibilityRole="button" onPress={onRemove} style={styles.linkRow}>
            <Text style={styles.dangerText}>この予算を消す</Text>
          </Pressable>
        )}
        {extra}
      </ScrollView>

      {sheet === 'when' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title="いつ" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onPress={() => setSheet(null)} />}>
            <Field label="発生月">
              <ChipRow>
                <Chip label="毎月" selected={mode === 'monthly'} onPress={() => setMode('monthly')} />
                <Chip label="月を選ぶ" selected={mode === 'months'} onPress={() => setMode('months')} />
                <Chip label="発生月なし" selected={mode === 'none'} onPress={() => setMode('none')} />
              </ChipRow>
              {mode === 'months' && (
                <ChipRow>
                  {MONTHS.map((month) => (
                    <Chip
                      key={month}
                      label={`${month}月`}
                      selected={months.includes(month)}
                      onPress={() =>
                        setMonths((prev) => (prev.includes(month) ? prev.filter((value) => value !== month) : [...prev, month].sort((a, b) => a - b)))
                      }
                    />
                  ))}
                </ChipRow>
              )}
            </Field>
            <Field label="頻度" hint={byInterval ? '期間の始まりの年から数えます' : undefined}>
              <ChipRow>
                <Chip label="毎年" selected={!byInterval} onPress={() => setByInterval(false)} />
                <Chip label="◯年ごと" selected={byInterval} onPress={() => setByInterval(true)} />
              </ChipRow>
              {byInterval && (
                <View style={styles.inline}>
                  <TextInput
                    style={[styles.input, styles.short]}
                    value={intervalText}
                    onChangeText={setIntervalText}
                    keyboardType="number-pad"
                    placeholder="2"
                    placeholderTextColor={colors.textFaint}
                  />
                  <Text style={styles.inlineText}>年ごと</Text>
                </View>
              )}
            </Field>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'period' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title="期間" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onPress={() => setSheet(null)} />}>
            <Field label="始まり〜終わり（空ならずっと）">
              <View style={styles.inline}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={startText}
                  onChangeText={setStartText}
                  placeholder="例: 2027/9"
                  placeholderTextColor={colors.textFaint}
                />
                <Text style={styles.inlineText}>〜</Text>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={endText}
                  onChangeText={setEndText}
                  placeholder="例: 2033/3"
                  placeholderTextColor={colors.textFaint}
                />
              </View>
            </Field>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'day' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title={isIncome ? '振込日' : '日'} onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onPress={() => setSheet(null)} />}>
            <ChipRow>
              <Chip label="日にち" selected={!byWeekday} onPress={() => setByWeekday(false)} />
              <Chip label="第◯◯曜日" selected={byWeekday} onPress={() => setByWeekday(true)} />
            </ChipRow>
            {byWeekday ? (
              <>
                <ChipRow>
                  {WEEK_OF_MONTH_OPTIONS.map((option) => (
                    <Chip key={option.value} label={option.label} selected={weekOfMonth === option.value} onPress={() => setWeekOfMonth(option.value)} />
                  ))}
                </ChipRow>
                <ChipRow>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <Chip key={label} label={`${label}曜日`} selected={weekday === index} onPress={() => setWeekday(index)} />
                  ))}
                </ChipRow>
              </>
            ) : (
              <TextInput
                style={styles.input}
                value={dayText}
                onChangeText={setDayText}
                keyboardType="number-pad"
                placeholder="例: 27（末日は31）"
                placeholderTextColor={colors.textFaint}
              />
            )}
            <Field label="休日のとき">
              <ChipRow>
                {HOLIDAYS.map((entry) => (
                  <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onPress={() => setHoliday(entry)} />
                ))}
              </ChipRow>
            </Field>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'wallet' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title={isIncome ? '入金先' : '出金元'} onClose={() => setSheet(null)}>
            <WalletChoices
              wallets={wallets}
              selectedId={walletId}
              onPick={(id) => {
                setWalletId(id);
                setSheet(null);
              }}
            />
          </LogModalShell>
        </SheetModal>
      )}
    </>
  );
}

function RenameSheet({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title="名前を直す" onClose={onClose} footer={<PrimaryButton label="保存する" disabled={text.trim() === ''} onPress={() => onSubmit(text)} />}>
        <TextInput style={styles.input} value={text} onChangeText={setText} autoFocus placeholder="名前" placeholderTextColor={colors.textFaint} />
      </LogModalShell>
    </SheetModal>
  );
}

/** 種類を選ぶ。変動費は、どの大分類に入れるかも選ぶ（小分類のとき）。 */
function GroupSheet({
  current,
  isTop,
  currentTopId,
  variableTops,
  onClose,
  onPick,
}: {
  current: SpendGroup;
  isTop: boolean;
  currentTopId: string | null;
  variableTops: MoneyCategory[];
  onClose: () => void;
  onPick: (group: SpendGroup, variableTopId?: string) => void;
}) {
  const [choosingTop, setChoosingTop] = useState(false);
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title={choosingTop ? '変動費のどの大分類に入れるか' : '種類'} onClose={onClose}>
        {choosingTop ? (
          <View style={styles.group}>
            {variableTops.map((top, index) => (
              <Pressable
                key={top.id}
                accessibilityRole="button"
                onPress={() => onPick('variable', top.id)}
                style={({ pressed }) => [styles.item, index > 0 && styles.divided, pressed && styles.pressed]}
              >
                <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
                <Text style={[styles.itemLabel, styles.flex]}>{top.name}</Text>
                {top.id === currentTopId && <Text style={styles.check}>✓</Text>}
              </Pressable>
            ))}
            {variableTops.length === 0 && <Text style={styles.note}>変動費の大分類がありません</Text>}
          </View>
        ) : (
          <View style={styles.group}>
            {SPEND_GROUPS.map((group, index) => (
              <Pressable
                key={group}
                accessibilityRole="button"
                onPress={() => {
                  if (group === 'variable' && !isTop) return setChoosingTop(true);
                  if (group === current) return onClose();
                  onPick(group);
                }}
                style={({ pressed }) => [styles.item, index > 0 && styles.divided, pressed && styles.pressed]}
              >
                <View style={[styles.tag, { backgroundColor: GROUP_TONE[group].surface }]}>
                  <Text style={[styles.tagText, { color: GROUP_TONE[group].text }]}>{GROUP_LABEL[group]}</Text>
                </View>
                <Text style={[styles.itemNote, styles.flex]}>{GROUP_NOTE[group]}</Text>
                {group === current && <Text style={styles.check}>✓</Text>}
              </Pressable>
            ))}
          </View>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

/** 予算を足す小分類を選ぶ（予算の無い小分類から）か、新しく作る。 */
function AddSheet({
  group,
  categories,
  parentId,
  hasRows,
  onClose,
  onPick,
  onCreate,
}: {
  group: BudgetLineGroup | 'child';
  categories: MoneyCategory[];
  parentId: string | null;
  hasRows: (categoryId: string) => boolean;
  onClose: () => void;
  onPick: (categoryId: string) => void;
  onCreate: (name: string, parentId: string | null) => void;
}) {
  const [name, setName] = useState('');
  const incomeTops = topCategories(categories, 'income');
  const [incomeTop, setIncomeTop] = useState<string | null>(incomeTops[0]?.id ?? null);
  // 選べる小分類（予算の無いもの）。変動費は大分類を作るだけ。
  const choices =
    group === 'variable' || group === 'child'
      ? []
      : (group === 'income' ? incomeTops : topCategories(categories, 'living').filter((top) => spendGroupOf(top.id, categories) === group))
          .flatMap((top) => childCategories(categories, top.id))
          .filter((entry) => !hasRows(entry.id));
  const title = group === 'variable' ? '変動費の大分類を足す' : group === 'child' ? '小分類を足す' : `${GROUP_LABEL[group]}を足す`;
  const createParent = group === 'income' ? incomeTop : group === 'child' ? parentId : null;
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={title}
        onClose={onClose}
        footer={
          <PrimaryButton
            label="新しく作る"
            disabled={name.trim() === '' || (group === 'income' && createParent === null)}
            onPress={() => onCreate(name.trim(), createParent)}
          />
        }
      >
        {choices.length > 0 && (
          <Field label="予算の無い小分類から選ぶ">
            <ChipRow>
              {choices.map((entry) => (
                <Chip key={entry.id} label={entry.name} selected={false} onPress={() => onPick(entry.id)} />
              ))}
            </ChipRow>
          </Field>
        )}
        {group === 'income' && incomeTops.length > 0 && (
          <Field label="新しく作る小分類の大分類">
            <ChipRow>
              {incomeTops.map((top) => (
                <Chip key={top.id} label={top.name} selected={incomeTop === top.id} onPress={() => setIncomeTop(top.id)} />
              ))}
            </ChipRow>
          </Field>
        )}
        <Field label={group === 'variable' ? '大分類の名前' : '新しい小分類の名前'}>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="例: 誕生日お祝い" placeholderTextColor={colors.textFaint} />
        </Field>
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8 },
  yearButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  year: { fontSize: 16, fontWeight: '700', color: colors.text },
  planLabel: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  planValue: { fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  income: { color: colors.moneyIncome },
  segment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 3,
    borderRadius: 10,
    backgroundColor: colors.neutralSurface,
  },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 8 },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  segmentTextSelected: { color: colors.text },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  section: { gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  sectionTotal: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 4 },
  group: { borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 46 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  itemLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  itemNote: { fontSize: 12, fontWeight: '500', color: colors.textMuted, marginTop: 1 },
  itemValue: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  mutedValue: { color: colors.textFaint, fontWeight: '500' },
  addText: { fontSize: 15, fontWeight: '700', color: colors.money },
  settingLabel: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
  settingValue: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '600', color: colors.text },
  amountInput: { flex: 1, textAlign: 'right', fontSize: 16, fontWeight: '700', color: colors.text, paddingVertical: 0 },
  nameInput: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '500', color: colors.text, paddingVertical: 0 },
  yen: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  note: { fontSize: 12, fontWeight: '500', color: colors.textMuted, paddingHorizontal: 4, lineHeight: 18 },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  extra: { gap: 4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.money },
  dangerText: { fontSize: 14, fontWeight: '700', color: colors.danger },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  titlePress: { flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 2, borderRadius: 999 },
  tagText: { fontSize: 12, fontWeight: '700' },
  check: { fontSize: 15, fontWeight: '700', color: colors.money },
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
  short: { width: 64, textAlign: 'right' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inlineText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
});
