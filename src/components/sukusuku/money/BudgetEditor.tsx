'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyRecord, MoneyRecurring, MoneyReserve } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
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
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import { CategoryIcon, FullScreen, PrimaryButton, ScreenHeader, StackedScreen, cardClass, incomeAmountClass } from './moneyVisual';

// 予算（docs/kakei.md §3.1・§3.5・§3.6・§3.7）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
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

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const rowClass = 'flex w-full items-center gap-3 border-t border-gray-200 px-3.5 py-3 text-left';

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
  const supabase = useMemo(() => createClient(), []);
  const [year, setYear] = useState(initialYear);
  const [editing, setEditing] = useState<MoneyCategory | null>(null);
  const [editingReserve, setEditingReserve] = useState(false);
  const [pickingReserve, setPickingReserve] = useState(false);
  // 押した記録しない回（「今年はなし」か、固定支出の編集へ）。
  const [acting, setActing] = useState<EstimateCostOccurrence | null>(null);
  // 固定費の「確定」「予定」と、予備費の小分類の開閉。
  const [open, setOpen] = useState({ confirmed: false, planned: true, reserve: true });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));

  const monthKeys = useMemo(() => yearMonthKeys(year), [year]);
  const tops = useMemo(() => topCategories(categories, 'living', true).filter((top) => !top.archived), [categories]);
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

  const failed = () => window.alert('保存できませんでした。もう一度お試しください。');

  // 記録を作らない回を「今年はなし」にする・戻す（その回の予定の月を skippedMonths に出し入れする）。
  const toggleSkip = async (entry: EstimateCostOccurrence) => {
    setActing(null);
    const skipped = entry.rule.skippedMonths ?? [];
    const isSkipped = skipped.includes(entry.plannedMonth);
    const next = isSkipped ? skipped.filter((monthKey) => monthKey !== entry.plannedMonth) : [...skipped, entry.plannedMonth].sort();
    try {
      const saved = await updateMoneyRecurringSkipped(supabase, entry.rule.id, next);
      onRecurring((prev) => prev.map((rule) => (rule.id === saved.id ? saved : rule)));
    } catch {
      failed();
    }
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

  const unlink = (category: MoneyCategory) => {
    if (window.confirm(`${categoryPath(categories, category.id)}を予備費から外しますか？`)) void setReserveLink(category.id, false);
  };

  const groupHeader = (key: keyof typeof open, title: string, total: number | null, first: boolean) => (
    <button
      type="button"
      aria-expanded={open[key]}
      onClick={() => toggle(key)}
      className={`flex w-full items-center gap-2 bg-gray-50 px-3.5 py-2.5 text-left ${first ? '' : 'border-t border-gray-200'}`}
    >
      {open[key] ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
      <span className="flex-1 text-base font-bold text-gray-700">{title}</span>
      {total !== null && <span className="text-[15px] font-bold tabular-nums text-gray-500">{formatYen(total)}</span>}
    </button>
  );

  // 固定費の行の、カテゴリのアイコン（大分類）と、名前の下に出すカテゴリ（「住居費 › 家賃・ローン」）。
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
  const ruleName = (rule: MoneyRecurring, badge?: boolean, skipped?: boolean) => {
    const name = rule.name.trim();
    const { path: category } = categoryOf(rule);
    const title = category || name || (rule.kind === 'income' ? '収入' : '支出');
    const path = category !== '' ? name : '';
    return (
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`min-w-0 truncate text-base font-semibold ${skipped ? 'text-gray-400 line-through' : 'text-gray-900'}`}>{title}</span>
          {badge && <span className="shrink-0 rounded-full bg-gray-100 px-2 py-px text-xs font-bold text-gray-500">済</span>}
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
        <span className="block text-base font-extrabold tabular-nums text-gray-900">{formatYen(row.total)}</span>
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
            monthKey={monthKeyOfDate(new Date())}
            categories={categories}
            budgets={budgets}
            records={records}
            onPick={(choice) => void setReserveLink(choice.categoryId, true)}
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
                  { label: '変動費', value: variableTotal, sub: false },
                  { label: '固定費', value: confirmedTotal + plannedTotal, sub: false },
                  { label: '確定', value: confirmedTotal, sub: true },
                  { label: '予定', value: plannedTotal, sub: true },
                  { label: '予備費', value: reserveAmount, sub: false },
                ].map((part) => (
                  <div key={part.label} className={`flex items-center justify-between gap-2 py-0.5 pr-3.5 ${part.sub ? 'pl-10' : 'pl-6'}`}>
                    <span className={`flex-1 ${part.sub ? 'text-[13px] text-gray-400' : 'text-sm text-gray-500'}`}>{part.label}</span>
                    <span className={`font-bold tabular-nums ${part.sub ? 'text-[13px] text-gray-400' : 'text-sm text-gray-500'}`}>
                      {formatYen(part.value)}
                    </span>
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
              <p className="py-4 text-center text-[13px] font-medium text-gray-400">この年の固定収入はありません</p>
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

            {sectionHeader('固定費', confirmedTotal + plannedTotal)}
            <div className={`${cardClass} overflow-hidden`}>
              {groupHeader('confirmed', '確定', confirmedTotal, true)}
              {open.confirmed && confirmedRows.map(fixedRow)}
              {groupHeader('planned', '予定', plannedTotal, false)}
              {open.planned && plannedRows.map(fixedRow)}
              {open.planned &&
                occurrences.map((entry) => (
                  <button
                    key={`${entry.rule.id}-${entry.plannedMonth}`}
                    type="button"
                    onClick={() => setActing(entry)}
                    className={`${rowClass} hover:bg-gray-50`}
                  >
                    {ruleIcon(entry.rule)}
                    {ruleName(entry.rule, entry.status === 'done', entry.status === 'skipped')}
                    <span className="shrink-0 text-right">
                      <span
                        className={`block text-base font-extrabold tabular-nums ${entry.status === 'skipped' ? 'text-gray-400 line-through' : 'text-gray-900'}`}
                      >
                        {formatYen(entry.amount)}
                      </span>
                      <span className="block text-[13px] font-medium tabular-nums text-gray-500">{monthLabel(entry.actualMonth ?? entry.plannedMonth)}</span>
                    </span>
                  </button>
                ))}
            </div>

            {sectionHeader('予備費', reserveAmount, () => setEditingReserve(true))}
            <div className={`${cardClass} overflow-hidden`}>
              {groupHeader('reserve', '小分類', null, true)}
              {open.reserve &&
                reserveLinked.map((category) => (
                  <button key={category.id} type="button" onClick={() => unlink(category)} className={`${rowClass} hover:bg-gray-50`}>
                    <span className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">{categoryPath(categories, category.id)}</span>
                    <ChevronRight size={16} className="text-gray-400" />
                  </button>
                ))}
              {open.reserve && (
                <button type="button" onClick={() => setPickingReserve(true)} className={`${rowClass} text-base font-bold text-blue-600 hover:bg-gray-50`}>
                  <Plus size={16} />
                  追加する
                </button>
              )}
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
          fixed={monthKeys.map((key) => fixedBudgetFor(budgets, editing.id, key) + estimateBudgetFor(budgets, editing.id, key))}
          onClose={() => setEditing(null)}
          onSubmit={(amounts) => void save(editing, amounts)}
        />
      )}
      {acting !== null && (
        <ModalShell title={`${ruleTitle(acting.rule, categories)}（${monthLabel(acting.plannedMonth)}）`} onClose={() => setActing(null)} footer={null}>
          <div className="space-y-2">
            {acting.status === 'done' ? (
              <p className="text-[15px] tabular-nums text-gray-700">
                予定 {formatYen(acting.amount)}・実績 {formatYen(acting.actual)}
              </p>
            ) : (
              <button
                type="button"
                onClick={() => void toggleSkip(acting)}
                className="w-full rounded-lg border border-gray-200 py-2.5 text-[15px] font-bold text-gray-800 hover:bg-gray-50"
              >
                {acting.status === 'skipped' ? '今年の予算に戻す' : '今年はなし'}
              </button>
            )}
            {onOpenRecurring && (
              <button
                type="button"
                onClick={() => onOpenRecurring(acting.rule.id)}
                className="w-full rounded-lg border border-gray-200 py-2.5 text-[15px] font-bold text-blue-600 hover:bg-gray-50"
              >
                固定支出を開く
              </button>
            )}
          </div>
        </ModalShell>
      )}
      {editingReserve && (
        <ReserveModal year={year} amount={reserveAmount} onClose={() => setEditingReserve(false)} onSubmit={(amount) => void saveReserve(amount)} />
      )}
    </FullScreen>
  );
}

/** 予備費の年の額。 */
function ReserveModal({
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
    <ModalShell title={`予備費（${formatYear(year)}）`} onClose={onClose} footer={<PrimaryButton label="保存する" onClick={submit} />}>
      <div className="space-y-2">
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
          const added = fixed[index] > 0 ? `＋固定費 ${formatYen(fixed[index])}` : '';
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
              {added !== '' && (
                <span className="text-[11px] font-semibold text-gray-400 tabular-nums">
                  {added}＝{formatYen(total)}
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
