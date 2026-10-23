'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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
import { createClient } from '@/lib/supabase/client';
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
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import StorePicker from './StorePicker';
import { Chip, ChipRow, Field, WalletChoices } from './feedParts';
import { CategoryIcon, FullScreen, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 年間予算（docs/kakei.md §0.8。2026-10-23）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
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

/** 種類の札の色（mobile の GROUP_TONE と同じ色）。 */
const GROUP_TONE: Record<BudgetLineGroup, { tag: string; dot: string }> = {
  income: { tag: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-700' },
  variable: { tag: 'bg-blue-100 text-blue-800', dot: 'bg-blue-800' },
  confirmed: { tag: 'bg-purple-100 text-purple-600', dot: 'bg-purple-600' },
  estimate: { tag: 'bg-amber-100 text-amber-800', dot: 'bg-amber-800' },
  reserve: { tag: 'bg-red-100 text-red-700', dot: 'bg-red-700' },
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

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const groupClass = 'overflow-hidden rounded-xl bg-white';
const itemClass = 'flex w-full min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50';
const dividedClass = 'border-t border-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

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
  const supabase = useMemo(() => createClient(), []);
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
  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');

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

  const removeRule = async (rule: MoneyRecurring, after: () => void) => {
    if (!window.confirm('この予算を消しますか？\nすべての年から消えます。自動で作った記録はそのまま残ります。')) return;
    try {
      await deleteMoneyRecurring(supabase, rule.id);
      onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
      after();
    } catch {
      failed();
    }
  };

  /** 種類が変わった行の、自動記録の確定／見込みを直す（支出だけ）。 */
  const followGroup = async (categoryIds: readonly string[], group: SpendGroup) => {
    const mode = amountModeOfGroup(group);
    for (const rule of rows.filter((entry) => entry.kind === 'expense' && categoryIds.includes(entry.categoryId as string))) {
      if (rule.amountMode !== mode) putRule(await updateMoneyRecurring(supabase, rule.id, { ...draftOf(rule), amountMode: mode }));
    }
  };

  /** その種類の大分類を作る（その種類の大分類が1つも無いとき）。 */
  const createTop = async (group: Exclude<SpendGroup, 'variable'>): Promise<MoneyCategory> => {
    const name = NEW_TOP_NAME[group];
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
        topId = found ? found.id : (await createTop(group as Exclude<SpendGroup, 'variable'>)).id;
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

  /** 固定費・予備費の小分類を作る。その種類の大分類の下に作る（無ければ大分類も作る）。 */
  const createInGroup = async (group: Exclude<SpendGroup, 'variable'>, name: string) => {
    const found = topCategories(categories, 'living').find((top) => spendGroupOf(top.id, categories) === group);
    if (found) return createCategory('living', found.id, name);
    setSheet(null);
    try {
      const top = await createTop(group);
      const child = await insertMoneyCategory(supabase, familyId, { kind: 'living', parentId: top.id, name, icon: null, position: 0 });
      onCategories((prev) => [...prev, child]);
      push({ type: 'category', categoryId: child.id });
    } catch {
      failed();
    }
  };

  /** 小分類を使わなくする（その予算も使わなくする。記録は残る）。 */
  const archiveCategory = async (target: MoneyCategory) => {
    if (!window.confirm(`${target.name}を使わなくしますか？\n予算と自動記録も止まります。記録はそのまま残ります。`)) return;
    try {
      putCategory(await updateMoneyCategory(supabase, target.id, { archived: true }));
      for (const rule of rowsOf(target.id)) putRule(await setMoneyRecurringArchived(supabase, rule.id, true));
      pop();
    } catch {
      failed();
    }
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
        onRemove={rule ? () => void removeRule(rule, back) : undefined}
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
        <div className="space-y-1">
          {own.length === 1 && (
            <button
              type="button"
              onClick={() => push({ type: 'row', ruleId: null, categoryId: target.id })}
              className="flex w-full items-center justify-center gap-1.5 py-2.5 text-sm font-bold text-blue-600"
            >
              <Plus size={16} />
              予算を足す（同じ小分類で別の額・月）
            </button>
          )}
          <button type="button" onClick={() => void archiveCategory(target)} className="w-full py-2.5 text-sm font-bold text-red-600">
            この小分類を使わない
          </button>
        </div>,
        false,
        () => undefined,
      );
    } else {
      body = (
        <>
          {header(target)}
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-3">
            <div className={groupClass}>
              {own.map((rule, index) => (
                <ItemRow
                  key={rule.id}
                  first={index === 0}
                  label={rule.name.trim() || `${index + 1}件目`}
                  note={budgetRowNote(rule)}
                  value={formatYen(rule.amount)}
                  onClick={() => push({ type: 'row', ruleId: rule.id, categoryId: target.id })}
                />
              ))}
              <AddRow label="追加" onClick={() => push({ type: 'row', ruleId: null, categoryId: target.id })} />
            </div>
            <TotalLine label={formatYear(year)} value={formatYen(sumOf(own))} />
            <button type="button" onClick={() => void archiveCategory(target)} className="w-full py-2.5 text-sm font-bold text-red-600">
              この小分類を使わない
            </button>
          </div>
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
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-3">
            <p className="px-1 text-[13px] font-bold text-gray-500">月の予算（まとめて）</p>
            <div className={groupClass}>
              {own.map((rule, index) => (
                <ItemRow
                  key={rule.id}
                  first={index === 0}
                  label={whenLabel(rule)}
                  note={rule.name.trim() || undefined}
                  value={formatYen(rule.amount)}
                  onClick={() => push({ type: 'row', ruleId: rule.id, categoryId: top.id })}
                />
              ))}
              <AddRow first={own.length === 0} label="追加" onClick={() => push({ type: 'row', ruleId: null, categoryId: top.id })} />
            </div>
            <p className="px-1 text-[13px] font-bold text-gray-500">小分類</p>
            <div className={groupClass}>
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
                    onClick={() => push({ type: 'category', categoryId: child.id })}
                  />
                );
              })}
              <AddRow first={children.length === 0} label="追加" onClick={() => setSheet({ type: 'add', group: 'child', parentId: top.id })} />
            </div>
            {entry && (
              <>
                <TotalLine label={formatYear(year)} value={formatYen(entry.total)} />
                <p className="px-1 text-xs leading-relaxed text-gray-500">月の予算は、まとめての予算に小分類の予算を足したもの</p>
              </>
            )}
          </div>
        </>
      );
    }
  } else {
    const groupSection = (group: Exclude<BudgetLineGroup, 'variable' | 'income'>) => {
      const entries = groupEntries(group);
      return (
        <section key={group} className="space-y-1.5">
          <SectionTitle group={group} total={totals[group]} />
          <div className={groupClass}>
            {entries.map((entry, index) => (
              <ItemRow
                key={entry.category.id}
                first={index === 0}
                label={entry.category.name}
                note={entry.rules.length === 1 ? budgetRowNote(entry.rules[0]) : `${entry.rules.length}件`}
                value={formatYen(entry.total)}
                onClick={() => push({ type: 'category', categoryId: entry.category.id })}
              />
            ))}
            <AddRow first={entries.length === 0} label="追加" onClick={() => setSheet({ type: 'add', group })} />
          </div>
        </section>
      );
    };
    const orphanRows = orphans.filter((rule) => rule.kind === tab);
    body = (
      <>
        <ScreenHeader title="年間予算" onClose={onClose} />
        <div className="shrink-0 flex items-center gap-2 px-4 py-2">
          <button type="button" aria-label="前の年" onClick={() => setYear((current) => current - 1)} className={yearButtonClass}>
            <ChevronLeft size={18} />
          </button>
          <span className="text-base font-bold text-gray-900 tabular-nums">{formatYear(year)}</span>
          <button type="button" aria-label="次の年" onClick={() => setYear((current) => current + 1)} className={yearButtonClass}>
            <ChevronRight size={18} />
          </button>
          <span className="flex-1" />
          <span className="text-xs font-semibold text-gray-500">収支見込み</span>
          <span className={`text-base font-extrabold tabular-nums ${plan > 0 ? 'text-[#43b02a]' : 'text-gray-900'}`}>
            {plan < 0 ? '−' : plan > 0 ? '＋' : ''}
            {formatYen(plan)}
          </span>
        </div>
        <div role="tablist" className="shrink-0 mx-4 mb-2 grid grid-cols-2 rounded-lg bg-gray-100 p-[3px]">
          {(['income', 'expense'] as const).map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={tab === entry}
              onClick={() => setTab(entry)}
              className={`rounded-md py-1.5 text-[13px] font-bold tabular-nums ${tab === entry ? 'bg-white text-gray-900' : 'text-gray-500'}`}
            >
              {entry === 'income' ? `収入 ${formatYen(totals.income)}` : `支出 ${formatYen(expenseTotal)}`}
            </button>
          ))}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-3">
          {tab === 'income' ? (
            <section className="space-y-1.5">
              <SectionTitle group="income" total={totals.income} />
              <div className={groupClass}>
                {incomeEntries.map((entry, index) => (
                  <ItemRow
                    key={entry.category.id}
                    first={index === 0}
                    label={entry.category.parentId === null ? entry.category.name : `${category(entry.category.parentId)?.name ?? ''} › ${entry.category.name}`}
                    note={entry.rules.length === 1 ? budgetRowNote(entry.rules[0]) : `${entry.rules.length}件`}
                    value={formatYen(entry.total)}
                    onClick={() => push({ type: 'category', categoryId: entry.category.id })}
                  />
                ))}
                <AddRow first={incomeEntries.length === 0} label="追加" onClick={() => setSheet({ type: 'add', group: 'income' })} />
              </div>
            </section>
          ) : (
            <>
              <section className="space-y-1.5">
                <SectionTitle group="variable" total={totals.variable} />
                <div className={groupClass}>
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
                        onClick={() => push({ type: 'top', topId: entry.top.id })}
                      />
                    );
                  })}
                  <AddRow first={variableTops.length === 0} label="追加" onClick={() => setSheet({ type: 'add', group: 'variable' })} />
                </div>
              </section>
              {groupSection('confirmed')}
              {groupSection('estimate')}
              {groupSection('reserve')}
            </>
          )}
          {orphanRows.length > 0 && (
            <section className="space-y-1.5">
              <p className="px-1 text-[13px] font-bold text-gray-500">カテゴリなし（押してカテゴリを決める）</p>
              <div className={groupClass}>
                {orphanRows.map((rule, index) => (
                  <ItemRow
                    key={rule.id}
                    first={index === 0}
                    label={rule.name.trim() || (rule.kind === 'income' ? '収入' : '支出')}
                    note={budgetRowNote(rule)}
                    value={formatYen(yearTotal(rule))}
                    onClick={() => push({ type: 'row', ruleId: rule.id, categoryId: null })}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </>
    );
  }

  const sheetTarget = sheet !== null && sheet.type !== 'add' ? category(sheet.categoryId) : null;

  return (
    <FullScreen onBack={onClose}>
      {stack.length > 1 ? (
        // 1つ奥の画面ごとに、戻る操作で1つ前の画面へ戻す層を積む。
        <StackedScreen key={stack.length} onBack={pop}>
          {body}
        </StackedScreen>
      ) : (
        body
      )}
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
            void createInGroup(sheet.group, name);
          }}
        />
      )}
    </FullScreen>
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
  return (
    <div className="shrink-0 flex items-center gap-2.5 border-b border-gray-200 bg-white px-4 py-3">
      <button type="button" aria-label="戻る" onClick={onBack} className="text-gray-700">
        <ArrowLeft size={22} />
      </button>
      <button type="button" aria-label={`${title}の名前を直す`} onClick={onRename} className="min-w-0 truncate text-left text-lg font-bold text-gray-900">
        {title}
      </button>
      <button
        type="button"
        aria-label="種類を変える"
        disabled={!onGroup}
        onClick={onGroup}
        className={`flex shrink-0 items-center gap-0.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${GROUP_TONE[group].tag}`}
      >
        {GROUP_LABEL[group]}
        {onGroup && <ChevronDown size={12} />}
      </button>
    </div>
  );
}

function SectionTitle({ group, total }: { group: BudgetLineGroup; total: number }) {
  return (
    <div className="flex items-center gap-1.5 px-1">
      <span className={`h-2 w-2 rounded-full ${GROUP_TONE[group].dot}`} />
      <span className="text-[13px] font-bold text-gray-500">{GROUP_LABEL[group]}</span>
      <span className="flex-1" />
      <span className="text-[13px] font-bold tabular-nums text-gray-500">{formatYen(total)}</span>
    </div>
  );
}

function ItemRow({
  label,
  note,
  value,
  first,
  muted,
  icon,
  onClick,
}: {
  label: string;
  note?: string;
  value: string;
  first: boolean;
  muted?: boolean;
  icon?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className={`${itemClass} ${first ? '' : dividedClass}`}>
      {icon && <CategoryIcon iconKey={icon} size={26} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-gray-900">{label}</span>
        {note && <span className="block truncate text-xs text-gray-500">{note}</span>}
      </span>
      <span className={`shrink-0 text-[15px] tabular-nums ${muted ? 'font-medium text-gray-400' : 'font-bold text-gray-900'}`}>{value}</span>
      <ChevronRight size={16} className="shrink-0 text-gray-400" />
    </button>
  );
}

function AddRow({ label, onClick, first }: { label: string; onClick: () => void; first?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`${itemClass} ${first ? '' : dividedClass} font-bold text-blue-600`}>
      <Plus size={16} />
      <span className="text-[15px]">{label}</span>
    </button>
  );
}

function TotalLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-1 text-[15px] font-bold text-gray-900">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

/** 「項目 ……… 値 ›」の1行（押すと選ぶ画面）。 */
function SettingRow({
  label,
  value,
  onClick,
  first,
  placeholder,
}: {
  label: string;
  value: string;
  onClick: () => void;
  first?: boolean;
  placeholder?: boolean;
}) {
  return (
    <button type="button" aria-label={`${label}を選ぶ`} onClick={onClick} className={`${itemClass} ${first ? '' : dividedClass}`}>
      <span className="text-[15px] font-medium text-gray-500">{label}</span>
      <span className={`min-w-0 flex-1 truncate text-right text-[15px] ${placeholder ? 'font-medium text-gray-400' : 'font-semibold text-gray-900'}`}>
        {value}
      </span>
      <ChevronRight size={16} className="shrink-0 text-gray-400" />
    </button>
  );
}

/** 入・切のつまみ。 */
function Switch({ label, value, disabled, onChange }: { label: string; value: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={value}
      disabled={disabled}
      onClick={() => onChange(!value)}
      className={`relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-40 ${value ? 'bg-blue-600' : 'bg-gray-300'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} />
    </button>
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
      <StackedScreen onBack={() => setPicking(null)}>
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
      </StackedScreen>
    );
  }
  if (picking === 'category') {
    return (
      <StackedScreen onBack={() => setPicking(null)}>
        <CategoryPicker
          kind={kind}
          categories={categories}
          onPick={(choice) => {
            setCategoryId(choice.categoryId);
            setPicking(null);
          }}
          onClose={() => setPicking(null)}
        />
      </StackedScreen>
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
  const toggleMonth = (month: number) =>
    setMonths((prev) => (prev.includes(month) ? prev.filter((value) => value !== month) : [...prev, month].sort((a, b) => a - b)));

  return (
    <>
      {title}
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-3">
        {initialCategoryId === null && (
          <div className={groupClass}>
            <SettingRow
              first
              label="カテゴリ"
              value={categoryId === null ? '選ぶ' : (categories.find((entry) => entry.id === categoryId)?.name ?? '選ぶ')}
              placeholder={categoryId === null}
              onClick={() => setPicking('category')}
            />
          </div>
        )}
        <div className={groupClass}>
          <label className="flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5">
            <span className="text-[15px] font-medium text-gray-500">金額</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-right text-base font-bold tabular-nums text-gray-900 focus:outline-none"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="numeric"
              placeholder="0"
              aria-label="金額"
            />
            <span className="text-[15px] text-gray-500">円</span>
          </label>
          <SettingRow label="いつ" value={whenValue} onClick={() => setSheet('when')} />
          <SettingRow label="期間" value={periodValue} placeholder={periodValue === 'ずっと'} onClick={() => setSheet('period')} />
          {showName && (
            <label className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
              <span className="text-[15px] font-medium text-gray-500">区別</span>
              <input
                className="min-w-0 flex-1 bg-transparent text-right text-[15px] text-gray-900 focus:outline-none"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="任意（例: 妻・時短）"
                aria-label="区別"
              />
            </label>
          )}
        </div>

        <div className={groupClass}>
          <div className="flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5">
            <span className="flex-1 text-[15px] font-medium text-gray-500">自動記録</span>
            <Switch label="自動記録" value={auto} disabled={noMonth} onChange={setMakesRecord} />
          </div>
          {auto && (
            <>
              <SettingRow
                label={isIncome ? '振込日' : '日'}
                value={`${dayValue}（${HOLIDAY_RULE_LABEL[holiday]}）`}
                placeholder={dayValue === '選ぶ'}
                onClick={() => setSheet('day')}
              />
              <SettingRow label={isIncome ? '入金先' : '出金元'} value={wallet?.name ?? '選ぶ'} placeholder={!wallet} onClick={() => setSheet('wallet')} />
              {!isIncome && <SettingRow label="お店" value={store || 'なし'} placeholder={store === ''} onClick={() => setPicking('store')} />}
              {isIncome && (
                <div className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
                  <span className="flex-1 text-[15px] font-medium text-gray-500">毎回同じ額</span>
                  <Switch label="毎回同じ額" value={incomeFixed} onChange={setIncomeFixed} />
                </div>
              )}
            </>
          )}
        </div>
        <p className="px-1 text-xs leading-relaxed text-gray-500">
          {noMonth
            ? '発生月なしは自動記録できません'
            : auto
              ? group === 'estimate' || group === 'variable' || (isIncome && !incomeFixed)
                ? 'その日に見込みの記録を作ります（額は過去の記録から。無ければこの金額）'
                : 'その日にこの金額で記録を作ります'
              : group === 'confirmed' || group === 'estimate'
                ? '記録は作りません。発生月に記録が無ければ、月の締めで知らせます'
                : '記録は作りません'}
        </p>

        {preview && <TotalLine label={formatYear(year)} value={`${formatYen(preview.total)}（${preview.count}回）`} />}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <PrimaryButton label="保存する" disabled={saving} onClick={() => void submit()} />
        {onRemove && (
          <button type="button" onClick={onRemove} className="w-full py-2.5 text-sm font-bold text-red-600">
            この予算を消す
          </button>
        )}
        {extra}
      </div>

      {sheet === 'when' && (
        <ModalShell title="いつ" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onClick={() => setSheet(null)} />}>
          <div className="space-y-4">
            <Field label="発生月">
              <ChipRow>
                <Chip label="毎月" selected={mode === 'monthly'} onClick={() => setMode('monthly')} />
                <Chip label="月を選ぶ" selected={mode === 'months'} onClick={() => setMode('months')} />
                <Chip label="発生月なし" selected={mode === 'none'} onClick={() => setMode('none')} />
              </ChipRow>
              {mode === 'months' && (
                <ChipRow>
                  {MONTHS.map((month) => (
                    <Chip key={month} label={`${month}月`} selected={months.includes(month)} onClick={() => toggleMonth(month)} />
                  ))}
                </ChipRow>
              )}
            </Field>
            <Field label="頻度" hint={byInterval ? '期間の始まりの年から数えます' : undefined}>
              <ChipRow>
                <Chip label="毎年" selected={!byInterval} onClick={() => setByInterval(false)} />
                <Chip label="◯年ごと" selected={byInterval} onClick={() => setByInterval(true)} />
              </ChipRow>
              {byInterval && (
                <div className="flex items-center gap-2">
                  <input
                    className={`${inputClass} w-16 text-right tabular-nums`}
                    value={intervalText}
                    onChange={(event) => setIntervalText(event.target.value)}
                    inputMode="numeric"
                    placeholder="2"
                    aria-label="何年ごと"
                  />
                  <span className="text-sm font-semibold text-gray-500">年ごと</span>
                </div>
              )}
            </Field>
          </div>
        </ModalShell>
      )}
      {sheet === 'period' && (
        <ModalShell title="期間" onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onClick={() => setSheet(null)} />}>
          <Field label="始まり〜終わり（空ならずっと）">
            <div className="flex items-center gap-2">
              <input className={inputClass} value={startText} onChange={(event) => setStartText(event.target.value)} placeholder="例: 2027/9" aria-label="始まり" />
              <span className="text-sm font-semibold text-gray-500">〜</span>
              <input className={inputClass} value={endText} onChange={(event) => setEndText(event.target.value)} placeholder="例: 2033/3" aria-label="終わり" />
            </div>
          </Field>
        </ModalShell>
      )}
      {sheet === 'day' && (
        <ModalShell title={isIncome ? '振込日' : '日'} onClose={() => setSheet(null)} footer={<PrimaryButton label="決める" onClick={() => setSheet(null)} />}>
          <div className="space-y-4">
            <ChipRow>
              <Chip label="日にち" selected={!byWeekday} onClick={() => setByWeekday(false)} />
              <Chip label="第◯◯曜日" selected={byWeekday} onClick={() => setByWeekday(true)} />
            </ChipRow>
            {byWeekday ? (
              <>
                <ChipRow>
                  {WEEK_OF_MONTH_OPTIONS.map((option) => (
                    <Chip key={option.value} label={option.label} selected={weekOfMonth === option.value} onClick={() => setWeekOfMonth(option.value)} />
                  ))}
                </ChipRow>
                <ChipRow>
                  {WEEKDAY_LABELS.map((label, index) => (
                    <Chip key={label} label={`${label}曜日`} selected={weekday === index} onClick={() => setWeekday(index)} />
                  ))}
                </ChipRow>
              </>
            ) : (
              <input
                className={`${inputClass} tabular-nums`}
                value={dayText}
                onChange={(event) => setDayText(event.target.value)}
                inputMode="numeric"
                placeholder="例: 27（末日は31）"
                aria-label="日"
              />
            )}
            <Field label="休日のとき">
              <ChipRow>
                {HOLIDAYS.map((entry) => (
                  <Chip key={entry} label={HOLIDAY_RULE_LABEL[entry]} selected={holiday === entry} onClick={() => setHoliday(entry)} />
                ))}
              </ChipRow>
            </Field>
          </div>
        </ModalShell>
      )}
      {sheet === 'wallet' && (
        <ModalShell title={isIncome ? '入金先' : '出金元'} onClose={() => setSheet(null)}>
          <WalletChoices
            wallets={wallets}
            selectedId={walletId}
            onPick={(id) => {
              setWalletId(id);
              setSheet(null);
            }}
          />
        </ModalShell>
      )}
    </>
  );
}

function RenameSheet({ name, onClose, onSubmit }: { name: string; onClose: () => void; onSubmit: (name: string) => void }) {
  const [text, setText] = useState(name);
  return (
    <ModalShell title="名前を直す" onClose={onClose} footer={<PrimaryButton label="保存する" disabled={text.trim() === ''} onClick={() => onSubmit(text)} />}>
      <input className={inputClass} value={text} onChange={(event) => setText(event.target.value)} autoFocus placeholder="名前" aria-label="名前" />
    </ModalShell>
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
    <ModalShell title={choosingTop ? '変動費のどの大分類に入れるか' : '種類'} onClose={onClose}>
      {choosingTop ? (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {variableTops.map((top, index) => (
            <button key={top.id} type="button" onClick={() => onPick('variable', top.id)} className={`${itemClass} ${index > 0 ? dividedClass : ''}`}>
              <CategoryIcon iconKey={iconKeyOf(top)} size={24} />
              <span className="flex-1 text-[15px] font-semibold text-gray-900">{top.name}</span>
              {top.id === currentTopId && <span className="text-[15px] font-bold text-blue-600">✓</span>}
            </button>
          ))}
          {variableTops.length === 0 && <p className="p-3 text-xs text-gray-500">変動費の大分類がありません</p>}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {SPEND_GROUPS.map((group, index) => (
            <button
              key={group}
              type="button"
              onClick={() => {
                if (group === 'variable' && !isTop) return setChoosingTop(true);
                if (group === current) return onClose();
                onPick(group);
              }}
              className={`${itemClass} ${index > 0 ? dividedClass : ''}`}
            >
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${GROUP_TONE[group].tag}`}>{GROUP_LABEL[group]}</span>
              <span className="flex-1 text-xs text-gray-500">{GROUP_NOTE[group]}</span>
              {group === current && <span className="text-[15px] font-bold text-blue-600">✓</span>}
            </button>
          ))}
        </div>
      )}
    </ModalShell>
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
    <ModalShell
      title={title}
      onClose={onClose}
      footer={
        <PrimaryButton
          label="新しく作る"
          disabled={name.trim() === '' || (group === 'income' && createParent === null)}
          onClick={() => onCreate(name.trim(), createParent)}
        />
      }
    >
      <div className="space-y-4">
        {choices.length > 0 && (
          <Field label="予算の無い小分類から選ぶ">
            <ChipRow>
              {choices.map((entry) => (
                <Chip key={entry.id} label={entry.name} selected={false} onClick={() => onPick(entry.id)} />
              ))}
            </ChipRow>
          </Field>
        )}
        {group === 'income' && incomeTops.length > 0 && (
          <Field label="新しく作る小分類の大分類">
            <ChipRow>
              {incomeTops.map((top) => (
                <Chip key={top.id} label={top.name} selected={incomeTop === top.id} onClick={() => setIncomeTop(top.id)} />
              ))}
            </ChipRow>
          </Field>
        )}
        <Field label={group === 'variable' ? '大分類の名前' : '新しい小分類の名前'}>
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="例: 誕生日お祝い" aria-label="名前" />
        </Field>
      </div>
    </ModalShell>
  );
}
