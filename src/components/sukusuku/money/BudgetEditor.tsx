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
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import { FullScreen, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';
import { AmountRow, BalanceCard, SECTION_DOTS, SectionCard, SubHeading } from './reviewParts';

// 予算（docs/kakei.md §3.1・§3.5・§3.6・§3.7）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
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

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // 押した帯に出すルールの回（「今年はなし」か、自動記録ルールの編集へ）。
  const [acting, setActing] = useState<EstimateCostOccurrence | null>(null);
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

  // 記録を作らない回を「今年はなし」にする・戻す（その回の予定の月を skippedMonths に出し入れする）。
  const toggleSkip = async (entry: EstimateCostOccurrence) => {
    setActing(null);
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

  // ルールの名前（品名、無ければカテゴリの小分類）。
  const ruleTitle = (rule: MoneyRecurring) =>
    rule.name.trim() || categories.find((category) => category.id === rule.categoryId)?.name || (rule.kind === 'income' ? '収入' : '支出');
  // 1回の額と、記録する月（毎月は「/月」）。
  const eachOf = (row: RecurringYearRow) => {
    const values = row.amounts.filter((value) => value > 0);
    const even = values.every((value) => value === values[0]);
    const each = values.length === 0 ? 0 : even ? values[0] : Math.round(row.total / values.length);
    return { amount: values.length > 1 && !even ? `約${formatYen(each)}` : formatYen(each), unit: row.rule.months === null ? '/月' : monthsLabel(row.rule.months) };
  };
  const ruleRow = (row: RecurringYearRow) => {
    const { amount, unit } = eachOf(row);
    return (
      <AmountRow
        key={row.rule.id}
        name={ruleTitle(row.rule)}
        amount={amount}
        right={{ text: unit, muted: true }}
        onClick={onOpenRecurring ? () => onOpenRecurring(row.rule.id) : undefined}
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
      onClick={() => setActing(entry)}
    />
  );
  const confirmedOccurrences = occurrences.filter((entry) => entry.rule.amountMode === 'fixed');
  const estimateOccurrences = occurrences.filter((entry) => entry.rule.amountMode !== 'fixed');

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
          <ScreenHeader title="年間予算" onClose={onClose} />
          <div className="shrink-0 flex items-center gap-2 px-4 py-2.5">
            <button type="button" aria-label="前の年" onClick={() => setYear((current) => current - 1)} className={yearButtonClass}>
              <ChevronLeft size={18} />
            </button>
            <span className="text-base font-bold text-gray-900 tabular-nums">{formatYear(year)}</span>
            <button type="button" aria-label="次の年" onClick={() => setYear((current) => current + 1)} className={yearButtonClass}>
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="flex-1 min-h-0 space-y-3 overflow-y-auto bg-gray-50 px-4 pb-8">
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
              {incomeRows.length === 0 && <p className="py-4 text-center text-[13px] font-medium text-gray-400">この年の収入の見込みはありません</p>}
              {incomeRows.map(ruleRow)}
            </SectionCard>

            <SectionCard
              title="変動費"
              dot={SECTION_DOTS.variable}
              chip={{ text: formatYen(variableTotal), tone: 'neutral' }}
              open={open.variable}
              onToggle={() => toggle('variable')}
            >
              {rows.length === 0 && (
                <p className="py-4 text-center text-[13px] font-medium text-gray-400">生活費の大分類がありません。先に「カテゴリ」で作ってください</p>
              )}
              {rows.map((row) => (
                <AmountRow
                  key={row.top.id}
                  name={row.top.name}
                  amount={row.total === 0 ? '−' : row.even ? formatYen(row.average) : `約${formatYen(row.average)}`}
                  faint={row.total === 0}
                  right={{ text: '/月', muted: true }}
                  onClick={() => setEditing(row.top)}
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
                  onClick={() => setEditingReserve(row.category)}
                />
              ))}
              <button
                type="button"
                onClick={() => setPickingReserve(true)}
                className="flex w-full items-center gap-1.5 border-t border-gray-100 py-3 pr-[18px] pl-[38px] text-[15px] font-bold text-blue-600 hover:bg-gray-50"
              >
                <Plus size={16} />
                追加する
              </button>
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
      {acting !== null && (
        <ModalShell title={`${ruleTitle(acting.rule)}（${Number(acting.plannedMonth.slice(5, 7))}月）`} onClose={() => setActing(null)} footer={null}>
          <div className="space-y-2">
            {acting.status === 'done' ? (
              <p className="text-[15px] tabular-nums text-gray-700">
                見込み {formatYen(acting.amount)}・実績 {formatYen(acting.actual)}
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
                ルールを開く
              </button>
            )}
          </div>
        </ModalShell>
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
