'use client';

import { useState } from 'react';
import { Minus, Plus, X } from 'lucide-react';
import type { SpecialItem, SpecialItemDraft, SpecialKind } from '@/types/app';
import { YEAR_MONTHS, cycleLabel, formatYear, parseAmountInput, sortPlans } from '@/lib/specialUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import { ModalShell } from '../modals/TaskForm';

// 支出予定・収入予定（特別費）の項目を足す・直す（docs/kakei.md §3.5・§4.3）。mobile版の
// `mobile/src/components/money/SpecialItemSheet.tsx` と同じ項目・同じ文言。
//
// 周期と、月ごとの予定（月・金額）を入れる。実績は入れない（払った額は家計の記録に、特別費の項目として記録する）。

interface PlanForm {
  id: string | null;
  month: number | null;
  amount: string;
  tentative: boolean;
}

interface FormState {
  kind: SpecialKind;
  name: string;
  category: string;
  cycleYears: number;
  baseYear: number;
  plans: PlanForm[];
  note: string;
}

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '収入' },
];

/** 周期の選び方。既にある値（7年おきなど）はそれも並べる。 */
const CYCLE_CHOICES = [1, 2, 3, 5, 10, 0];

const emptyPlan = (): PlanForm => ({ id: null, month: null, amount: '', tentative: false });

const initialState = (item: SpecialItem | null, defaultKind: SpecialKind, year: number): FormState =>
  item
    ? {
        kind: item.kind,
        name: item.name,
        category: item.category,
        cycleYears: item.cycleYears,
        baseYear: item.baseYear ?? year,
        plans: sortPlans(item.plans).map((plan) => ({
          id: plan.id,
          month: plan.month,
          amount: String(plan.amount),
          tentative: plan.tentative,
        })),
        note: item.note,
      }
    : {
        kind: defaultKind,
        name: '',
        category: '',
        cycleYears: 1,
        baseYear: year,
        plans: [emptyPlan()],
        note: '',
      };

interface SpecialItemModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  item: SpecialItem | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** 追加するときの種類（いま見ている支出/収入）。 */
  defaultKind: SpecialKind;
  /** いま見ている年。周期の起点の既定に使う。 */
  year: number;
  onClose: () => void;
  onSubmit: (draft: SpecialItemDraft) => void;
  onDelete?: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

function Chip({ label, selected, onPick }: { label: string; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
        selected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      }`}
    >
      {label}
    </button>
  );
}

export default function SpecialItemModal({
  item,
  categories,
  defaultKind,
  year,
  onClose,
  onSubmit,
  onDelete,
}: SpecialItemModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item, defaultKind, year));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const updatePlan = (index: number, patch: Partial<PlanForm>) =>
    setForm((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) => (i === index ? { ...plan, ...patch } : plan)),
    }));

  const isEditing = item !== null;
  // 予定の無い項目（予定外の出費）を直すときは、予定が0件のままでも保存できる。
  const minPlans = item && item.plans.length === 0 ? 0 : 1;
  const cycleChoices = CYCLE_CHOICES.includes(form.cycleYears) ? CYCLE_CHOICES : [...CYCLE_CHOICES, form.cycleYears];

  const fail = (message: string) => setError(message);

  const handleSubmit = () => {
    if (form.name.trim() === '') return fail('名前を入れてください');

    if (form.plans.length < minPlans) return fail('予定を1つ以上入れてください');
    const plans: SpecialItemDraft['plans'] = [];
    for (const plan of form.plans) {
      const amount = parseAmountInput(plan.amount);
      if (amount === null) return fail('予定の金額は0以上の整数（円）で入れてください');
      plans.push({ id: plan.id, month: plan.month, amount, tentative: plan.tentative && plan.month !== null });
    }
    onSubmit({
      kind: form.kind,
      category: form.category.trim(),
      name: form.name.trim(),
      cycleYears: form.cycleYears,
      // 毎年なら起点は持たない（既にある起点はそのまま残す）。
      baseYear: form.cycleYears === 1 ? (item?.baseYear ?? null) : form.baseYear,
      note: form.note,
      plans,
    });
  };

  const handleDelete = () => {
    if (window.confirm('この項目を削除しますか？予定と、この項目で記録した特別費もいっしょに消えます。')) onDelete?.();
  };

  return (
    <ModalShell
      title={isEditing ? '項目を編集' : '予定を追加'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition"
          >
            {isEditing ? '保存する' : '追加する'}
          </button>
          {isEditing && onDelete && (
            <button type="button" onClick={handleDelete} className="w-full py-2 text-sm text-red-500">
              削除する
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <SegmentedTabs options={KIND_OPTIONS} value={form.kind} onChange={(kind) => update({ kind })} ariaLabel="支出か収入か" />

        <label className="block">
          <span className={labelClass}>名前</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="例: 自動車税"
          />
        </label>

        <div>
          <label className="block">
            <span className={labelClass}>種類</span>
            <input
              className={inputClass}
              value={form.category}
              onChange={(event) => update({ category: event.target.value })}
              placeholder="例: 税金"
            />
          </label>
          {categories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pt-2 pb-0.5">
              {categories.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={option === form.category.trim()}
                  onPick={() => update({ category: option })}
                />
              ))}
            </div>
          )}
        </div>

        <div>
          <span className={labelClass}>周期</span>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {cycleChoices.map((years) => (
              <Chip
                key={years}
                label={cycleLabel(years)}
                selected={years === form.cycleYears}
                onPick={() => update({ cycleYears: years })}
              />
            ))}
          </div>
          {form.cycleYears !== 1 && (
            <div className="flex items-center gap-2 mt-2">
              <span className="text-xs font-bold text-gray-500">
                {form.cycleYears === 0 ? '出る年' : '最初に出る年'}
              </span>
              <button
                type="button"
                aria-label="年を戻す"
                onClick={() => update({ baseYear: form.baseYear - 1 })}
                className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
              >
                <Minus size={14} className="text-gray-600" />
              </button>
              <span className="min-w-[72px] text-center text-sm font-bold text-gray-900 tabular-nums">
                {formatYear(form.baseYear)}
              </span>
              <button
                type="button"
                aria-label="年を進める"
                onClick={() => update({ baseYear: form.baseYear + 1 })}
                className="w-7 h-7 rounded-lg bg-gray-100 flex items-center justify-center hover:bg-gray-200"
              >
                <Plus size={14} className="text-gray-600" />
              </button>
            </div>
          )}
          <span className="block text-[11px] text-gray-400 mt-1">
            {form.cycleYears === 1
              ? '毎年出ます'
              : form.cycleYears === 0
                ? 'その年だけ出ます'
                : `その年から ${form.cycleYears} 年ごとに出ます（間の年には出ません）`}
          </span>
        </div>

        <div>
          <span className={labelClass}>予定（1年の中で出る回数ぶん）</span>
          <div className="space-y-2">
            {form.plans.map((plan, index) => (
              <div key={plan.id ?? `new-${index}`} className="space-y-2 p-2.5 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-500">{index + 1}回目</span>
                  {form.plans.length > minPlans && (
                    <button
                      type="button"
                      aria-label={`${index + 1}回目の予定を消す`}
                      onClick={() => setForm((prev) => ({ ...prev, plans: prev.plans.filter((_, i) => i !== index) }))}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                  {[...YEAR_MONTHS, null].map((month) => (
                    <Chip
                      key={month ?? 'none'}
                      label={month === null ? '月未定' : `${month}月`}
                      selected={month === plan.month}
                      onPick={() => updatePlan(index, { month })}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    className={inputClass}
                    value={plan.amount}
                    onChange={(event) => updatePlan(index, { amount: event.target.value })}
                    inputMode="numeric"
                    placeholder="金額（円）"
                  />
                  <Chip
                    label="仮"
                    selected={plan.tentative && plan.month !== null}
                    onPick={() => updatePlan(index, { tentative: !plan.tentative })}
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setForm((prev) => ({ ...prev, plans: [...prev.plans, emptyPlan()] }))}
            className="flex items-center gap-1 py-1.5 mt-1 text-[13px] font-bold text-blue-600"
          >
            <Plus size={14} />
            予定を追加（年に複数回出るとき）
          </button>
        </div>

        <label className="block">
          <span className={labelClass}>メモ</span>
          <input
            className={inputClass}
            value={form.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder="任意"
          />
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
