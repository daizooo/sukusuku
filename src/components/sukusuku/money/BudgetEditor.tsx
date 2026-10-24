'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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
import { ModalShell } from '../modals/TaskForm';
import StorePicker from './StorePicker';
import { Chip, ChipRow, Field, WalletChoices } from './feedParts';
import { FullScreen, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 年間予算（docs/kakei.md §0.8。2026-10-24）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
//
// 予算が本体。予算1件＝自動記録ルールの表（money_recurring）の1行で、「単価 × その年に発生する回数」。自動記録はその行のオン／オフ。
// - 上の枠: 円グラフ（1周＝収入）。支出の種類を青の濃淡で並べ、残りが収支見込み（緑）。赤字の年は、支出の種類を1周に並べ、
//   収入からはみ出した分を外側の赤い弧で出す。円の下に収支見込み・収入・支出と、支出の種類（収入に対する割合）。
//   行を押すと、下の一覧はその種類だけになる（もう一度押すと全部）
// - 下の一覧: 収入・変動費・固定費（確定）・固定費（見込み）・予備費の見出しごと（見出しを押すと折りたたむ）。収入の見出しの下線は緑、
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
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onRecurring: (update: (prev: MoneyRecurring[]) => MoneyRecurring[]) => void;
  onStores: (update: (prev: MoneyStore[]) => MoneyStore[]) => void;
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

const SPEND_GROUPS: SpendGroup[] = ['variable', 'confirmed', 'estimate', 'reserve'];
const GROUPS: BudgetLineGroup[] = ['income', ...SPEND_GROUPS];

/** 円グラフの色（支出の種類は青の濃淡。収支見込みは収入の緑、赤字は赤）。mobile と同じ。 */
const PART_COLOR: Record<SpendGroup, string> = {
  variable: '#1e3a8a',
  confirmed: '#3b82f6',
  estimate: '#93c5fd',
  reserve: '#cbd5e1',
};
const INCOME_COLOR = '#43b02a';
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

type Screen = { type: 'list' } | { type: 'top'; topId: string } | { type: 'form'; ruleId: string | null; group?: BudgetLineGroup; topId?: string };

const byPosition = (a: MoneyRecurring, b: MoneyRecurring) => a.position - b.position;

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
  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');

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

  const removeRule = async (rule: MoneyRecurring) => {
    if (!window.confirm('この予算を消しますか？\nすべての年から消えます。自動で作った記録はそのまま残ります。')) return;
    try {
      await deleteMoneyRecurring(supabase, rule.id);
      onRecurring((prev) => prev.filter((entry) => entry.id !== rule.id));
      pop();
    } catch {
      failed();
    }
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
        onRenameCategory={setRenaming}
        onClose={pop}
        onSubmit={async (draft, group, topId, registerStore) => {
          if (await saveBudget(rule, draft, group, topId, registerStore)) pop();
        }}
        onRemove={rule ? () => void removeRule(rule) : undefined}
      />
    );
  } else if (screen.type === 'top') {
    const top = category(screen.topId);
    const own = top ? rows.filter((rule) => rule.categoryId === top.id || category(rule.categoryId)?.parentId === top.id) : [];
    const list = own.map((rule) => ({ rule, total: yearTotal(rule) })).sort((a, b) => Number(a.total === 0) - Number(b.total === 0));
    const total = top ? (variableTops.find((entry) => entry.top.id === top.id)?.total ?? 0) : 0;
    body = (
      <>
        <ScreenHeader title={top?.name ?? '変動費'} icon="back" onClose={pop} />
        {top && (
          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-3 pb-8 space-y-3">
            <div className="flex items-baseline justify-between px-1">
              <span className="text-[22px] font-extrabold tabular-nums text-gray-900">{formatYen(total)}</span>
              <span className="text-[13px] font-semibold tabular-nums text-gray-500">{`月 ${formatYen(Math.round(total / 12))}`}</span>
            </div>
            <div>
              {list.map((entry, index) => (
                <BudgetRow
                  key={entry.rule.id}
                  first={index === 0}
                  label={entry.rule.categoryId === top.id ? `まとめて${entry.rule.name.trim() ? `（${entry.rule.name.trim()}）` : ''}` : rowLabel(entry.rule)}
                  total={entry.total}
                  onClick={() => push({ type: 'form', ruleId: entry.rule.id })}
                />
              ))}
              {list.length === 0 && <p className="px-1 py-2.5 text-[13px] text-gray-400">予算がまだありません</p>}
            </div>
            <p className="px-1 text-[13px] font-bold text-gray-500">大分類の設定</p>
            <div className={groupClass}>
              <SettingRow first label="名前" value={top.name} onClick={() => setRenaming(top)} />
            </div>
            <AddButton label={`${top.name}の予算を追加`} onClick={() => push({ type: 'form', ruleId: null, group: 'variable', topId: top.id })} />
          </div>
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
        <section key={group} className="space-y-1">
          <button
            type="button"
            aria-expanded={filtered ? undefined : open}
            disabled={filtered}
            onClick={() =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(group)) next.delete(group);
                else next.add(group);
                return next;
              })
            }
            className={`flex w-full items-center gap-1.5 border-b-2 px-0.5 pt-2.5 pb-1 text-left ${group === 'income' ? 'border-[#43b02a]' : 'border-gray-300'}`}
          >
            {!filtered && (open ? <ChevronDown size={14} className="text-gray-500" /> : <ChevronRight size={14} className="text-gray-500" />)}
            <span className="text-lg font-extrabold text-gray-900">{GROUP_LABEL[group]}</span>
            <span className="flex-1" />
            <span className="text-lg font-extrabold tabular-nums text-gray-900">{formatYen(total)}</span>
          </button>
          {open && content}
        </section>
      );
    };
    const ruleList = (group: Exclude<BudgetLineGroup, 'variable'>) => (
      <div>
        {sections[group].map((entry, index) => (
          <BudgetRow
            key={entry.rule.id}
            first={index === 0}
            label={rowLabel(entry.rule)}
            total={entry.total}
            onClick={() => push({ type: 'form', ruleId: entry.rule.id })}
          />
        ))}
        {sections[group].length === 0 && <p className="px-1 py-2.5 text-[13px] text-gray-400">予算がまだありません</p>}
      </div>
    );
    const variableList = (
      <div>
        {[...variableTops]
          .sort((a, b) => Number(a.total === 0) - Number(b.total === 0))
          .map((entry, index) => (
            <BudgetRow
              key={entry.top.id}
              first={index === 0}
              label={entry.top.name}
              total={entry.total}
              offLabel="予算なし"
              onClick={() => push({ type: 'top', topId: entry.top.id })}
            />
          ))}
      </div>
    );
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
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-3">
          <div className="rounded-2xl bg-white px-3.5 py-3 shadow-[0_6px_18px_rgba(17,24,39,0.12)]">
            <Donut income={totals.income} parts={SPEND_GROUPS.map((group) => ({ group, amount: totals[group] }))} />
            <LegendRow
              main
              color={balance >= 0 ? INCOME_COLOR : DEFICIT_COLOR}
              label="収支見込み"
              percent=""
              amount={balance < 0 ? `−${formatYen(balance)}` : formatYen(balance)}
              amountColor={balance >= 0 ? INCOME_COLOR : DEFICIT_COLOR}
            />
            <LegendRow
              main
              label="収入"
              percent=""
              amount={formatYen(totals.income)}
              selected={selected === 'income'}
              onClick={() => setSelected((current) => (current === 'income' ? null : 'income'))}
            />
            <LegendRow
              main
              label="支出"
              percent=""
              amount={formatYen(expense)}
              selected={selected === 'expense'}
              onClick={() => setSelected((current) => (current === 'expense' ? null : 'expense'))}
            />
            {SPEND_GROUPS.map((group) => (
              <LegendRow
                key={group}
                color={PART_COLOR[group]}
                label={PART_LABEL[group]}
                percent={percentText(totals[group], totals.income)}
                amount={formatYen(totals[group])}
                selected={selected === group}
                onClick={() => setSelected((current) => (current === group ? null : group))}
              />
            ))}
          </div>

          {shown('income') && section('income', ruleList('income'), totals.income)}
          {shown('variable') && section('variable', variableList, totals.variable)}
          {shown('confirmed') && section('confirmed', ruleList('confirmed'), totals.confirmed)}
          {shown('estimate') && section('estimate', ruleList('estimate'), totals.estimate)}
          {shown('reserve') && section('reserve', ruleList('reserve'), totals.reserve)}
          {selected === null && orphans.length > 0 && (
            <section className="space-y-1">
              <div className="border-b-2 border-gray-300 px-0.5 pt-2.5 pb-1">
                <span className="text-lg font-extrabold text-gray-900">カテゴリなし</span>
              </div>
              <div>
                {orphans.map((rule, index) => (
                  <BudgetRow key={rule.id} first={index === 0} label={rowLabel(rule)} total={yearTotal(rule)} onClick={() => push({ type: 'form', ruleId: rule.id })} />
                ))}
              </div>
            </section>
          )}
          <AddButton label="予算を追加" onClick={() => push({ type: 'form', ruleId: null, group: selected === null || selected === 'expense' ? 'variable' : selected })} />
        </div>
      </>
    );
  }

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
      {renaming !== null && <RenameSheet name={renaming.name} onClose={() => setRenaming(null)} onSubmit={(name) => void rename(renaming, name)} />}
    </FullScreen>
  );
}

// ---- 上の枠 ----

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
    if (!deficit && income > expense) arcs.push({ key: 'balance', color: INCOME_COLOR, length: circumference - offset, offset });
  }
  const outer = 74;
  const outerCircumference = 2 * Math.PI * outer;
  // はみ出し（収入に対する割合。収入が無ければ1周）。
  const over = deficit ? Math.min(1, income > 0 ? (expense - income) / income : 1) * outerCircumference : 0;
  const centerText = income >= 10000 ? `¥${Math.round(income / 10000).toLocaleString('ja-JP')}万` : formatYen(income);
  return (
    <div className="flex justify-center pb-1.5">
      <svg viewBox="0 0 160 160" width={168} height={168} role="img" aria-label="収入を1周とした支出と収支見込みの円グラフ">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="#f3f4f6" strokeWidth={18} />
        {arcs.map((arc) => (
          <circle
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
          <circle
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
        <text x={center} y={70} textAnchor="middle" fontSize={10} fontWeight={700} fill="#6b7280">
          収入
        </text>
        <text x={center} y={88} textAnchor="middle" fontSize={16} fontWeight={800} fill="#111827">
          {centerText}
        </text>
      </svg>
    </div>
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
  onClick,
}: {
  label: string;
  percent: string;
  amount: string;
  color?: string;
  amountColor?: string;
  main?: boolean;
  selected?: boolean;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="mr-1.5 h-[9px] w-[9px] shrink-0 rounded-sm" style={color ? { backgroundColor: color } : undefined} />
      <span
        className={`w-[100px] shrink-0 truncate ${main ? 'text-[15px] font-extrabold text-gray-900' : 'text-sm font-medium text-gray-700'} ${selected ? '!text-blue-800' : ''}`}
      >
        {label}
      </span>
      <span className={`w-14 shrink-0 text-right text-xs font-semibold tabular-nums whitespace-pre text-gray-500 ${selected ? '!text-blue-800' : ''}`}>{percent}</span>
      <span
        className={`min-w-0 flex-1 truncate text-right tabular-nums ${main ? 'text-base font-extrabold' : 'text-sm font-semibold'} ${selected ? 'text-blue-800' : 'text-gray-900'}`}
        style={amountColor && !selected ? { color: amountColor } : undefined}
      >
        {amount}
      </span>
    </>
  );
  const className = `-mx-2 flex w-[calc(100%+16px)] items-center rounded-lg px-2 ${main ? 'py-1.5' : 'py-[3px]'} ${selected ? 'bg-blue-100' : ''}`;
  return onClick ? (
    <button type="button" aria-pressed={!!selected} onClick={onClick} className={`${className} text-left hover:bg-gray-50`}>
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}

// ---- 一覧 ----

function BudgetRow({
  label,
  total,
  first,
  offLabel = '期間外',
  onClick,
}: {
  label: string;
  total: number;
  first: boolean;
  offLabel?: string;
  onClick: () => void;
}) {
  const off = total === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-1 py-[11px] text-left hover:bg-gray-100 ${first ? '' : dividedClass} ${off ? 'bg-gray-100' : ''}`}
    >
      <span className={`min-w-0 flex-1 truncate text-[15px] font-medium ${off ? 'text-gray-500' : 'text-gray-900'}`}>{label}</span>
      {off && <span className="shrink-0 rounded-md bg-gray-200 px-1.5 text-[11px] font-bold text-gray-700">{offLabel}</span>}
      <span className={`shrink-0 text-[15px] font-bold tabular-nums ${off ? 'text-gray-500' : 'text-gray-900'}`}>{formatYen(total)}</span>
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-blue-100 py-3 text-[15px] font-bold text-blue-800 hover:bg-blue-200"
    >
      <Plus size={18} />
      {label}
    </button>
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
      <span className="shrink-0 text-[15px] font-medium text-gray-500">{label}</span>
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
      <StackedScreen onBack={() => setPickingStore(false)}>
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
      <ScreenHeader title={rule ? '予算を直す' : '予算を追加'} icon="back" onClose={onClose} />
      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-3 pb-8 space-y-3">
        <p className="px-1 text-[13px] font-bold text-gray-500">分類</p>
        <div className={groupClass}>
          <SettingRow first label="種類" value={GROUP_LABEL[group]} onClick={() => setSheet('group')} />
          {choosesTop(group) && <SettingRow label="大分類" value={top?.name ?? '選ぶ'} placeholder={top === null} onClick={() => setSheet('top')} />}
          <SettingRow label="小分類" value={categoryLabel} placeholder={selectedCategory === null} onClick={() => setSheet('category')} />
          <label className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
            <span className="shrink-0 text-[15px] font-medium text-gray-500">区別</span>
            <input
              className="min-w-0 flex-1 bg-transparent text-right text-[15px] text-gray-900 focus:outline-none"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="任意（例: 妻・時短）"
              aria-label="区別"
            />
          </label>
        </div>

        <p className="px-1 text-[13px] font-bold text-gray-500">予算</p>
        <div className={groupClass}>
          <label className="flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5">
            <span className="shrink-0 text-[15px] font-medium text-gray-500">金額</span>
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
        </div>

        <p className="px-1 text-[13px] font-bold text-gray-500">自動記録</p>
        <div className={groupClass}>
          <div className="flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5">
            <span className="flex-1 text-[15px] font-medium text-gray-500">自動で記録する</span>
            <Switch label="自動で記録する" value={auto} disabled={noMonth} onChange={setMakesRecord} />
          </div>
          {auto && (
            <>
              <SettingRow
                label={isIncome ? '振込日' : '日'}
                value={dayValue === '選ぶ' ? '選ぶ' : `${dayValue}（${HOLIDAY_RULE_LABEL[holiday]}）`}
                placeholder={dayValue === '選ぶ'}
                onClick={() => setSheet('day')}
              />
              <SettingRow label={isIncome ? '入金先' : '出金元'} value={wallet?.name ?? '選ぶ'} placeholder={!wallet} onClick={() => setSheet('wallet')} />
              {isIncome ? (
                <div className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${dividedClass}`}>
                  <span className="flex-1 text-[15px] font-medium text-gray-500">毎回同じ額</span>
                  <Switch label="毎回同じ額" value={incomeFixed} onChange={setIncomeFixed} />
                </div>
              ) : (
                <SettingRow label="お店" value={store || 'なし'} placeholder={store === ''} onClick={() => setPickingStore(true)} />
              )}
            </>
          )}
        </div>

        {preview && (
          <div className="flex justify-between px-1 text-[15px] font-bold text-gray-900">
            <span>{formatYear(year)}</span>
            <span className="tabular-nums">{`${formatYen(preview.total)}（${preview.count}回）`}</span>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <PrimaryButton label="保存する" disabled={saving} onClick={() => void submit()} />
        {onRemove && (
          <button type="button" onClick={onRemove} className="w-full py-2.5 text-sm font-bold text-red-600">
            この予算を消す
          </button>
        )}
      </div>

      {sheet === 'group' && (
        <ModalShell title="種類" onClose={() => setSheet(null)} footer={null}>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {GROUPS.map((entry, index) => (
              <OptionRow key={entry} first={index === 0} label={GROUP_LABEL[entry]} selected={entry === group} onClick={() => changeGroup(entry)} />
            ))}
          </div>
        </ModalShell>
      )}
      {sheet === 'top' && (
        <ModalShell title="大分類" onClose={() => setSheet(null)} footer={null}>
          <div className="overflow-hidden rounded-xl border border-gray-200">
            {topsOf(group).map((entry, index) => (
              <OptionRow
                key={entry.id}
                first={index === 0}
                label={entry.name}
                selected={entry.id === topId}
                onClick={() => {
                  setTopId(entry.id);
                  // まとめて（大分類）を選んでいたら、選んだ大分類のまとめてにする。
                  if (selectedCategory !== null && selectedCategory.parentId === null) setCategoryId(entry.id);
                  setSheet(null);
                }}
              />
            ))}
          </div>
        </ModalShell>
      )}
      {sheet === 'category' && (
        <CategorySheet
          choices={categoryChoices}
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
        <ModalShell title={isIncome ? '入金先' : '出金元'} onClose={() => setSheet(null)} footer={null}>
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

function OptionRow({ label, selected, first, onClick }: { label: string; selected: boolean; first: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={`${itemClass} ${first ? '' : dividedClass}`}>
      <span className={`flex-1 text-[15px] text-gray-900 ${selected ? 'font-bold' : 'font-medium'}`}>{label}</span>
      {selected && <span className="text-[15px] font-bold text-blue-600">✓</span>}
    </button>
  );
}

/** 小分類を選ぶ。一番下で新しく作る。選んでいる小分類の名前もここから直す。 */
function CategorySheet({
  choices,
  selectedId,
  onClose,
  onPick,
  onCreate,
  onRename,
}: {
  choices: { category: MoneyCategory; label: string }[];
  selectedId: string | null;
  onClose: () => void;
  onPick: (categoryId: string) => void;
  onCreate: (name: string) => Promise<void>;
  onRename?: () => void;
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
    <ModalShell title="小分類" onClose={onClose} footer={null}>
      <div className="space-y-2">
        <div className="overflow-hidden rounded-xl border border-gray-200">
          {choices.map((entry, index) => (
            <OptionRow
              key={entry.category.id}
              first={index === 0}
              label={entry.label}
              selected={entry.category.id === selectedId}
              onClick={() => onPick(entry.category.id)}
            />
          ))}
          <div className={`flex min-h-[46px] items-center gap-2.5 px-3.5 py-2.5 ${choices.length > 0 ? dividedClass : ''}`}>
            <Plus size={16} className="shrink-0 text-blue-600" />
            <input
              className="min-w-0 flex-1 bg-transparent text-[15px] text-gray-900 focus:outline-none"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void create();
              }}
              placeholder="新しい小分類の名前"
              aria-label="新しい小分類の名前"
            />
            {name.trim() !== '' && (
              <button type="button" onClick={() => void create()} className="shrink-0 text-sm font-bold text-blue-600">
                作る
              </button>
            )}
          </div>
        </div>
        {onRename && (
          <button type="button" onClick={onRename} className="w-full py-2.5 text-sm font-bold text-blue-600">
            選んでいる小分類の名前を直す
          </button>
        )}
      </div>
    </ModalShell>
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
