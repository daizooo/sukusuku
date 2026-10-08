'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
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
  formatFiscalYear,
  groupByMonth,
  isOverBudget,
  yearTotals,
  type SpecialRow,
} from '@/lib/specialUtils';
import { categoryOptions } from '@/lib/stockUtils';
import { formatYen } from '@/lib/moneyUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import SpecialItemModal, { type SpecialItemModalResult } from '../modals/SpecialItemModal';
import SpecialActualModal from '../modals/SpecialActualModal';
import { Hero, ProgressBar, SectionHeader, YearBar, cardClass, minus, type } from '../money/moneyVisual';

// 家計タブの「特別費」（docs/home.md §5.4・docs/kakei.md §4.3）。年度の予定と実績。
// mobile版の `mobile/src/components/living/SpecialPanel.tsx` と同じ項目・並び・文言。
//
// 年度の送りと「特別費 / 特別収入」の切り替えは固定し、下をスクロールする。
// 結論は年度に払った額（特別収入は入った額）と、予算に対する進み具合・残り。
// その下に予定と実績を月ごと（4月→3月）に。1行＝予定1回ぶん（または予定外の出費1件）。
// 行の左の丸を1回押すと、予算の額・今日の日付で実績になる（額が違えば行を押して直す）。
// 実績は家計の記録の品目（docs/kakei.md §3.2）。「済」は品目1つの記録を作り、「記録」にも出る。

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '特別費' },
  { id: 'income', label: '特別収入' },
];

interface SpecialPanelProps {
  familyId: string;
  /** 年度（4月始まり）。「年」と同じ年度を見る。 */
  fiscalYear: number;
  /** 予定外の出費を足したとき、その年度へ移る。 */
  onFiscalYear: (fiscalYear: number) => void;
  /** 実績（家計の記録）を足した・直した・消した。家計タブの記録を読み直す。 */
  onRecordsChanged?: () => void;
}

export default function SpecialPanel({ familyId, fiscalYear, onFiscalYear, onRecordsChanged }: SpecialPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<SpecialItem[]>([]);
  const [actuals, setActuals] = useState<SpecialActual[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kind, setKind] = useState<SpecialKind>('expense');
  const [editingRow, setEditingRow] = useState<SpecialRow | null>(null);
  const [editingItem, setEditingItem] = useState<SpecialItem | null>(null);
  const [adding, setAdding] = useState(false);
  const onAddClose = () => setAdding(false);

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
  // まだ済にしていない予定の件数。
  const pending = useMemo(() => rows.filter((row) => row.planId !== null && row.actual === null).length, [rows]);
  const categories = useMemo(() => categoryOptions(items), [items]);
  const hasAnything = items.length > 0;

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);
  const nextPosition = () => items.reduce((max, item) => Math.max(max, item.position + 1), 0);
  const withActual = (actual: SpecialActual) => {
    setActuals((prev) => [...prev.filter((a) => a.id !== actual.id), actual]);
    onRecordsChanged?.();
  };

  /** 「済」: 予算の額・今日の日付で実績にする。 */
  const markPaid = async (row: SpecialRow) => {
    if (row.planId === null) return;
    try {
      const created = await insertSpecialActual(supabase, row.item.kind, row.item.id, row.planId, {
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
          ? await updateSpecialActual(supabase, existing, draft)
          : await insertSpecialActual(supabase, row.item.kind, row.item.id, row.planId, draft),
      );
    } catch {
      failed('保存');
    }
  };

  const clearActual = async (row: SpecialRow) => {
    setEditingRow(null);
    const removed = row.actuals;
    const removedIds = removed.map((actual) => actual.id);
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
      else await Promise.all(removed.map((actual) => deleteSpecialActual(supabase, actual)));
      onRecordsChanged?.();
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
        onFiscalYear(fiscalYearOf(result.actual.occurredOn));
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
      onRecordsChanged?.();
    } catch {
      setItems(previous.items);
      setActuals(previous.actuals);
      failed('削除');
    }
  };

  const monthLabel = (month: number | null) =>
    month === null ? '月未定' : `${calendarYearOf(fiscalYear, month)}年${month}月`;

  const income = kind === 'income';
  const remaining = totals.budget - totals.actual;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <YearBar fiscalYear={fiscalYear} onChange={onFiscalYear} />
      <SegmentedTabs
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        ariaLabel="特別費か特別収入か"
        className="shrink-0 mb-1.5"
      />

      {/* 右下の「＋」に一覧の最後が隠れないよう、下を空ける。 */}
      <div className="flex-1 min-h-0 overflow-y-auto pt-1.5 pb-24">
        <Hero
          label={income ? '年度に入った特別収入' : '年度に払った特別費'}
          value={formatYen(totals.actual)}
          note={
            remaining < 0
              ? `予算 ${formatYen(totals.budget)}・${formatYen(remaining)} 超過`
              : income
                ? `予定 ${formatYen(totals.budget)}・まだ ${formatYen(remaining)}`
                : `予算 ${formatYen(totals.budget)}・残り ${formatYen(remaining)}`
          }
        >
          <div className="space-y-1.5 pt-2">
            <ProgressBar ratio={totals.budget > 0 ? totals.actual / totals.budget : 0} over={!income && remaining < 0} />
            {pending > 0 && <p className={type.faint}>まだ済にしていない予定 {pending}件</p>}
          </div>
        </Hero>

        <SectionHeader
          title="予定と実績"
          hint="月ごと"
          right={
            <button type="button" onClick={() => setAdding(true)} className={`flex items-center gap-0.5 ${type.link}`}>
              <Plus size={14} />
              項目を追加
            </button>
          }
        />

        {isLoading ? (
          <p className="py-6 text-center text-[13px] text-gray-400">読み込み中...</p>
        ) : groups.length === 0 ? (
          <p className="px-6 py-6 text-center text-[13px] text-gray-400">
            {hasAnything
              ? `${formatFiscalYear(fiscalYear)}の${income ? '特別収入' : '特別費'}はありません`
              : '年に数回の大きな出費や賞与を「項目を追加」で登録すると、年度ごとの予算と実績を見られます'}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.month ?? 'none'} className="mb-4">
              <div className="flex items-baseline justify-between pb-1.5">
                <h4 className="text-[13px] font-bold text-gray-700">{monthLabel(group.month)}</h4>
                <span className={type.faint}>
                  {formatYen(group.actual)} / {formatYen(group.budget)}
                </span>
              </div>
              <ul className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
                {group.rows.map((row) => {
                  const paid = row.actual !== null;
                  const over = isOverBudget(row);
                  const sub = [row.item.category, row.tentative ? '月は仮' : '', row.planId === null ? '予定外' : '']
                    .filter((text) => text !== '')
                    .join('・');
                  return (
                    <li key={row.key} className="flex items-center gap-3 px-3.5 py-3 hover:bg-gray-50">
                      {row.planId !== null ? (
                        <button
                          type="button"
                          aria-label={paid ? `${row.item.name}は済み。実績を直す` : `${row.item.name}を済にする`}
                          onClick={() => (paid ? setEditingRow(row) : void markPaid(row))}
                          className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 ${
                            paid ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-300 text-transparent hover:border-blue-400'
                          }`}
                        >
                          <Check size={16} />
                        </button>
                      ) : (
                        <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 border-blue-600 bg-blue-600 text-white">
                          <Check size={16} />
                        </span>
                      )}
                      <button type="button" onClick={() => setEditingRow(row)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate ${paid ? type.row : type.row.replace('text-gray-900', 'text-gray-500')}`}>
                            {row.item.name}
                          </span>
                          {sub !== '' && <span className={`block ${type.faint}`}>{sub}</span>}
                        </span>
                        <span className="shrink-0 text-right">
                          {paid ? (
                            <span className={`block ${minus(type.amount, over)}`}>{formatYen(row.actual!)}</span>
                          ) : (
                            <span className={`block ${type.amount.replace('text-gray-900', 'text-gray-500')}`}>{formatYen(row.budget)}</span>
                          )}
                          <span className={`block ${type.faint}`}>
                            {paid ? (row.planId !== null ? `予算 ${formatYen(row.budget)}` : '予定外') : 'まだ'}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>

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
    </div>
  );
}
