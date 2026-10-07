'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SpecialActual, SpecialActualDraft, SpecialItem, SpecialKind } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { toDateString } from '@/lib/dateUtils';
import {
  deleteSpecialActual,
  deleteSpecialItem,
  insertSpecialActual,
  insertSpecialItem,
  insertUnplannedSpecial,
  loadSpecialExpenses,
  updateSpecialActual,
  updateSpecialItem,
} from '@/lib/api/specialExpenses';
import {
  buildYearRows,
  calendarYearOf,
  fiscalYearOf,
  fiscalYearOfDate,
  formatFiscalYear,
  groupByMonth,
  isOverBudget,
  yearTotals,
  type SpecialRow,
} from '@/lib/specialUtils';
import { categoryOptions } from '@/lib/stockUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import SpecialItemModal, { type SpecialItemModalResult } from '../modals/SpecialItemModal';
import SpecialActualModal from '../modals/SpecialActualModal';

// 暮らしタブの「特別費」の面（docs/home.md §5.4）。mobile版の
// `mobile/src/components/living/SpecialPanel.tsx` と同じ項目・並び・文言。
//
// 年度（4月〜翌3月）ごとに、特別費（支出）と特別収入（賞与など）の「予算・実績・差異」を見る。
// 一覧は月ごと（4月→3月）で、1行＝予定1回ぶん（または予定外の出費1件）。
// 予定の行の左の丸を1回押すと、予算の額・今日の日付で実績になる（額が違えば行を押して直す）。
// 上（年度・支出/収入・合計）は固定で、スクロールするのは月ごとの一覧だけ。

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '特別費（支出）' },
  { id: 'income', label: '特別収入' },
];

const signed = (value: number) => `${value < 0 ? '−' : ''}${formatPrice(Math.abs(value))}`;

interface SpecialPanelProps {
  familyId: string;
  /** ヘッダーの「追加」が押された。 */
  adding: boolean;
  onAddClose: () => void;
}

export default function SpecialPanel({ familyId, adding, onAddClose }: SpecialPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<SpecialItem[]>([]);
  const [actuals, setActuals] = useState<SpecialActual[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [fiscalYear, setFiscalYear] = useState(() => fiscalYearOfDate(new Date()));
  const [kind, setKind] = useState<SpecialKind>('expense');
  const [editingRow, setEditingRow] = useState<SpecialRow | null>(null);
  const [editingItem, setEditingItem] = useState<SpecialItem | null>(null);

  useEffect(() => {
    let isMounted = true;
    loadSpecialExpenses(supabase, familyId)
      .then((loaded) => {
        if (!isMounted) return;
        setItems(loaded.items);
        setActuals(loaded.actuals);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId]);

  const rows = useMemo(() => buildYearRows(items, actuals, fiscalYear, kind), [items, actuals, fiscalYear, kind]);
  const groups = useMemo(() => groupByMonth(rows), [rows]);
  const totals = useMemo(() => yearTotals(rows), [rows]);
  // 収入と支出の差引（予算どおり・実績どおり）。
  const balance = useMemo(() => {
    const income = yearTotals(buildYearRows(items, actuals, fiscalYear, 'income'));
    const expense = yearTotals(buildYearRows(items, actuals, fiscalYear, 'expense'));
    return { budget: income.budget - expense.budget, actual: income.actual - expense.actual };
  }, [items, actuals, fiscalYear]);
  const categories = useMemo(() => categoryOptions(items), [items]);
  const hasAnything = items.length > 0;

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);
  const nextPosition = () => items.reduce((max, item) => Math.max(max, item.position + 1), 0);
  const withActual = (actual: SpecialActual) => setActuals((prev) => [...prev.filter((a) => a.id !== actual.id), actual]);

  /** 「済」: 予算の額・今日の日付で実績にする。 */
  const markPaid = async (row: SpecialRow) => {
    if (row.planId === null) return;
    try {
      const created = await insertSpecialActual(supabase, familyId, row.item.id, row.planId, {
        occurredOn: toDateString(new Date()),
        amount: row.budget,
        note: '',
      });
      withActual(created);
    } catch {
      failed('保存');
    }
  };

  const saveActual = async (row: SpecialRow, draft: SpecialActualDraft) => {
    setEditingRow(null);
    try {
      const existing = row.actuals[0];
      withActual(
        existing
          ? await updateSpecialActual(supabase, existing.id, draft)
          : await insertSpecialActual(supabase, familyId, row.item.id, row.planId, draft),
      );
    } catch {
      failed('保存');
    }
  };

  const clearActual = async (row: SpecialRow) => {
    setEditingRow(null);
    const removedIds = row.actuals.map((actual) => actual.id);
    const previous = { items, actuals };
    setActuals((prev) => prev.filter((actual) => !removedIds.includes(actual.id)));
    // 予定の無い項目の唯一の実績を消したら、項目も残さない。
    const orphan =
      row.planId === null &&
      row.item.plans.length === 0 &&
      !actuals.some((actual) => actual.itemId === row.item.id && !removedIds.includes(actual.id));
    if (orphan) setItems((prev) => prev.filter((item) => item.id !== row.item.id));
    try {
      if (orphan) await deleteSpecialItem(supabase, row.item.id);
      else await Promise.all(removedIds.map((id) => deleteSpecialActual(supabase, id)));
    } catch {
      setItems(previous.items);
      setActuals(previous.actuals);
      failed('削除');
    }
  };

  const saveItem = async (result: SpecialItemModalResult) => {
    const target = editingItem;
    setEditingItem(null);
    onAddClose();
    try {
      if (result.type === 'unplanned') {
        const created = await insertUnplannedSpecial(
          supabase,
          familyId,
          result.fields,
          result.actual,
          fiscalYearOf(result.actual.occurredOn),
          nextPosition(),
        );
        setItems((prev) => [...prev, created.item]);
        withActual(created.actual);
        setKind(created.item.kind);
        setFiscalYear(fiscalYearOf(result.actual.occurredOn));
      } else if (target === null) {
        const created = await insertSpecialItem(supabase, familyId, result.draft, nextPosition());
        setItems((prev) => [...prev, created]);
        setKind(created.kind);
      } else {
        const updated = await updateSpecialItem(supabase, familyId, target.id, result.draft, target.plans);
        setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        // 予定を消した実績は予定外として残る（DBの on delete set null）。画面の実績も合わせる。
        const planIds = new Set(updated.plans.map((plan) => plan.id));
        setActuals((prev) =>
          prev.map((actual) =>
            actual.itemId === updated.id && actual.planId !== null && !planIds.has(actual.planId)
              ? { ...actual, planId: null }
              : actual,
          ),
        );
      }
    } catch {
      failed('保存');
    }
  };

  const removeItem = async (id: string) => {
    setEditingItem(null);
    const previous = { items, actuals };
    setItems((prev) => prev.filter((item) => item.id !== id));
    setActuals((prev) => prev.filter((actual) => actual.itemId !== id));
    try {
      await deleteSpecialItem(supabase, id);
    } catch {
      setItems(previous.items);
      setActuals(previous.actuals);
      failed('削除');
    }
  };

  const monthLabel = (month: number | null) =>
    month === null ? '月未定' : `${calendarYearOf(fiscalYear, month)}年${month}月`;

  return (
    <>
      <div className="shrink-0 flex items-center gap-2 pb-2">
        <button
          type="button"
          aria-label="前の年度"
          onClick={() => setFiscalYear((year) => year - 1)}
          className="w-[30px] h-[30px] rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
        >
          <ChevronLeft size={18} className="text-gray-600" />
        </button>
        <span className="text-base font-bold text-gray-900">{formatFiscalYear(fiscalYear)}</span>
        <button
          type="button"
          aria-label="次の年度"
          onClick={() => setFiscalYear((year) => year + 1)}
          className="w-[30px] h-[30px] rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
        >
          <ChevronRight size={18} className="text-gray-600" />
        </button>
        <span className="flex-1 text-right text-[11px] text-gray-400">
          {fiscalYear}年4月〜{fiscalYear + 1}年3月
        </span>
      </div>

      <SegmentedTabs
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        ariaLabel="特別費か特別収入か"
        className="shrink-0 mb-2"
      />

      <div className="shrink-0 flex mb-1.5 rounded-xl border border-gray-200 bg-white py-2">
        <div className="flex-1 text-center">
          <p className="text-[11px] font-bold text-gray-500">予算</p>
          <p className="mt-0.5 text-[15px] font-bold text-gray-900 tabular-nums">{formatPrice(totals.budget)}</p>
        </div>
        <div className="flex-1 text-center">
          <p className="text-[11px] font-bold text-gray-500">実績</p>
          <p className="mt-0.5 text-[15px] font-bold text-gray-900 tabular-nums">{formatPrice(totals.actual)}</p>
        </div>
        <div className="flex-1 text-center">
          <p className="text-[11px] font-bold text-gray-500">差異</p>
          <p
            className={`mt-0.5 text-[15px] font-bold tabular-nums ${
              totals.diff < 0 && kind === 'expense' ? 'text-red-700' : 'text-gray-900'
            }`}
          >
            {signed(totals.diff)}
          </p>
        </div>
      </div>
      {hasAnything && (
        <p className="shrink-0 pb-2 text-[11px] font-bold text-gray-500 tabular-nums">
          収入 − 支出　予算 {signed(balance.budget)} ／ 実績 {signed(balance.actual)}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 px-6">
          {hasAnything
            ? `${formatFiscalYear(fiscalYear)}の${kind === 'expense' ? '特別費' : '特別収入'}はありません`
            : '年に数回の大きな出費や賞与を「追加」で登録すると、年度ごとの予算と実績を見られます'}
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-6">
          {groups.map((group) => (
            <section key={group.month ?? 'none'} className="mb-3">
              <div className="flex items-baseline justify-between pb-1">
                <h3 className="text-[13px] font-bold text-gray-700">{monthLabel(group.month)}</h3>
                <span className="text-[11px] text-gray-400 tabular-nums">
                  予算 {formatPrice(group.budget)} ／ 実績 {formatPrice(group.actual)}
                </span>
              </div>
              <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
                {group.rows.map((row) => {
                  const paid = row.actual !== null;
                  const over = isOverBudget(row);
                  const sub = [row.item.category, row.tentative ? '月は仮' : '', row.planId === null ? '予定外' : '']
                    .filter((text) => text !== '')
                    .join('・');
                  return (
                    <li key={row.key} className={`flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 ${paid ? '' : 'opacity-90'}`}>
                      {row.planId !== null ? (
                        <button
                          type="button"
                          aria-label={paid ? `${row.item.name}は済み。実績を直す` : `${row.item.name}を済にする`}
                          onClick={() => (paid ? setEditingRow(row) : void markPaid(row))}
                          className={`shrink-0 w-7 h-7 rounded-full border-2 flex items-center justify-center ${
                            paid ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-transparent hover:border-blue-400'
                          }`}
                        >
                          <Check size={16} />
                        </button>
                      ) : (
                        <span className="shrink-0 w-7 h-7 rounded-full border-2 border-blue-600 bg-blue-600 text-white flex items-center justify-center">
                          <Check size={16} />
                        </span>
                      )}
                      <button type="button" onClick={() => setEditingRow(row)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-gray-900">{row.item.name}</span>
                          {sub !== '' && <span className="block text-[11px] text-gray-400 mt-0.5">{sub}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          {row.planId !== null && (
                            <span className="block text-[11px] text-gray-400 tabular-nums">予算 {formatPrice(row.budget)}</span>
                          )}
                          {paid ? (
                            <span className={`block mt-0.5 text-[13px] font-bold tabular-nums ${over ? 'text-red-700' : 'text-gray-700'}`}>
                              実績 {formatPrice(row.actual!)}
                            </span>
                          ) : (
                            <span className="block mt-0.5 text-xs font-bold text-gray-400">未</span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {editingRow !== null && (
        <SpecialActualModal
          key={editingRow.key}
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSubmit={(draft) => void saveActual(editingRow, draft)}
          onClear={editingRow.actuals.length > 0 ? () => void clearActual(editingRow) : undefined}
          onEditItem={() => {
            const item = editingRow.item;
            setEditingRow(null);
            setEditingItem(item);
          }}
        />
      )}

      {(adding || editingItem !== null) && (
        <SpecialItemModal
          key={editingItem === null ? 'new' : editingItem.id}
          item={editingItem}
          categories={categories}
          defaultKind={kind}
          fiscalYear={fiscalYear}
          onClose={() => {
            setEditingItem(null);
            onAddClose();
          }}
          onSubmit={(result) => void saveItem(result)}
          onDelete={editingItem === null ? undefined : () => void removeItem(editingItem.id)}
        />
      )}
    </>
  );
}
