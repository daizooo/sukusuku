'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import {
  budgetFor,
  budgetMonths,
  categoryPath,
  fixedBudgetFor,
  formatYear,
  formatYen,
  iconKeyOf,
  parseAmountInput,
  recurringInYear,
  recurringPeriodLabel,
  topCategories,
  yearMonthKeys,
} from '@/lib/moneyUtils';
import { saveMoneyBudget } from '@/lib/api/money';
import { ModalShell } from '../modals/TaskForm';
import { CategoryIcon, FullScreen, PrimaryButton, ScreenHeader, SectionHeader, cardClass, incomeAmountClass, type } from './moneyVisual';

// 予算（docs/kakei.md §3.1・§3.5）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
//
// カテゴリ（CategoryEditor）とは別の設定にした（2026-10-15）。カテゴリは名前・並び・アイコンで年に関係なく、
// 予算は**年ごと**に決めるもの（来年の予算も、いつでも決められる）。上の年の送りで年を替え、大分類ごとにその年の1月〜12月の月の予算を決める。
// 決めていない年は、前の年の12月の額を引き継ぐ（「前年から引き継ぎ」）。固定費（毎月自動で記録するルール）は、その月の予算に自動で足される。
// 固定支出・固定収入は年をまたぐものもあるので、期間（開始月・終了月）と記録する月から、**その年に効くものだけ**を年の額で下に並べる。
// 上の「年の見込み」は、固定収入の年の合計と、支出の予算（固定費を含む）の年の合計、その差。

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
  onClose: () => void;
}

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

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
  onClose,
}: BudgetEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [year, setYear] = useState(initialYear);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);

  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const tops = useMemo(() => topCategories(categories, 'living', true).filter((top) => !top.archived), [categories]);
  const rows = useMemo(
    () =>
      tops.map((top) => {
        const monthly = monthKeys.map((key) => budgetFor(budgets, top.id, key) ?? 0);
        const fixed = monthKeys.reduce((sum, key) => sum + fixedBudgetFor(budgets, top.id, key), 0);
        const total = monthly.reduce((sum, value) => sum + value, 0);
        return {
          top,
          total,
          fixed,
          even: monthly.every((value) => value === monthly[0]),
          average: Math.round(total / 12),
          // その年の手入力の予算を決めていない（前の年の12月の額を引き継いでいる）。
          inherited: !budgets.some((entry) => !entry.fixed && entry.categoryId === top.id && entry.year === year),
        };
      }),
    [tops, monthKeys, budgets, year],
  );
  const expenseTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const fixedRows = useMemo(() => recurringInYear(recurring, records, year), [recurring, records, year]);
  const incomeRows = fixedRows.filter((row) => row.rule.kind === 'income');
  const outgoRows = fixedRows.filter((row) => row.rule.kind !== 'income');
  const incomeTotal = incomeRows.reduce((sum, row) => sum + row.total, 0);
  const plan = incomeTotal - expenseTotal;

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
      window.alert('保存できませんでした。もう一度お試しください。');
    }
  };

  return (
    <FullScreen onBack={onClose}>
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
        <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="flex-1 text-[13px] font-semibold text-gray-500">固定収入</span>
            <span className={`text-base font-extrabold tabular-nums ${incomeAmountClass}`}>{formatYen(incomeTotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="flex-1 text-[13px] font-semibold text-gray-500">支出の予算</span>
            <span className="text-base font-extrabold tabular-nums text-gray-900">{formatYen(expenseTotal)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
            <span className="flex-1 text-[13px] font-semibold text-gray-500">収支</span>
            <span className={`text-base font-extrabold tabular-nums ${plan > 0 ? incomeAmountClass : 'text-gray-900'}`}>
              {plan < 0 ? '−' : ''}
              {formatYen(plan)}
            </span>
          </div>
        </div>

        <SectionHeader compact title="大分類ごとの予算" />
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
                className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-gray-50"
              >
                <CategoryIcon iconKey={iconKeyOf(row.top)} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-gray-900">{row.top.name}</span>
                  <span className={`block truncate ${type.faint}`}>
                    {row.total === 0 ? '予算なし' : `${row.even ? '毎月' : '月平均'} ${formatYen(row.average)}`}
                    {row.fixed > 0 ? `・うち固定費 年${formatYen(row.fixed)}` : ''}
                    {row.inherited && row.total > 0 ? '・前年から引き継ぎ' : ''}
                  </span>
                </span>
                <span className="text-sm font-extrabold tabular-nums text-gray-900">{row.total === 0 ? '−' : `年 ${formatYen(row.total)}`}</span>
                <ChevronRight size={16} className="text-gray-400" />
              </button>
            ))}
          </div>
        )}

        <SectionHeader compact title={`${formatYear(year)}に効く固定の収支`} />
        {fixedRows.length === 0 ? (
          <p className="py-4 text-center text-[13px] font-medium text-gray-400">この年に効く固定収入・固定支出はありません</p>
        ) : (
          <div className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
            {[...incomeRows, ...outgoRows].map((row) => {
              const period = recurringPeriodLabel(row.rule);
              const active = row.amounts.filter((value) => value > 0).length;
              return (
                <div key={row.rule.id} className="flex items-center gap-2.5 px-3.5 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-gray-900">{ruleTitle(row.rule, categories)}</span>
                    <span className={`block truncate ${type.faint}`}>
                      {row.rule.kind === 'income' ? '収入' : '支出'}・{active}か月{period !== '' ? `・${period}` : ''}
                    </span>
                  </span>
                  <span className={`text-sm font-extrabold tabular-nums ${row.rule.kind === 'income' ? incomeAmountClass : 'text-gray-900'}`}>
                    年 {formatYen(row.total)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing !== null && (
        <BudgetModal
          key={`${editing.id}-${year}`}
          category={editing}
          year={year}
          monthAmounts={budgetMonths(budgets, editing.id, year)}
          previousAmounts={budgetMonths(budgets, editing.id, year - 1)}
          fixed={monthKeys.map((key) => fixedBudgetFor(budgets, editing.id, key))}
          onClose={() => setEditing(null)}
          onSubmit={(amounts) => void save(editing, amounts)}
        />
      )}
    </FullScreen>
  );
}

function BudgetModal({
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
          const manual = text.trim() === '' ? null : parseAmountInput(text);
          const total = (manual ?? 0) + fixed[index];
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
              {fixed[index] > 0 && (
                <span className="text-[11px] font-semibold text-gray-400 tabular-nums">
                  ＋固定費 {formatYen(fixed[index])}＝{formatYen(total)}
                </span>
              )}
            </div>
          );
        })}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
