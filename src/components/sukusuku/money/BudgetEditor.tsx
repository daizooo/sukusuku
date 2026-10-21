'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyReserve } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
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
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import { CategoryIcon, FullScreen, PrimaryButton, ScreenHeader, StackedScreen, cardClass, incomeAmountClass } from './moneyVisual';

// 予算（docs/kakei.md §3.1・§3.5・§3.6・§3.7）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
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

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const rowClass = 'flex w-full items-center gap-3 border-t border-gray-200 px-3.5 py-3 text-left';

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
  const supabase = useMemo(() => createClient(), []);
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

  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');

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

  const removeReserve = async (category: MoneyCategory) => {
    if (!window.confirm(`${categoryPath(categories, category.id)}を予備費から外しますか？\nすべての年の額を消します。記録はそのまま残ります。`)) return;
    setEditingReserve(null);
    try {
      await deleteMoneyReserve(supabase, category.id);
      onReserves((prev) => prev.filter((entry) => entry.categoryId !== category.id));
    } catch {
      failed();
    }
  };

  // 収入の行の、カテゴリのアイコン（大分類）と、名前の下に出すカテゴリ（「給与 › 大造」）。
  const categoryOf = (rule: MoneyRecurring) => {
    const category = categories.find((entry) => entry.id === rule.categoryId);
    const top = category && category.parentId !== null ? categories.find((entry) => entry.id === category.parentId) : category;
    return { top: top ?? null, path: categoryPath(categories, rule.categoryId) };
  };
  const ruleIcon = (rule: MoneyRecurring) => {
    const { top } = categoryOf(rule);
    return top ? <CategoryIcon iconKey={iconKeyOf(top)} size={28} /> : <span className="w-7 shrink-0" />;
  };
  // カテゴリを大きく、品名を下に（お店は出さない）。カテゴリが無ければ品名を大きく。
  const ruleName = (rule: MoneyRecurring) => {
    const name = rule.name.trim();
    const { path: category } = categoryOf(rule);
    const title = category || name || (rule.kind === 'income' ? '収入' : '支出');
    const path = category !== '' ? name : '';
    return (
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-base font-semibold text-gray-900">{title}</span>
        </span>
        {path !== '' && path !== title && <span className="block truncate text-[13px] font-medium text-gray-500">{path}</span>}
      </span>
    );
  };

  const fixedRow = (row: RecurringYearRow) => (
    <button
      key={row.rule.id}
      type="button"
      disabled={!onOpenRecurring}
      onClick={() => onOpenRecurring?.(row.rule.id)}
      className={`${rowClass} enabled:hover:bg-gray-50`}
    >
      {ruleIcon(row.rule)}
      {ruleName(row.rule)}
      <span className="shrink-0 text-right">
        <span className={`block text-base font-extrabold tabular-nums ${row.rule.kind === 'income' ? incomeAmountClass : 'text-gray-900'}`}>
          {formatYen(row.total)}
        </span>
        <span className="block text-[13px] font-medium tabular-nums text-gray-500">{scheduleText(row)}</span>
      </span>
      {onOpenRecurring && <ChevronRight size={16} className="text-gray-400" />}
    </button>
  );

  const sectionHeader = (title: string, total: number, onClick?: () => void) => {
    const inner = (
      <>
        <span className="flex-1 text-lg font-extrabold text-gray-900">{title}</span>
        <span className="text-[15px] font-bold tabular-nums text-gray-500">{formatYen(total)}</span>
        {onClick && <ChevronRight size={16} className="text-gray-400" />}
      </>
    );
    return onClick ? (
      <button type="button" onClick={onClick} className="flex w-full items-center gap-1.5 px-0.5 pt-4 pb-1.5 text-left">
        {inner}
      </button>
    ) : (
      <div className="flex items-center gap-1.5 px-0.5 pt-4 pb-1.5">{inner}</div>
    );
  };

  return (
    <FullScreen onBack={onClose}>
      {pickingReserve ? (
        <StackedScreen onBack={() => setPickingReserve(false)}>
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
        </StackedScreen>
      ) : (
        <>
          <ScreenHeader title="予算" onClose={onClose} />
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5">
            <button type="button" aria-label="前の年" onClick={() => setYear((current) => current - 1)} className={yearButtonClass}>
              <ChevronLeft size={18} />
            </button>
            <span className="text-base font-bold text-gray-900 tabular-nums">{formatYear(year)}</span>
            <button type="button" aria-label="次の年" onClick={() => setYear((current) => current + 1)} className={yearButtonClass}>
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pb-8">
            <div className={`${cardClass} overflow-hidden`}>
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="flex-1 text-[15px] font-semibold text-gray-500">収入</span>
                <span className={`text-[17px] font-extrabold tabular-nums ${incomeAmountClass}`}>{formatYen(incomeTotal)}</span>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-3.5 py-2.5">
                <span className="flex-1 text-[15px] font-semibold text-gray-500">支出</span>
                <span className="text-[17px] font-extrabold tabular-nums text-gray-900">{formatYen(expenseTotal)}</span>
              </div>
              <div className="pb-1.5">
                {[
                  { label: '変動費', value: variableTotal },
                  { label: '固定費（見込み）', value: fixedTotal },
                  { label: '予備費', value: reserveTotal },
                ].map((part) => (
                  <div key={part.label} className="flex items-center justify-between gap-2 py-0.5 pr-3.5 pl-6">
                    <span className="flex-1 text-sm text-gray-500">{part.label}</span>
                    <span className="text-sm font-bold tabular-nums text-gray-500">{formatYen(part.value)}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-3.5 py-2.5">
                <span className="flex-1 text-[15px] font-bold text-gray-900">収支見込み</span>
                <span className={`text-[22px] font-extrabold tabular-nums ${plan > 0 ? incomeAmountClass : 'text-gray-900'}`}>
                  {plan < 0 ? '−' : plan > 0 ? '＋' : ''}
                  {formatYen(plan)}
                </span>
              </div>
            </div>

            {sectionHeader('収入', incomeTotal)}
            {incomeRows.length === 0 ? (
              <p className="py-4 text-center text-[13px] font-medium text-gray-400">この年の収入の見込みはありません</p>
            ) : (
              <div className={`${cardClass} overflow-hidden [&>*:first-child]:border-t-0`}>{incomeRows.map(fixedRow)}</div>
            )}

            {sectionHeader('変動費', variableTotal)}
            {rows.length === 0 ? (
              <p className="py-4 text-center text-[13px] font-medium text-gray-400">生活費の大分類がありません。先に「カテゴリ」で作ってください</p>
            ) : (
              <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
                {rows.map((row) => (
                  <button
                    key={row.top.id}
                    type="button"
                    aria-label={`${row.top.name}の${formatYear(year)}の予算を決める`}
                    onClick={() => setEditing(row.top)}
                    className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-gray-50"
                  >
                    <CategoryIcon iconKey={iconKeyOf(row.top)} size={28} />
                    <span className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">{row.top.name}</span>
                    <span className="shrink-0 text-right">
                      <span className="block text-base font-extrabold tabular-nums text-gray-900">{row.total === 0 ? '−' : formatYen(row.total)}</span>
                      {row.total > 0 && <span className="block text-[13px] font-medium tabular-nums text-gray-500">{row.monthly}</span>}
                    </span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                ))}
              </div>
            )}

            {sectionHeader('予備費', reserveTotal)}
            <div className={`${cardClass} overflow-hidden [&>*:first-child]:border-t-0`}>
              {reserveRows.map((row) => (
                <button
                  key={row.category.id}
                  type="button"
                  aria-label={`${row.path}の${formatYear(year)}の予備費を決める`}
                  onClick={() => setEditingReserve(row.category)}
                  className={`${rowClass} hover:bg-gray-50`}
                >
                  <span className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">{row.path}</span>
                  <span className="shrink-0 text-base font-extrabold tabular-nums text-gray-900">{row.amount === 0 ? '−' : formatYen(row.amount)}</span>
                  <ChevronRight size={16} className="text-gray-400" />
                </button>
              ))}
              <button type="button" onClick={() => setPickingReserve(true)} className={`${rowClass} text-base font-bold text-blue-600 hover:bg-gray-50`}>
                <Plus size={16} />
                追加する
              </button>
            </div>
          </div>
        </>
      )}

      {editing !== null && (
        <BudgetModal
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
        <ReserveModal
          key={`${editingReserve.id}-${year}`}
          title={categoryPath(categories, editingReserve.id)}
          year={year}
          amount={reserveAmountFor(reserves, editingReserve.id, year)}
          linked={reserveRows.some((row) => row.category.id === editingReserve.id)}
          onClose={() => setEditingReserve(null)}
          onSubmit={(amount) => void saveReserve(editingReserve, amount)}
          onRemove={() => void removeReserve(editingReserve)}
        />
      )}
    </FullScreen>
  );
}

/** 予備費の小分類の、その年の額。予備費の小分類なら「予備費から外す」も出す。 */
function ReserveModal({
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
    <ModalShell
      title={`予備費（${formatYear(year)}）`}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {linked && (
            <button type="button" onClick={onRemove} className="w-full py-2.5 text-sm font-bold text-red-600">
              予備費から外す
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-2">
        <p className="text-[15px] font-bold text-gray-900">{title}</p>
        <input
          className={`${inputClass} tabular-nums`}
          value={text}
          onChange={(event) => setText(event.target.value)}
          inputMode="numeric"
          placeholder="年の額（円）"
          aria-label="予備費の年の額"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}

function BudgetModal({
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
    const value = bulk.trim() === '' ? null : parseAmountInput(bulk);
    if (value === null) return setError('まとめて入れる額は0以上の整数（円）で入れてください');
    setError(null);
    setAmounts(Array.from({ length: 12 }, () => String(value)));
  };

  const copyPrevious = () => {
    setError(null);
    setAmounts(previousAmounts.map((value) => (value === null ? '' : String(value))));
  };

  return (
    <ModalShell
      title={`${category.name}の予算（${formatYear(year)}）`}
      onClose={onClose}
      footer={<PrimaryButton label="保存する" onClick={submit} />}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input
            className={`${inputClass} tabular-nums`}
            value={bulk}
            onChange={(event) => setBulk(event.target.value)}
            inputMode="numeric"
            placeholder="同じ額をまとめて入れる"
          />
          <button type="button" onClick={fillAll} className="shrink-0 rounded-lg bg-blue-50 px-3 py-2 text-[13px] font-bold text-blue-800">
            全ての月に入れる
          </button>
        </div>
        <button type="button" onClick={copyPrevious} className="rounded-lg bg-blue-50 px-3 py-2 text-[13px] font-bold text-blue-800">
          {formatYear(year - 1)}の額を入れる
        </button>
        {amounts.map((text, index) => {
          return (
            <div key={index} className="flex items-center gap-2">
              <span className="w-9 shrink-0 text-[13px] font-bold text-gray-700">{index + 1}月</span>
              <div className="w-32 shrink-0">
                <input
                  className={`${inputClass} tabular-nums`}
                  value={text}
                  onChange={(event) => setAmounts((prev) => prev.map((value, at) => (at === index ? event.target.value : value)))}
                  inputMode="numeric"
                  placeholder="未設定"
                  aria-label={`${index + 1}月の予算`}
                />
              </div>
            </div>
          );
        })}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
