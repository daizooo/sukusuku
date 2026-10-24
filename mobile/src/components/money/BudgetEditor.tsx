import { useMemo, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Text as SvgText } from 'react-native-svg';
import Modal from '@/components/ui/Modal';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react-native';
import type {
  MoneyBudgetGroup,
  MoneyCategory,
  MoneyHolidayRule,
  MoneyRatioTargets,
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
  childCategories,
  formatYear,
  formatYen,
  guessIconKey,
  HOLIDAY_RULE_LABEL,
  isBudgetRow,
  manualBudgetFor,
  monthsLabel,
  parseAmountInput,
  parsePeriodMonth,
  periodMonthInput,
  recurringDayLabel,
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
  updateMoneyCategory,
  updateMoneyRecurring,
} from '@/lib/api/money';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import StorePicker from '@/components/money/StorePicker';
import RatioTargetSettings from '@/components/money/RatioTargetSettings';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';
import { Chip, ChipRow, Field, WalletChoices } from '@/components/money/feedParts';

// 年間予算（docs/kakei.md §0.8。2026-10-24）。PWA版の `src/components/sukusuku/money/BudgetEditor.tsx` と同じ並び・文言。
//
// 予算が本体。予算1件＝自動記録ルールの表（money_recurring）の1行で、「単価 × その年に発生する回数」。自動記録はその行のオン／オフ。
// - 上の枠: 円グラフ（1周＝収入）。支出の種類を青の濃淡で並べ、残りが収支見込み（緑）。赤字の年は、支出の種類を1周に並べ、
//   収入からはみ出した分を外側の赤い弧で出す。円の下に収支見込み・収入・支出と、支出の種類（収入に対する割合）。
//   行を押すと、下の一覧はその種類だけになる（もう一度押すと全部）
// - 下の一覧: 収入・変動費・予備費・固定費（確定）・固定費（見込み）の見出しごと（見出しを押すと折りたたむ）。収入の見出しの下線は緑、
//   ほかはグレー。行は名前と年の額だけ（詳細は押して開く枠で見る）。その年に発生しない予算は、グレーにして「期間外」を付け、各見出しの一番下
// - 変動費の行は大分類。押すと大分類の画面（まとめての予算と小分類の予算・大分類の名前）
// - 予算の枠（追加・編集）: 分類（種類・大分類〔変動費・収入だけ〕・小分類・区別）、予算（金額・いつ・期間）、自動記録（オン／オフ・日・出金元・お店）。
//   固定費（確定）・固定費（見込み）・予備費は、大分類＝種類（名前も種類の名前）。種類を変えて保存すると、その小分類は選んだ種類（大分類）へ移る

interface BudgetEditorProps {
  familyId: string;
  /** 最初に見る年（暦年）。 */
  year: number;
  categories: MoneyCategory[];
  recurring: MoneyRecurring[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  /** 目安の割合（docs/kakei.md §0.9）。年間予算の画面から決める。 */
  ratioTargets: MoneyRatioTargets;
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
  onRatioTargets: (targets: MoneyRatioTargets) => void;
  onClose: () => void;
}

/** 種類の名前（見出し・選ぶ画面）。 */
const GROUP_LABEL: Record<BudgetLineGroup, string> = {
  income: '収入',
  variable: '変動費',
  confirmed: '固定費（確定）',
  estimate: '固定費（見込み）',
  reserve: '予備費',
};

/** 上の枠の内訳の名前。 */
const PART_LABEL: Record<SpendGroup, string> = {
  variable: '変動費',
  confirmed: '固定費・確定',
  estimate: '固定費・見込み',
  reserve: '予備費',
};

// 並びは 変動費 → 予備費 → 固定費（確定・見込み）。家計全体で予算を並べるときの順（2026-10-24。docs/kakei.md §0.9）。
const SPEND_GROUPS: SpendGroup[] = ['variable', 'reserve', 'confirmed', 'estimate'];
const GROUPS: BudgetLineGroup[] = ['income', ...SPEND_GROUPS];

/** 円グラフの色（支出の種類は青の濃淡。収支見込みは収入の緑、赤字は赤）。 */
const PART_COLOR: Record<SpendGroup, string> = {
  variable: '#1e3a8a',
  confirmed: '#3b82f6',
  estimate: '#93c5fd',
  reserve: '#cbd5e1',
};
const DEFICIT_COLOR = '#dc2626';

/** 支出の種類 → 大分類の予算の分け方。 */
const budgetGroupOf = (group: SpendGroup): MoneyBudgetGroup => (group === 'confirmed' ? 'fixed' : group);

/** 大分類＝種類のもの（固定費・予備費）の大分類の名前。 */
const TYPE_TOP_NAME: Record<Exclude<SpendGroup, 'variable'>, string> = {
  confirmed: '固定費（確定）',
  estimate: '固定費（見込み）',
  reserve: '予備費',
};

/** 大分類を選ぶ種類（変動費・収入）。ほかは大分類＝種類。 */
const choosesTop = (group: BudgetLineGroup): group is 'variable' | 'income' => group === 'variable' || group === 'income';

type Screen = { type: 'list' } | { type: 'ratio' } | { type: 'top'; topId: string } | { type: 'form'; ruleId: string | null; group?: BudgetLineGroup; topId?: string };

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

/** 目安の割合の要約（変動費35%・予備費15%・固定費35%）。 */
const ratioSummary = (targets: MoneyRatioTargets): string => {
  const parts = [
    targets.variable === null ? null : `変動費${targets.variable}%`,
    targets.reserve === null ? null : `予備費${targets.reserve}%`,
    targets.fixed === null ? null : `固定費${targets.fixed}%`,
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? '未設定' : parts.join('・');
};

/** 割合（収入に対する）。一桁は前に数字1つぶんの空き。 */
const percentText = (value: number, base: number): string => {
  if (base <= 0) return '';
  const percent = Math.round((value / base) * 100);
  return `（${percent < 10 ? ' ' : ''}${percent}%）`;
};

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
  ratioTargets,
  onCategories,
  onRecurring,
  onStores,
  onRatioTargets,
  onClose,
}: BudgetEditorProps) {
  const insets = useSafeAreaInsets();
  const [year, setYear] = useState(initialYear);
  const [stack, setStack] = useState<Screen[]>([{ type: 'list' }]);
  // 上の枠で押した種類（その種類だけ並べる。expense は支出の種類すべて）。null は全部。
  const [selected, setSelected] = useState<BudgetLineGroup | 'expense' | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<MoneyCategory | null>(null);
  const screen = stack[stack.length - 1];
  const push = (next: Screen) => setStack((prev) => [...prev, next]);
  const pop = () => setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  const rows = useMemo(() => recurring.filter(isBudgetRow).sort(byPosition), [recurring]);
  const yearTotal = (rule: MoneyRecurring) => budgetLineYearAmount(budgetLineOf(rule), year);
  const variableBudgets = useMemo(() => variableBudgetsOf(recurring, categories), [recurring, categories]);
  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const category = (id: string | null) => categories.find((entry) => entry.id === id) ?? null;
  const groupOf = (categoryId: string): BudgetLineGroup =>
    category(categoryId)?.kind === 'income' ? 'income' : spendGroupOf(categoryId, categories);
  const failed = () => Alert.alert('保存できませんでした', 'もう一度お試しください。');

  /** 行の名前（小分類〔大分類の行は大分類〕と区別）。収入は「給与 › 大造」。 */
  const rowLabel = (rule: MoneyRecurring) => {
    const own = category(rule.categoryId);
    const top = own?.parentId ? category(own.parentId) : null;
    const base = own === null ? (rule.kind === 'income' ? '収入' : '支出') : own.kind === 'income' && top ? `${top.name} › ${own.name}` : own.name;
    return rule.name.trim() === '' ? base : `${base}（${rule.name.trim()}）`;
  };

  // 変動費の大分類（年の予算）。
  const variableTops = useMemo(
    () =>
      topCategories(categories, 'living')
        .filter((top) => top.budgetGroup === 'variable')
        .map((top) => {
          const total = monthKeys.reduce((sum, key) => sum + (manualBudgetFor(variableBudgets, top.id, key) ?? 0), 0);
          return { top, total };
        }),
    [categories, monthKeys, variableBudgets],
  );
  // 種類ごとの行（変動費以外。その年の額つき。期間外は一番下）。
  const sections = useMemo(() => {
    const result: Record<Exclude<BudgetLineGroup, 'variable'>, { rule: MoneyRecurring; total: number }[]> = {
      income: [],
      confirmed: [],
      estimate: [],
      reserve: [],
    };
    const order = (rule: MoneyRecurring) => {
      const own = categories.find((entry) => entry.id === rule.categoryId);
      const top = categories.find((entry) => entry.id === topCategoryIdOf(categories, rule.categoryId as string));
      return (top?.position ?? 0) * 10000 + (own?.parentId ? own.position : 0);
    };
    for (const rule of [...rows].sort((a, b) => order(a) - order(b) || a.position - b.position)) {
      const own = categories.find((entry) => entry.id === rule.categoryId);
      const group: BudgetLineGroup = own?.kind === 'income' ? 'income' : spendGroupOf(rule.categoryId, categories);
      if (group === 'variable') continue;
      result[group].push({ rule, total: budgetLineYearAmount(budgetLineOf(rule), year) });
    }
    for (const key of Object.keys(result) as (keyof typeof result)[]) {
      result[key].sort((a, b) => Number(a.total === 0) - Number(b.total === 0));
    }
    return result;
  }, [rows, categories, year]);
  const orphans = recurring.filter((rule) => !rule.archived && rule.kind !== 'transfer' && rule.categoryId === null).sort(byPosition);

  const sumOf = (list: { total: number }[]) => list.reduce((sum, entry) => sum + entry.total, 0);
  const totals: Record<BudgetLineGroup, number> = {
    income: sumOf(sections.income),
    variable: sumOf(variableTops),
    confirmed: sumOf(sections.confirmed),
    estimate: sumOf(sections.estimate),
    reserve: sumOf(sections.reserve),
  };
  const expense = totals.variable + totals.confirmed + totals.estimate + totals.reserve;
  const balance = totals.income - expense;

  // ---- 保存 ----

  const putRule = (saved: MoneyRecurring) =>
    onRecurring((prev) => [...prev.filter((rule) => rule.id !== saved.id), saved].sort(byPosition));
  const putCategory = (saved: MoneyCategory) => onCategories((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);

  /** その種類の大分類（固定費・予備費は種類そのもの。無ければ作る）。 */
  const typeTop = async (group: Exclude<SpendGroup, 'variable'>): Promise<MoneyCategory> => {
    const found = topCategories(categories, 'living').find((top) => spendGroupOf(top.id, categories) === group);
    if (found) return found;
    const name = TYPE_TOP_NAME[group];
    let top = await insertMoneyCategory(supabase, familyId, {
      kind: 'living',
      parentId: null,
      name,
      icon: guessIconKey(name),
      position: topCategories(categories, 'living', true).reduce((max, entry) => Math.max(max, entry.position + 1), 0),
    });
    top = await updateMoneyCategory(supabase, top.id, { budgetGroup: budgetGroupOf(group) });
    putCategory(top);
    return top;
  };

  /** 小分類を作る（予算の枠の小分類の選択から）。 */
  const createCategory = async (group: BudgetLineGroup, topId: string | null, name: string): Promise<MoneyCategory | null> => {
    try {
      const parent = choosesTop(group) ? category(topId) : await typeTop(group);
      if (parent === null) return null;
      const created = await insertMoneyCategory(supabase, familyId, {
        kind: parent.kind,
        parentId: parent.id,
        name,
        icon: null,
        position: childCategories(categories, parent.id, true).reduce((max, entry) => Math.max(max, entry.position + 1), 0),
      });
      onCategories((prev) => [...prev, created]);
      return created;
    } catch {
      failed();
      return null;
    }
  };

  /**
   * 大分類を作る（予算の枠の大分類の選択から。変動費・収入だけ。ほかは大分類＝種類）。
   * 予算が本体で、カテゴリは予算を表示するだけなので、カテゴリの設定を先にしなくても、ここで足せる。
   */
  const createTop = async (group: BudgetLineGroup, name: string): Promise<MoneyCategory | null> => {
    try {
      const kind = group === 'income' ? 'income' : 'living';
      const created = await insertMoneyCategory(supabase, familyId, {
        kind,
        parentId: null,
        name,
        icon: guessIconKey(name),
        position: topCategories(categories, kind, true).reduce((max, entry) => Math.max(max, entry.position + 1), 0),
      });
      putCategory(created);
      return created;
    } catch {
      failed();
      return null;
    }
  };

  const rename = async (target: MoneyCategory, name: string) => {
    setRenaming(null);
    if (name.trim() === '' || name.trim() === target.name) return;
    try {
      putCategory(await updateMoneyCategory(supabase, target.id, { name }));
    } catch {
      failed();
    }
  };

  /**
   * 予算を保存する。小分類が選んだ種類（変動費・収入は選んだ大分類）の外にあれば、その小分類を移す
   * （同じ小分類のほかの予算の確定／見込みも、種類に合わせて直す）。
   */
  const saveBudget = async (
    target: MoneyRecurring | null,
    draft: MoneyRecurringDraft,
    group: BudgetLineGroup,
    topId: string | null,
    registerStore: boolean,
  ): Promise<boolean> => {
    try {
      const own = category(draft.categoryId);
      if (own !== null && own.parentId !== null) {
        const parent = choosesTop(group) ? category(topId) : await typeTop(group);
        if (parent !== null && own.parentId !== parent.id) {
          const position = childCategories(categories, parent.id, true).reduce((max, entry) => Math.max(max, entry.position + 1), 0);
          putCategory(await updateMoneyCategory(supabase, own.id, { parentId: parent.id, position }));
          if (group !== 'income') {
            const mode = amountModeOfGroup(group);
            for (const rule of rows.filter((entry) => entry.categoryId === own.id && entry.id !== target?.id && entry.kind === 'expense')) {
              if (rule.amountMode !== mode) putRule(await updateMoneyRecurring(supabase, rule.id, { ...draftOf(rule), amountMode: mode }));
            }
          }
        }
      }
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

  const removeRule = (rule: MoneyRecurring) =>
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
              pop();
            } catch {
              failed();
            }
          })(),
      },
    ]);

  const onRequestClose = () => {
    if (renaming !== null) return setRenaming(null);
    if (stack.length > 1) return pop();
    onClose();
  };

  // ---- 画面 ----

  let body: ReactNode;
  if (screen.type === 'form') {
    const rule = recurring.find((entry) => entry.id === screen.ruleId) ?? null;
    body = (
      <BudgetForm
        key={rule?.id ?? `new-${screen.group ?? ''}-${screen.topId ?? ''}`}
        rule={rule}
        initialGroup={rule?.categoryId ? groupOf(rule.categoryId) : (screen.group ?? 'variable')}
        initialTopId={rule?.categoryId ? topCategoryIdOf(categories, rule.categoryId) : (screen.topId ?? null)}
        year={year}
        categories={categories}
        wallets={wallets}
        stores={stores}
        records={records}
        onCreateCategory={createCategory}
        onCreateTop={createTop}
        onRenameCategory={setRenaming}
        onClose={pop}
        onSubmit={async (draft, group, topId, registerStore) => {
          if (await saveBudget(rule, draft, group, topId, registerStore)) pop();
        }}
        onRemove={rule ? () => removeRule(rule) : undefined}
      />
    );
  } else if (screen.type === 'ratio') {
    body = <RatioTargetSettings familyId={familyId} targets={ratioTargets} onSaved={onRatioTargets} onBack={pop} />;
  } else if (screen.type === 'top') {
    const top = category(screen.topId);
    const own = top ? rows.filter((rule) => rule.categoryId === top.id || category(rule.categoryId)?.parentId === top.id) : [];
    const list = own.map((rule) => ({ rule, total: yearTotal(rule) })).sort((a, b) => Number(a.total === 0) - Number(b.total === 0));
    const total = top ? (variableTops.find((entry) => entry.top.id === top.id)?.total ?? 0) : 0;
    body = (
      <>
        <ScreenHeader title={top?.name ?? '変動費'} icon="back" onClose={pop} />
        {top && (
          <ScrollView contentContainerStyle={styles.content}>
            <View style={styles.topTotal}>
              <Text style={styles.topTotalValue}>{formatYen(total)}</Text>
              <Text style={styles.topTotalNote}>{`月 ${formatYen(Math.round(total / 12))}`}</Text>
            </View>
            <View>
              {list.map((entry, index) => (
                <BudgetRow
                  key={entry.rule.id}
                  first={index === 0}
                  label={entry.rule.categoryId === top.id ? `まとめて${entry.rule.name.trim() ? `（${entry.rule.name.trim()}）` : ''}` : rowLabel(entry.rule)}
                  total={entry.total}
                  onPress={() => push({ type: 'form', ruleId: entry.rule.id })}
                />
              ))}
              {list.length === 0 && <Text style={styles.empty}>予算がまだありません</Text>}
            </View>
            <Text style={styles.groupTitle}>大分類の設定</Text>
            <View style={styles.group}>
              <SettingRow first label="名前" value={top.name} onPress={() => setRenaming(top)} />
            </View>
            <AddButton label={`${top.name}の予算を追加`} onPress={() => push({ type: 'form', ruleId: null, group: 'variable', topId: top.id })} />
          </ScrollView>
        )}
      </>
    );
  } else {
    const shown = (group: BudgetLineGroup) => selected === null || selected === group || (selected === 'expense' && group !== 'income');
    const section = (group: BudgetLineGroup, content: ReactNode, total: number) => {
      // 上の枠で絞ったときは折りたたまない（折りたたみの印も出さない）。
      const filtered = selected !== null;
      const open = filtered || !collapsed.has(group);
      return (
        <View key={group} style={styles.section}>
          <Pressable
            accessibilityRole={filtered ? undefined : 'button'}
            accessibilityState={filtered ? undefined : { expanded: open }}
            disabled={filtered}
            onPress={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(group)) next.delete(group);
                else next.add(group);
                return next;
              })
            }
            style={[styles.sectionHead, group === 'income' ? styles.sectionHeadIncome : null]}
          >
            {!filtered && (open ? <ChevronDown size={14} color={colors.textMuted} /> : <ChevronRight size={14} color={colors.textMuted} />)}
            <Text style={styles.sectionTitle}>{GROUP_LABEL[group]}</Text>
            <View style={styles.flex} />
            <Text style={styles.sectionTotal}>{formatYen(total)}</Text>
          </Pressable>
          {open && content}
        </View>
      );
    };
    const ruleList = (group: Exclude<BudgetLineGroup, 'variable'>) => (
      <View>
        {sections[group].map((entry, index) => (
          <BudgetRow
            key={entry.rule.id}
            first={index === 0}
            label={rowLabel(entry.rule)}
            total={entry.total}
            onPress={() => push({ type: 'form', ruleId: entry.rule.id })}
          />
        ))}
        {sections[group].length === 0 && <Text style={styles.empty}>予算がまだありません</Text>}
      </View>
    );
    const variableList = (
      <View>
        {[...variableTops]
          .sort((a, b) => Number(a.total === 0) - Number(b.total === 0))
          .map((entry, index) => (
            <BudgetRow
              key={entry.top.id}
              first={index === 0}
              label={entry.top.name}
              total={entry.total}
              offLabel="予算なし"
              onPress={() => push({ type: 'top', topId: entry.top.id })}
            />
          ))}
      </View>
    );
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
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.overview}>
            <Donut income={totals.income} parts={SPEND_GROUPS.map((group) => ({ group, amount: totals[group] }))} />
            <LegendRow
              main
              color={balance >= 0 ? colors.moneyIncome : DEFICIT_COLOR}
              label="収支見込み"
              percent=""
              amount={balance < 0 ? `−${formatYen(balance)}` : formatYen(balance)}
              amountColor={balance >= 0 ? colors.moneyIncome : DEFICIT_COLOR}
            />
            <LegendRow
              main
              label="収入"
              percent=""
              amount={formatYen(totals.income)}
              selected={selected === 'income'}
              onPress={() => setSelected((current) => (current === 'income' ? null : 'income'))}
            />
            <LegendRow
              main
              label="支出"
              percent=""
              amount={formatYen(expense)}
              selected={selected === 'expense'}
              onPress={() => setSelected((current) => (current === 'expense' ? null : 'expense'))}
            />
            {SPEND_GROUPS.map((group) => (
              <LegendRow
                key={group}
                color={PART_COLOR[group]}
                label={PART_LABEL[group]}
                percent={percentText(totals[group], totals.income)}
                amount={formatYen(totals[group])}
                selected={selected === group}
                onPress={() => setSelected((current) => (current === group ? null : group))}
              />
            ))}
          </View>

          {shown('income') && section('income', ruleList('income'), totals.income)}
          {shown('variable') && section('variable', variableList, totals.variable)}
          {shown('reserve') && section('reserve', ruleList('reserve'), totals.reserve)}
          {shown('confirmed') && section('confirmed', ruleList('confirmed'), totals.confirmed)}
          {shown('estimate') && section('estimate', ruleList('estimate'), totals.estimate)}
          {selected === null && orphans.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>カテゴリなし</Text>
              </View>
              <View>
                {orphans.map((rule, index) => (
                  <BudgetRow key={rule.id} first={index === 0} label={rowLabel(rule)} total={yearTotal(rule)} onPress={() => push({ type: 'form', ruleId: rule.id })} />
                ))}
              </View>
            </View>
          )}
          <AddButton label="予算を追加" onPress={() => push({ type: 'form', ruleId: null, group: selected === null || selected === 'expense' ? 'variable' : selected })} />
          <View style={styles.group}>
            <SettingRow first label="目安の割合" value={ratioSummary(ratioTargets)} placeholder={ratioSummary(ratioTargets) === '未設定'} onPress={() => push({ type: 'ratio' })} />
          </View>
        </ScrollView>
      </>
    );
  }

  return (
    <Modal visible animationType="slide" onRequestClose={onRequestClose}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
        {body}
      </View>
      {renaming !== null && <RenameSheet name={renaming.name} onClose={() => setRenaming(null)} onSubmit={(name) => void rename(renaming, name)} />}
    </Modal>
  );
}

// ---- 上の枠 ----

const DONUT_SIZE = 168;

/** 円グラフ（1周＝収入）。黒字は残りを緑。赤字は支出の種類を1周に並べ、収入からはみ出した分を外側の赤い弧で出す。 */
function Donut({ income, parts }: { income: number; parts: { group: SpendGroup; amount: number }[] }) {
  const expense = parts.reduce((sum, part) => sum + part.amount, 0);
  const deficit = expense > income;
  // 種類を並べる1周の基準。黒字は収入、赤字は支出（種類の並びを1周に収める）。
  const base = deficit ? expense : income;
  const center = 80;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const arcs: { key: string; color: string; length: number; offset: number }[] = [];
  if (base > 0) {
    for (const part of parts) {
      const length = (circumference * part.amount) / base;
      arcs.push({ key: part.group, color: PART_COLOR[part.group], length, offset });
      offset += length;
    }
    if (!deficit && income > expense) arcs.push({ key: 'balance', color: colors.moneyIncome, length: circumference - offset, offset });
  }
  const outer = 74;
  const outerCircumference = 2 * Math.PI * outer;
  // はみ出し（収入に対する割合。収入が無ければ1周）。
  const over = deficit ? Math.min(1, income > 0 ? (expense - income) / income : 1) * outerCircumference : 0;
  const centerText = income >= 10000 ? `¥${Math.round(income / 10000).toLocaleString('ja-JP')}万` : formatYen(income);
  return (
    <View style={styles.donut}>
      <Svg width={DONUT_SIZE} height={DONUT_SIZE} viewBox="0 0 160 160">
        <Circle cx={center} cy={center} r={radius} fill="none" stroke={colors.neutralSurface} strokeWidth={18} />
        {arcs.map((arc) => (
          <Circle
            key={arc.key}
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={arc.color}
            strokeWidth={18}
            strokeDasharray={`${arc.length} ${circumference - arc.length}`}
            strokeDashoffset={-arc.offset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        ))}
        {over > 0 && (
          <Circle
            cx={center}
            cy={center}
            r={outer}
            fill="none"
            stroke={DEFICIT_COLOR}
            strokeWidth={6}
            strokeDasharray={`${over} ${outerCircumference - over}`}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
        <SvgText x={center} y={70} textAnchor="middle" fontSize={10} fontWeight="700" fill={colors.textMuted}>
          収入
        </SvgText>
        <SvgText x={center} y={88} textAnchor="middle" fontSize={16} fontWeight="800" fill={colors.text}>
          {centerText}
        </SvgText>
      </Svg>
    </View>
  );
}

function LegendRow({
  label,
  percent,
  amount,
  color,
  amountColor,
  main,
  selected,
  onPress,
}: {
  label: string;
  percent: string;
  amount: string;
  color?: string;
  amountColor?: string;
  main?: boolean;
  selected?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? { selected: !!selected } : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.legend, main && styles.legendMain, selected && styles.legendSelected]}
    >
      <View style={[styles.legendSwatch, color ? { backgroundColor: color } : null]} />
      <Text style={[main ? styles.legendMainLabel : styles.legendLabel, selected && styles.selectedText]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.legendPercent, selected && styles.selectedText]}>{percent}</Text>
      <Text
        style={[main ? styles.legendMainAmount : styles.legendAmount, amountColor ? { color: amountColor } : null, selected && styles.selectedText]}
        numberOfLines={1}
      >
        {amount}
      </Text>
    </Pressable>
  );
}

// ---- 一覧 ----

function BudgetRow({
  label,
  total,
  first,
  offLabel = '期間外',
  onPress,
}: {
  label: string;
  total: number;
  first: boolean;
  offLabel?: string;
  onPress: () => void;
}) {
  const off = total === 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, !first && styles.divided, off && styles.rowOff, pressed && styles.pressed]}
    >
      <Text style={[styles.rowLabel, off && styles.offText]} numberOfLines={1}>
        {label}
      </Text>
      {off && <Text style={styles.offBadge}>{offLabel}</Text>}
      <Text style={[styles.rowAmount, off && styles.offText]}>{formatYen(total)}</Text>
    </Pressable>
  );
}

function AddButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.addButton, pressed && styles.addPressed]}>
      <Plus size={18} color={colors.moneyText} />
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

// ---- 予算の枠 ----

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const HOLIDAYS: MoneyHolidayRule[] = ['next', 'prev', 'none'];

type FormSheet = 'group' | 'top' | 'category' | 'when' | 'period' | 'day' | 'wallet' | null;

/** 予算1件の枠（追加・編集）。分類（種類・大分類・小分類・区別）、予算（金額・いつ・期間）、自動記録。 */
function BudgetForm({
  rule,
  initialGroup,
  initialTopId,
  year,
  categories,
  wallets,
  stores,
  records,
  onCreateCategory,
  onCreateTop,
  onRenameCategory,
  onClose,
  onSubmit,
  onRemove,
}: {
  rule: MoneyRecurring | null;
  initialGroup: BudgetLineGroup;
  initialTopId: string | null;
  year: number;
  categories: MoneyCategory[];
  wallets: MoneyWallet[];
  stores: MoneyStore[];
  records: MoneyRecord[];
  onCreateCategory: (group: BudgetLineGroup, topId: string | null, name: string) => Promise<MoneyCategory | null>;
  onCreateTop: (group: BudgetLineGroup, name: string) => Promise<MoneyCategory | null>;
  onRenameCategory: (category: MoneyCategory) => void;
  onClose: () => void;
  onSubmit: (draft: MoneyRecurringDraft, group: BudgetLineGroup, topId: string | null, registerStore: boolean) => Promise<void>;
  onRemove?: () => void;
}) {
  const topsOf = (group: BudgetLineGroup) =>
    group === 'income'
      ? topCategories(categories, 'income')
      : topCategories(categories, 'living').filter((top) => spendGroupOf(top.id, categories) === group);
  const [group, setGroup] = useState<BudgetLineGroup>(initialGroup);
  const [topId, setTopId] = useState<string | null>(initialTopId ?? (choosesTop(initialGroup) ? (topsOf(initialGroup)[0]?.id ?? null) : null));
  const [categoryId, setCategoryId] = useState<string | null>(rule?.categoryId ?? null);
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
  const [holiday, setHoliday] = useState<MoneyHolidayRule>(rule?.holiday ?? (initialGroup === 'income' ? 'prev' : 'next'));
  const [walletId, setWalletId] = useState<string | null>(rule?.walletId ?? null);
  const [store, setStore] = useState(rule?.store ?? '');
  const [registerStore, setRegisterStore] = useState(false);
  // 収入の自動記録の額: 毎回同じ（確定）か、変わる（見込み）。支出は種類で決まる。
  const [incomeFixed, setIncomeFixed] = useState(rule?.amountMode === 'fixed');
  const [sheet, setSheet] = useState<FormSheet>(null);
  const [pickingStore, setPickingStore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const storeOptions = useMemo(() => storeChoices(stores, records, toDateString(new Date())), [stores, records]);

  const isIncome = group === 'income';
  const noMonth = mode === 'none';
  const auto = makesRecord && !noMonth;
  const top = categories.find((entry) => entry.id === topId) ?? null;
  const selectedCategory = categories.find((entry) => entry.id === categoryId) ?? null;
  // 小分類の選択肢。変動費・収入は選んだ大分類（まとめての予算は大分類そのもの）、ほかはその種類の小分類。
  const categoryChoices: { category: MoneyCategory; label: string }[] = choosesTop(group)
    ? top
      ? [{ category: top, label: 'まとめて（大分類）' }, ...childCategories(categories, top.id).map((entry) => ({ category: entry, label: entry.name }))]
      : []
    : topsOf(group).flatMap((entry) => childCategories(categories, entry.id).map((child) => ({ category: child, label: child.name })));
  const categoryLabel = selectedCategory === null ? '選ぶ' : selectedCategory.parentId === null ? 'まとめて（大分類）' : selectedCategory.name;

  const changeGroup = (next: BudgetLineGroup) => {
    setSheet(null);
    if (next === group) return;
    setGroup(next);
    setTopId(choosesTop(next) ? (topsOf(next)[0]?.id ?? null) : null);
    // 小分類は、収入と支出をまたぐか、大分類そのもの（まとめて）なら選び直す。ほかは保存のときに選んだ種類へ移す。
    const own = selectedCategory;
    if (own === null || own.parentId === null || (own.kind === 'income') !== (next === 'income')) setCategoryId(null);
  };

  const build = (): MoneyRecurringDraft | string => {
    if (choosesTop(group) && topId === null) return '大分類を選んでください';
    if (categoryId === null) return '小分類を選んでください';
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
      kind: isIncome ? 'income' : 'expense',
      day,
      weekOfMonth: auto && byWeekday ? weekOfMonth : null,
      weekday: auto && byWeekday ? weekday : null,
      months: mode === 'months' ? months : null,
      startMonth,
      endMonth,
      holiday,
      amountMode: group === 'income' ? (incomeFixed ? 'fixed' : 'estimate') : amountModeOfGroup(group),
      amount,
      walletId,
      toWalletId: null,
      store: isIncome ? '' : store,
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
      await onSubmit(result, group, choosesTop(group) ? topId : null, result.store !== '' && registerStore);
    } finally {
      setSaving(false);
    }
  };

  if (pickingStore) {
    return (
      <StorePicker
        value={store}
        registered={storeOptions.registered}
        others={storeOptions.others}
        canRegister
        onPick={(value, register) => {
          setStore(value);
          setRegisterStore(register);
          setPickingStore(false);
        }}
        onClose={() => setPickingStore(false)}
      />
    );
  }

  const when = noMonth ? '発生月なし' : mode === 'monthly' ? '毎月' : months.length === 0 ? '選ぶ' : monthsLabel(months);
  const whenValue = byInterval ? `${when}・${intervalText.trim() || '?'}年ごと` : when;
  const periodValue = startText.trim() === '' && endText.trim() === '' ? 'ずっと' : `${startText.trim()}〜${endText.trim()}`;
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
      <ScreenHeader title={rule ? '予算を直す' : '予算を追加'} icon="back" onClose={onClose} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.groupTitle}>分類</Text>
        <View style={styles.group}>
          <SettingRow first label="種類" value={GROUP_LABEL[group]} onPress={() => setSheet('group')} />
          {choosesTop(group) && <SettingRow label="大分類" value={top?.name ?? '選ぶ'} placeholder={top === null} onPress={() => setSheet('top')} />}
          <SettingRow label="小分類" value={categoryLabel} placeholder={selectedCategory === null} onPress={() => setSheet('category')} />
          <View style={[styles.item, styles.divided]}>
            <Text style={styles.settingLabel}>区別</Text>
            <TextInput
              style={styles.inlineInput}
              value={name}
              onChangeText={setName}
              placeholder="任意（例: 妻・時短）"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </View>

        <Text style={styles.groupTitle}>予算</Text>
        <View style={styles.group}>
          <View style={styles.item}>
            <Text style={styles.settingLabel}>金額</Text>
            <TextInput
              style={[styles.inlineInput, styles.amountInput]}
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
        </View>

        <Text style={styles.groupTitle}>自動記録</Text>
        <View style={styles.group}>
          <View style={styles.item}>
            <Text style={[styles.settingLabel, styles.flex]}>自動で記録する</Text>
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
              <SettingRow
                label={isIncome ? '振込日' : '日'}
                value={dayValue === '選ぶ' ? '選ぶ' : `${dayValue}（${HOLIDAY_RULE_LABEL[holiday]}）`}
                placeholder={dayValue === '選ぶ'}
                onPress={() => setSheet('day')}
              />
              <SettingRow label={isIncome ? '入金先' : '出金元'} value={wallet?.name ?? '選ぶ'} placeholder={!wallet} onPress={() => setSheet('wallet')} />
              {isIncome ? (
                <View style={[styles.item, styles.divided]}>
                  <Text style={[styles.settingLabel, styles.flex]}>毎回同じ額</Text>
                  <Switch
                    value={incomeFixed}
                    onValueChange={setIncomeFixed}
                    trackColor={{ true: colors.money, false: colors.borderStrong }}
                    thumbColor={colors.surface}
                  />
                </View>
              ) : (
                <SettingRow label="お店" value={store || 'なし'} placeholder={store === ''} onPress={() => setPickingStore(true)} />
              )}
            </>
          )}
        </View>

        {preview && (
          <View style={styles.total}>
            <Text style={styles.totalLabel}>{formatYear(year)}</Text>
            <Text style={styles.totalValue}>{`${formatYen(preview.total)}（${preview.count}回）`}</Text>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
        <PrimaryButton label="保存する" disabled={saving} onPress={() => void submit()} />
        {onRemove && (
          <Pressable accessibilityRole="button" onPress={onRemove} style={styles.linkRow}>
            <Text style={styles.dangerText}>この予算を消す</Text>
          </Pressable>
        )}
      </ScrollView>

      {sheet === 'group' && (
        <SheetModal visible onClose={() => setSheet(null)}>
          <LogModalShell title="種類" onClose={() => setSheet(null)}>
            <View style={styles.options}>
              {GROUPS.map((entry, index) => (
                <OptionRow key={entry} first={index === 0} label={GROUP_LABEL[entry]} selected={entry === group} onPress={() => changeGroup(entry)} />
              ))}
            </View>
          </LogModalShell>
        </SheetModal>
      )}
      {sheet === 'top' && (
        <NameSheet
          title="大分類"
          placeholder="新しい大分類の名前"
          choices={topsOf(group).map((entry) => ({ id: entry.id, label: entry.name }))}
          selectedId={topId}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setTopId(id);
            // まとめて（大分類）を選んでいたら、選んだ大分類のまとめてにする。
            if (selectedCategory !== null && selectedCategory.parentId === null) setCategoryId(id);
            setSheet(null);
          }}
          onCreate={async (newName) => {
            const created = await onCreateTop(group, newName);
            if (created) {
              setTopId(created.id);
              if (selectedCategory !== null && selectedCategory.parentId === null) setCategoryId(created.id);
            }
            setSheet(null);
          }}
        />
      )}
      {sheet === 'category' && (
        <NameSheet
          title="小分類"
          placeholder="新しい小分類の名前"
          choices={categoryChoices.map((entry) => ({ id: entry.category.id, label: entry.label }))}
          selectedId={categoryId}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            setCategoryId(id);
            setSheet(null);
          }}
          onCreate={async (newName) => {
            const created = await onCreateCategory(group, topId, newName);
            if (created) setCategoryId(created.id);
            setSheet(null);
          }}
          renameLabel="選んでいる小分類の名前を直す"
          onRename={
            selectedCategory !== null && selectedCategory.parentId !== null
              ? () => {
                  setSheet(null);
                  onRenameCategory(selectedCategory);
                }
              : undefined
          }
        />
      )}
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

function OptionRow({ label, selected, first, onPress }: { label: string; selected: boolean; first: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.item, !first && styles.divided, pressed && styles.pressed]}
    >
      <Text style={[styles.optionText, selected && styles.optionSelected]}>{label}</Text>
      {selected && <Text style={styles.check}>✓</Text>}
    </Pressable>
  );
}

/** 大分類・小分類を選ぶ。一番下で新しく作る。選んでいる小分類の名前もここから直す。 */
function NameSheet({
  title,
  placeholder,
  choices,
  selectedId,
  onClose,
  onPick,
  onCreate,
  onRename,
  renameLabel,
}: {
  title: string;
  placeholder: string;
  choices: { id: string; label: string }[];
  selectedId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename?: () => void;
  renameLabel?: string;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (name.trim() === '' || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim());
    } finally {
      setBusy(false);
    }
  };
  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell title={title} onClose={onClose}>
        <View style={styles.options}>
          {choices.map((entry, index) => (
            <OptionRow key={entry.id} first={index === 0} label={entry.label} selected={entry.id === selectedId} onPress={() => onPick(entry.id)} />
          ))}
          <View style={[styles.item, choices.length > 0 && styles.divided]}>
            <Plus size={16} color={colors.money} />
            <TextInput
              style={[styles.inlineInput, styles.newInput]}
              value={name}
              onChangeText={setName}
              placeholder={placeholder}
              placeholderTextColor={colors.textFaint}
              returnKeyType="done"
              onSubmitEditing={() => void create()}
            />
            {name.trim() !== '' && (
              <Pressable accessibilityRole="button" onPress={() => void create()} hitSlop={8}>
                <Text style={styles.linkText}>作る</Text>
              </Pressable>
            )}
          </View>
        </View>
        {onRename && (
          <Pressable accessibilityRole="button" onPress={onRename} style={styles.linkRow}>
            <Text style={styles.linkText}>{renameLabel}</Text>
          </Pressable>
        )}
      </LogModalShell>
    </SheetModal>
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
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 12 },
  // 上の枠（影で浮かせ、下の一覧と分ける）
  overview: {
    borderRadius: 16,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    shadowColor: '#111827',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  donut: { alignItems: 'center', paddingBottom: 6 },
  legend: { flexDirection: 'row', alignItems: 'center', paddingVertical: 3, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 8 },
  legendMain: { paddingVertical: 5 },
  legendSelected: { backgroundColor: colors.moneySoft },
  legendSwatch: { width: 9, height: 9, borderRadius: 2, marginRight: 6 },
  legendLabel: { width: 100, fontSize: 14, fontWeight: '500', color: colors.textSubtle },
  legendMainLabel: { width: 100, fontSize: 15, fontWeight: '800', color: colors.text },
  legendPercent: { width: 56, textAlign: 'right', fontSize: 12, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  legendAmount: { flex: 1, textAlign: 'right', fontSize: 14, fontWeight: '600', color: colors.text, fontVariant: ['tabular-nums'] },
  legendMainAmount: { flex: 1, textAlign: 'right', fontSize: 16, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  selectedText: { color: colors.moneyText },
  // 一覧（見出しで区切る。行は枠を付けず、線だけ）
  section: { gap: 4 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 2,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
  },
  sectionHeadIncome: { borderBottomColor: colors.moneyIncome },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  sectionTotal: { fontSize: 18, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4, paddingVertical: 11 },
  rowOff: { backgroundColor: colors.neutralSurface },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  rowAmount: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  offText: { color: colors.textMuted },
  offBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSubtle,
    backgroundColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 6,
    overflow: 'hidden',
  },
  empty: { fontSize: 13, fontWeight: '500', color: colors.textFaint, paddingVertical: 10, paddingHorizontal: 4 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: colors.moneySoft,
    marginTop: 8,
  },
  addPressed: { opacity: 0.8 },
  addText: { fontSize: 15, fontWeight: '700', color: colors.moneyText },
  topTotal: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 4 },
  topTotalValue: { fontSize: 22, fontWeight: '800', color: colors.text, fontVariant: ['tabular-nums'] },
  topTotalNote: { fontSize: 13, fontWeight: '600', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  // 予算の枠
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, paddingHorizontal: 4, marginBottom: -6 },
  group: { borderRadius: 12, backgroundColor: colors.surface, overflow: 'hidden' },
  options: { borderRadius: 12, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 46 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  pressed: { backgroundColor: colors.background },
  settingLabel: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
  settingValue: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '600', color: colors.text },
  mutedValue: { color: colors.textFaint, fontWeight: '500' },
  inlineInput: { flex: 1, textAlign: 'right', fontSize: 15, fontWeight: '500', color: colors.text, paddingVertical: 0 },
  amountInput: { fontSize: 16, fontWeight: '700' },
  newInput: { textAlign: 'left' },
  yen: { fontSize: 15, fontWeight: '500', color: colors.textMuted },
  optionText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  optionSelected: { fontWeight: '700' },
  check: { fontSize: 15, fontWeight: '700', color: colors.money },
  total: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  totalLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  totalValue: { fontSize: 15, fontWeight: '700', color: colors.text, fontVariant: ['tabular-nums'] },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  linkRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  linkText: { fontSize: 14, fontWeight: '700', color: colors.money },
  dangerText: { fontSize: 14, fontWeight: '700', color: colors.danger },
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
