'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { MoneyBudget, MoneyBudgetLine, MoneyCategory } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import {
  budgetLineCount,
  budgetLineGroup,
  budgetLineScheduleLabel,
  budgetLineYearAmount,
  budgetMonths,
  categoryPath,
  formatYear,
  formatYen,
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
import { ModalShell } from '../modals/TaskForm';
import CategoryPicker from './CategoryPicker';
import { Chip, ChipRow, Field } from './feedParts';
import { FullScreen, PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';
import { AmountRow, BalanceCard, SECTION_DOTS, SectionCard, SubHeading } from './reviewParts';

// 年間予算（docs/kakei.md §0.7。2026-10-22）。mobile版の `mobile/src/components/money/BudgetEditor.tsx` と同じ並び・文言。
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

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';
const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';

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
  const supabase = useMemo(() => createClient(), []);
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
  // 収入の大分類ごと（上の枠の内訳）。
  const incomeParts = useMemo(() => {
    const sums = new Map<string, number>();
    for (const row of lineRows.income) {
      const topId = topCategoryIdOf(categories, row.line.categoryId);
      const name = categories.find((category) => category.id === topId)?.name ?? 'その他';
      sums.set(name, (sums.get(name) ?? 0) + row.total);
    }
    return [...sums].map(([name, amount]) => ({ name, amount })).filter((part) => part.amount > 0);
  }, [lineRows, categories]);
  const [open, setOpen] = useState({ income: false, variable: true, reserve: true, fixed: true });
  const toggle = (key: keyof typeof open) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
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

  const removeLine = async (line: MoneyBudgetLine) => {
    if (!window.confirm(`${categoryPath(categories, line.categoryId)}の予算を消しますか？\nすべての年から消えます。記録はそのまま残ります。`)) return;
    setEditingLine(null);
    try {
      await deleteMoneyBudgetLine(supabase, line.id);
      onBudgetLines((prev) => prev.filter((entry) => entry.id !== line.id));
    } catch {
      failed();
    }
  };

  const lineName = (line: MoneyBudgetLine) => {
    const category = categories.find((entry) => entry.id === line.categoryId);
    const base = category?.name ?? categoryPath(categories, line.categoryId);
    return line.name.trim() === '' ? base : `${base}（${line.name.trim()}）`;
  };
  const lineRow = (row: { line: MoneyBudgetLine; total: number }) => (
    <AmountRow
      key={row.line.id}
      name={lineName(row.line)}
      sub={`${formatYen(row.line.amount)} × ${budgetLineScheduleLabel(row.line, year)}`}
      amount={formatYen(row.total)}
      faint={row.total === 0}
      onClick={() => setEditingLine({ line: row.line, categoryId: row.line.categoryId })}
    />
  );
  const addRow = (target: AddTarget) => (
    <button
      type="button"
      onClick={() => setPicking(target)}
      className="flex w-full items-center gap-1.5 border-t border-gray-100 py-3 pr-[18px] pl-[38px] text-[15px] font-bold text-blue-600 hover:bg-gray-50"
    >
      <Plus size={16} />
      追加する
    </button>
  );
  const onlyTops =
    picking === null || picking === 'income'
      ? undefined
      : (top: MoneyCategory) => (picking === 'reserve' ? top.budgetGroup === 'reserve' : top.budgetGroup === 'fixed' || top.budgetGroup === 'estimate');

  return (
    <FullScreen onBack={onClose}>
      {picking !== null ? (
        <StackedScreen onBack={() => setPicking(null)}>
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
              label={`収支の予算（${formatYear(year)}）`}
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
              {lineRows.income.map(lineRow)}
              {addRow('income')}
            </SectionCard>

            <SectionCard
              title="変動費"
              dot={SECTION_DOTS.variable}
              chip={{ text: formatYen(variableTotal), tone: 'neutral' }}
              open={open.variable}
              onToggle={() => toggle('variable')}
            >
              {rows.length === 0 && (
                <p className="py-4 text-center text-[13px] font-medium text-gray-400">変動費の大分類がありません。「カテゴリ」で大分類の予算の分け方を決めてください</p>
              )}
              {rows.map((row) => (
                <AmountRow
                  key={row.top.id}
                  name={row.top.name}
                  sub={row.total === 0 ? undefined : `${row.even ? formatYen(row.average) : `約${formatYen(row.average)}`} × 毎月（12回）`}
                  amount={row.total === 0 ? '−' : formatYen(row.total)}
                  faint={row.total === 0}
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
              {lineRows.reserve.map(lineRow)}
              {addRow('reserve')}
            </SectionCard>

            <SectionCard
              title="固定費"
              dot={SECTION_DOTS.fixed}
              chip={{ text: formatYen(confirmedTotal + estimateTotal), tone: 'neutral' }}
              open={open.fixed}
              onToggle={() => toggle('fixed')}
            >
              <SubHeading title="確定" amount={formatYen(confirmedTotal)} />
              {lineRows.confirmed.map(lineRow)}
              <SubHeading title="見込み" amount={formatYen(estimateTotal)} />
              {lineRows.estimate.map(lineRow)}
              {addRow('fixed')}
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
      {editingLine !== null && (
        <BudgetLineModal
          key={editingLine.line?.id ?? `new-${editingLine.categoryId}`}
          title={categoryPath(categories, editingLine.categoryId)}
          categoryId={editingLine.categoryId}
          line={editingLine.line}
          year={year}
          onClose={() => setEditingLine(null)}
          onSubmit={(draft) => void saveLine(editingLine, draft)}
          onRemove={editingLine.line ? () => void removeLine(editingLine.line as MoneyBudgetLine) : undefined}
        />
      )}
    </FullScreen>
  );
}

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

/** 予算の明細を足す・直す。単価・発生月（毎月・月を選ぶ・発生月なし）・◯年ごと・期間。 */
function BudgetLineModal({
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
    <ModalShell
      title={line ? '予算を直す' : '予算を足す'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {onRemove && (
            <button type="button" onClick={onRemove} className="w-full py-2.5 text-sm font-bold text-red-600">
              この予算を消す
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] font-bold text-gray-900">{title}</p>
        <Field label="単価（1回の額）">
          <input
            className={`${inputClass} tabular-nums`}
            value={amountText}
            onChange={(event) => setAmountText(event.target.value)}
            inputMode="numeric"
            placeholder="額（円）"
            aria-label="単価"
          />
        </Field>
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
        <Field label="頻度">
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
                aria-label="何年ごと"
              />
              <span className="text-[13px] font-semibold text-gray-600">年ごと（期間の始まりの年から数える）</span>
            </div>
          )}
        </Field>
        <Field label="期間（空なら無期限）">
          <div className="flex items-center gap-2">
            <input
              className={inputClass}
              value={startText}
              onChange={(event) => setStartText(event.target.value)}
              placeholder="始まり 例: 2027/9"
              aria-label="期間の始まり"
            />
            <span className="text-[13px] font-semibold text-gray-600">〜</span>
            <input
              className={inputClass}
              value={endText}
              onChange={(event) => setEndText(event.target.value)}
              placeholder="終わり 例: 2033/3"
              aria-label="期間の終わり"
            />
          </div>
        </Field>
        <Field label="名前（区別したいときだけ。例: 時短）">
          <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="任意" aria-label="名前" />
        </Field>
        {preview && <p className="text-[13px] font-bold text-gray-700 tabular-nums">{preview}</p>}
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
