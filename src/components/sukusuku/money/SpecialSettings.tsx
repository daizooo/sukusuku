'use client';

import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { SpecialItem, SpecialItemDraft, SpecialKind } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { deleteSpecialItem, insertSpecialItem, updateSpecialItem } from '@/lib/api/specialExpenses';
import { appliesInYear, buildYearRows, formatYear, groupByMonth, yearTotals } from '@/lib/specialUtils';
import { categoryOptions } from '@/lib/stockUtils';
import { formatYen } from '@/lib/moneyUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import SpecialItemModal from './SpecialItemModal';
import { cardClass, incomeAmountClass, ScreenHeader, SectionHeader, type, YearBar } from './moneyVisual';

// 特別費の予定（家計の設定。docs/kakei.md §3.5・§4.3）。mobile版の `mobile/src/components/money/SpecialSettings.tsx` と同じ並び・文言。
//
// 支出予定と収入予定（年に数回の大きな出費・賞与など）の編集だけを持つ。年（1月〜12月）で送り、予定を月ごとに並べる。
// 「済」にする・実績を直す操作は無い。払った額は家計の記録に特別費の項目として入れ、いまどのくらい使っているかは
// 振り返りの内訳の「特別費」から追う。

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '支出予定' },
  { id: 'income', label: '収入予定' },
];

interface SpecialSettingsProps {
  familyId: string;
  /** はじめに見る年（暦年）。 */
  year: number;
  items: SpecialItem[];
  onItems: (update: (prev: SpecialItem[]) => SpecialItem[]) => void;
  /** 項目を消すと、その項目で記録した特別費の記録も消える。家計タブの記録を読み直す。 */
  onRecordsChanged: () => void;
  onBack: () => void;
}

export default function SpecialSettings({ familyId, year: initialYear, items, onItems, onRecordsChanged, onBack }: SpecialSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const [year, setYear] = useState(initialYear);
  const [kind, setKind] = useState<SpecialKind>('expense');
  const [editing, setEditing] = useState<SpecialItem | 'new' | null>(null);

  // 予定の行だけ（実績は渡さない）。
  const rows = useMemo(() => buildYearRows(items, [], year, kind), [items, year, kind]);
  const groups = useMemo(() => groupByMonth(rows), [rows]);
  const total = useMemo(() => yearTotals(rows).budget, [rows]);
  // この年には出ない項目（編集・削除ができるよう、別に並べる）。
  const others = useMemo(
    () => items.filter((item) => item.kind === kind && !appliesInYear(item, year)),
    [items, kind, year],
  );
  const categories = useMemo(() => categoryOptions(items), [items]);
  const label = kind === 'income' ? '収入予定' : '支出予定';
  // 支出予定は「−」をつけた黒、収入予定は緑（「+」はつけない。0円は符号なし）。
  const signed = (amount: number) => (amount === 0 ? formatYen(0) : kind === 'income' ? formatYen(amount) : `−${formatYen(amount)}`);
  const plusClass = kind === 'income' ? incomeAmountClass : 'text-gray-900';

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);
  const nextPosition = () => items.reduce((max, item) => Math.max(max, item.position + 1), 0);

  const save = async (draft: SpecialItemDraft) => {
    const target = editing;
    setEditing(null);
    try {
      if (target === 'new' || target === null) {
        const created = await insertSpecialItem(supabase, familyId, draft, nextPosition());
        onItems((prev) => [...prev, created]);
        setKind(created.kind);
      } else {
        const updated = await updateSpecialItem(supabase, familyId, target.id, draft, target.plans);
        onItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
        setKind(updated.kind);
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (item: SpecialItem) => {
    setEditing(null);
    try {
      await deleteSpecialItem(supabase, item.id);
      onItems((prev) => prev.filter((entry) => entry.id !== item.id));
      onRecordsChanged();
    } catch {
      failed('削除');
    }
  };

  const monthLabel = (month: number | null) => (month === null ? '月未定' : `${year}年${month}月`);

  return (
    <>
      <ScreenHeader title="特別費の予定" icon="back" onClose={onBack} />
      <YearBar year={year} onChange={setYear} />
      <SegmentedTabs
        options={KIND_OPTIONS}
        value={kind}
        onChange={setKind}
        ariaLabel="支出予定か収入予定か"
        className="mx-4 mb-1.5 shrink-0"
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-1.5">
        <div className="py-1">
          <p className={type.sub}>
            {formatYear(year)}の{label}
          </p>
          <p className={`text-[32px] leading-tight font-bold tabular-nums ${plusClass}`}>{signed(total)}</p>
        </div>

        <SectionHeader
          compact
          title="予定"
          hint="月ごと"
          right={
            <button type="button" onClick={() => setEditing('new')} className={`flex items-center gap-0.5 ${type.link}`}>
              <Plus size={14} />
              項目を追加
            </button>
          }
        />

        {groups.length === 0 ? (
          <p className="px-6 py-6 text-center text-[13px] text-gray-400">
            {items.length > 0
              ? `${formatYear(year)}の${label}はありません`
              : '年に数回の大きな出費や賞与を「項目を追加」で登録すると、振り返りの内訳で予算と使った額を見られます'}
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.month ?? 'none'} className="mb-2">
              <div className="flex items-baseline justify-between px-1 pb-1">
                <h4 className="text-xs font-bold text-gray-700">{monthLabel(group.month)}</h4>
                <span className="text-xs font-bold tabular-nums text-gray-500">{signed(group.budget)}</span>
              </div>
              <ul className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
                {group.rows.map((row) => {
                  const sub = [row.item.category, row.tentative ? '月は仮' : ''].filter((text) => text !== '').join('・');
                  return (
                    <li key={row.key}>
                      <button
                        type="button"
                        aria-label={`${row.item.name}を編集`}
                        onClick={() => setEditing(row.item)}
                        className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left hover:bg-gray-50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-gray-900">{row.item.name}</span>
                          {sub !== '' && <span className="block text-[11px] font-medium text-gray-500">{sub}</span>}
                        </span>
                        <span className={`text-[17px] font-extrabold tabular-nums ${plusClass}`}>{signed(row.budget)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        {others.length > 0 && (
          <>
            <SectionHeader compact title={`${formatYear(year)}は予定のない項目`} />
            <ul className={`${cardClass} divide-y divide-gray-200 overflow-hidden`}>
              {others.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-label={`${item.name}を編集`}
                    onClick={() => setEditing(item)}
                    className="flex w-full items-center gap-2.5 px-3 py-[7px] text-left hover:bg-gray-50"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-gray-900">{item.name}</span>
                    <span className={type.faint}>{item.category}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {editing !== null && (
        <SpecialItemModal
          key={editing === 'new' ? 'new' : editing.id}
          item={editing === 'new' ? null : editing}
          categories={categories}
          defaultKind={kind}
          year={year}
          onClose={() => setEditing(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing)}
        />
      )}
    </>
  );
}
