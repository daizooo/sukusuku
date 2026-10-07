'use client';

import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import type { MoneyBudget, MoneyCategory, MoneyCategoryKind } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { budgetFor, childCategories, formatYen, topCategories } from '@/lib/moneyUtils';
import { formatFiscalYear, parseAmountInput } from '@/lib/specialUtils';
import {
  insertDefaultMoneyCategories,
  insertMoneyCategory,
  saveMoneyBudget,
  updateMoneyCategory,
} from '@/lib/api/money';
import { ModalShell } from '../modals/TaskForm';
import { FullScreen, PrimaryButton, ScreenHeader } from './moneyVisual';

// 種類と予算（docs/kakei.md §3.1）。mobile版の `mobile/src/components/money/CategoryEditor.tsx` と同じ並び・文言。
//
// 大分類（予算を置く単位）と小分類の追加・名前の変更・並べ替え・使わなくする。予算は大分類ごと・年度ごとの月額で、
// その年度に入れていなければ前の年度の額のまま（ここで直すと、その年度の額になる）。
// 種類がまだ無い家族には「標準の種類で始める」（Zaim のカテゴリをもとにした並び）。

interface CategoryEditorProps {
  familyId: string;
  fiscalYear: number;
  categories: MoneyCategory[];
  budgets: MoneyBudget[];
  onCategories: (update: (prev: MoneyCategory[]) => MoneyCategory[]) => void;
  onBudgets: (update: (prev: MoneyBudget[]) => MoneyBudget[]) => void;
  onClose: () => void;
}

type Editing = { category: MoneyCategory } | { category: null; parentId: string | null } | null;

const KIND_OPTIONS: { id: MoneyCategoryKind; label: string }[] = [
  { id: 'living', label: '生活費' },
  { id: 'income', label: '収入' },
];

const yearButtonClass =
  'flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200';

export default function CategoryEditor({
  familyId,
  fiscalYear: initialYear,
  categories,
  budgets,
  onCategories,
  onBudgets,
  onClose,
}: CategoryEditorProps) {
  const supabase = useMemo(() => createClient(), []);
  const [fiscalYear, setFiscalYear] = useState(initialYear);
  const [kind, setKind] = useState<MoneyCategoryKind>('living');
  const [editing, setEditing] = useState<Editing>(null);
  const [busy, setBusy] = useState(false);

  const tops = useMemo(() => topCategories(categories, kind, true), [categories, kind]);
  const ordered = [...tops.filter((top) => !top.archived), ...tops.filter((top) => top.archived)];
  const totalBudget =
    kind === 'living'
      ? tops.filter((top) => !top.archived).reduce((sum, top) => sum + (budgetFor(budgets, top.id, fiscalYear) ?? 0), 0)
      : 0;

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);
  const replace = (updated: MoneyCategory) =>
    onCategories((prev) => prev.map((category) => (category.id === updated.id ? updated : category)));

  const seed = async () => {
    setBusy(true);
    try {
      const created = await insertDefaultMoneyCategories(supabase, familyId);
      onCategories((prev) => [...prev, ...created]);
    } catch {
      failed('作成');
    } finally {
      setBusy(false);
    }
  };

  const siblingsOf = (category: { parentId: string | null; kind: MoneyCategoryKind }) =>
    category.parentId === null
      ? topCategories(categories, category.kind, true)
      : childCategories(categories, category.parentId, true);

  /** 並びを1つ動かす。きょうだいの並びを数え直し、変わったものだけ保存する。 */
  const move = async (category: MoneyCategory, delta: -1 | 1) => {
    const siblings = siblingsOf(category);
    const index = siblings.findIndex((entry) => entry.id === category.id);
    const target = index + delta;
    if (target < 0 || target >= siblings.length) return;
    const reordered = [...siblings];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    const changed = reordered
      .map((entry, position) => ({ entry, position }))
      .filter(({ entry, position }) => entry.position !== position);
    onCategories((prev) =>
      prev.map((entry) => {
        const hit = changed.find((change) => change.entry.id === entry.id);
        return hit ? { ...entry, position: hit.position } : entry;
      }),
    );
    try {
      await Promise.all(changed.map(({ entry, position }) => updateMoneyCategory(supabase, entry.id, { position })));
    } catch {
      failed('並べ替え');
    }
  };

  const save = async (result: SheetResult) => {
    const target = editing;
    setEditing(null);
    if (target === null) return;
    try {
      let category: MoneyCategory;
      if (target.category === null) {
        const siblings = siblingsOf({ parentId: target.parentId, kind });
        category = await insertMoneyCategory(supabase, familyId, {
          kind,
          parentId: target.parentId,
          name: result.name,
          position: siblings.reduce((max, entry) => Math.max(max, entry.position + 1), 0),
        });
        const created = category;
        onCategories((prev) => [...prev, created]);
      } else {
        category = target.category;
        if (result.name.trim() !== category.name) {
          category = await updateMoneyCategory(supabase, category.id, { name: result.name });
          replace(category);
        }
      }
      if (result.budget !== null && result.budget !== budgetFor(budgets, category.id, fiscalYear)) {
        const saved = await saveMoneyBudget(supabase, familyId, category.id, fiscalYear, result.budget);
        onBudgets((prev) => [...prev.filter((entry) => entry.id !== saved.id), saved]);
      }
    } catch {
      failed('保存');
    }
  };

  const toggleArchive = async (category: MoneyCategory) => {
    setEditing(null);
    try {
      replace(await updateMoneyCategory(supabase, category.id, { archived: !category.archived }));
    } catch {
      failed('保存');
    }
  };

  return (
    <FullScreen onBack={onClose}>
      <ScreenHeader title="種類と予算" onClose={onClose} />
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5">
        <button type="button" aria-label="前の年度" onClick={() => setFiscalYear((year) => year - 1)} className={yearButtonClass}>
          <ChevronLeft size={18} />
        </button>
        <span className="text-base font-bold text-gray-900 tabular-nums">{formatFiscalYear(fiscalYear)}</span>
        <button type="button" aria-label="次の年度" onClick={() => setFiscalYear((year) => year + 1)} className={yearButtonClass}>
          <ChevronRight size={18} />
        </button>
        <span className="flex-1" />
        {KIND_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={kind === option.id}
            onClick={() => setKind(option.id)}
            className={`rounded-full px-3 py-1.5 text-[13px] ${
              kind === option.id ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-700'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {kind === 'living' && tops.length > 0 && (
        <p className="shrink-0 px-4 pb-1.5 text-xs font-semibold text-gray-500 tabular-nums">月の予算の合計 {formatYen(totalBudget)}</p>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto bg-gray-50 px-4 pt-2 pb-8 space-y-2.5">
        {categories.length === 0 && (
          <div className="space-y-3 py-4">
            <p className="text-sm leading-relaxed text-gray-500">
              種類がまだありません。Zaim のカテゴリをもとにした標準の種類で始めて、名前や並びをあとで直せます。
            </p>
            <PrimaryButton label="標準の種類で始める" onClick={() => void seed()} disabled={busy} />
          </div>
        )}
        {ordered.map((top) => {
          const children = childCategories(categories, top.id, true);
          const budget = kind === 'living' ? budgetFor(budgets, top.id, fiscalYear) : null;
          return (
            <div key={top.id} className={`space-y-2.5 rounded-xl border border-gray-200 bg-white p-3 ${top.archived ? 'opacity-50' : ''}`}>
              <button
                type="button"
                onClick={() => setEditing({ category: top })}
                className="flex w-full items-center gap-2 text-left"
              >
                <span className="text-[15px] font-bold text-gray-900">{top.name}</span>
                {top.archived && <span className="text-[11px] font-semibold text-gray-400">使わない</span>}
                <span className="flex-1" />
                {kind === 'living' && (
                  <span className="text-[13px] font-semibold text-gray-700 tabular-nums">
                    {budget === null ? '予算なし' : `月 ${formatYen(budget)}`}
                  </span>
                )}
                <ChevronRight size={16} className="text-gray-400" />
              </button>
              <div className="flex flex-wrap gap-1.5">
                {children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    onClick={() => setEditing({ category: child })}
                    className={`rounded-full bg-gray-100 px-2.5 py-1.5 text-[13px] text-gray-700 ${child.archived ? 'opacity-50' : ''}`}
                  >
                    {child.name}
                  </button>
                ))}
                <button
                  type="button"
                  aria-label={`${top.name}に小分類を足す`}
                  onClick={() => setEditing({ category: null, parentId: top.id })}
                  className="flex items-center gap-0.5 rounded-full bg-blue-50 px-2.5 py-1.5 text-[13px] font-semibold text-blue-600"
                >
                  <Plus size={14} />
                  小分類
                </button>
              </div>
            </div>
          );
        })}
        {categories.length > 0 && (
          <button
            type="button"
            onClick={() => setEditing({ category: null, parentId: null })}
            className="flex items-center gap-2 py-2.5 text-[15px] font-bold text-blue-600"
          >
            <Plus size={18} />
            大分類を足す
          </button>
        )}
      </div>

      {editing !== null && (
        <CategoryModal
          key={editing.category?.id ?? `new-${editing.category === null ? editing.parentId : ''}`}
          category={editing.category}
          isTop={editing.category === null ? editing.parentId === null : editing.category.parentId === null}
          showBudget={kind === 'living'}
          fiscalYear={fiscalYear}
          budget={editing.category ? budgetFor(budgets, editing.category.id, fiscalYear) : null}
          onClose={() => setEditing(null)}
          onSubmit={(result) => void save(result)}
          onMove={
            editing.category
              ? (delta) => {
                  const category = editing.category!;
                  setEditing(null);
                  void move(category, delta);
                }
              : undefined
          }
          onToggleArchive={editing.category ? () => void toggleArchive(editing.category!) : undefined}
        />
      )}
    </FullScreen>
  );
}

interface SheetResult {
  name: string;
  /** 大分類の月の予算。入れなかった・小分類は null。 */
  budget: number | null;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

function CategoryModal({
  category,
  isTop,
  showBudget,
  fiscalYear,
  budget,
  onClose,
  onSubmit,
  onMove,
  onToggleArchive,
}: {
  category: MoneyCategory | null;
  isTop: boolean;
  showBudget: boolean;
  fiscalYear: number;
  budget: number | null;
  onClose: () => void;
  onSubmit: (result: SheetResult) => void;
  onMove?: (delta: -1 | 1) => void;
  onToggleArchive?: () => void;
}) {
  const [name, setName] = useState(category?.name ?? '');
  const [amount, setAmount] = useState(budget === null ? '' : String(budget));
  const [error, setError] = useState<string | null>(null);
  const withBudget = isTop && showBudget;

  const submit = () => {
    if (name.trim() === '') return setError('名前を入れてください');
    const value = amount.trim() === '' ? null : parseAmountInput(amount);
    if (withBudget && amount.trim() !== '' && value === null) return setError('予算は0以上の整数（円）で入れてください');
    onSubmit({ name, budget: withBudget ? value : null });
  };

  const moveClass = 'flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1.5 text-[13px] font-semibold text-gray-700';

  return (
    <ModalShell
      title={category ? (isTop ? '大分類を編集' : '小分類を編集') : isTop ? '大分類を足す' : '小分類を足す'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <PrimaryButton label="保存する" onClick={submit} />
          {onToggleArchive && category && (
            <button
              type="button"
              onClick={onToggleArchive}
              className={`w-full py-2 text-sm ${category.archived ? 'font-bold text-blue-600' : 'text-red-500'}`}
            >
              {category.archived ? 'また使う' : '使わなくする（記録には残ります）'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={labelClass}>名前</span>
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={isTop ? '例: 食費' : '例: 外食'}
          />
        </label>
        {withBudget && (
          <label className="block">
            <span className={labelClass}>{formatFiscalYear(fiscalYear)}の月の予算（円）</span>
            <input
              className={`${inputClass} tabular-nums`}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputMode="numeric"
              placeholder="未設定"
            />
            <span className="mt-1 block text-[11px] text-gray-400">次の年度も、直すまで同じ額を使います</span>
          </label>
        )}
        {onMove && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-gray-700">並び</span>
            <button type="button" onClick={() => onMove(-1)} className={moveClass}>
              <ArrowUp size={16} />
              上へ
            </button>
            <button type="button" onClick={() => onMove(1)} className={moveClass}>
              <ArrowDown size={16} />
              下へ
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
