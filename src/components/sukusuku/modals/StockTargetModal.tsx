'use client';

import { useState } from 'react';
import type { StockTarget, StockTargetDraft } from '@/types/app';
import { formatQuantity, requiredQuantity, type StockPlan } from '@/lib/stockUtils';
import { ModalShell } from './TaskForm';
import { Segmented } from './logModalParts';

// 防災備蓄の必要数（目標）を足す・直す（docs/home.md §3.5）。mobile版の
// `mobile/src/components/living/StockTargetSheet.tsx` と同じ項目・同じ文言。
//
// 必要数は「1人1日あたり × 人数 × 日数」か「決まった数」。入力中に、いまの人数・日数で
// 何がいくつ要るかを下に出す（水 3L なら「必要数 63L（3人×7日）」）。

interface FormState {
  name: string;
  quantity: string;
  perPersonDay: boolean;
  unit: string;
  note: string;
}

const initialState = (target: StockTarget | null): FormState =>
  target
    ? {
        name: target.name,
        quantity: formatQuantity(target.quantity),
        perPersonDay: target.perPersonDay,
        unit: target.unit,
        note: target.note,
      }
    : { name: '', quantity: '1', perPersonDay: true, unit: '', note: '' };

function toTargetDraft(form: FormState, category: string): StockTargetDraft | string {
  if (form.name.trim() === '') return '名前を入れてください';
  const quantity = Number(form.quantity.trim());
  if (form.quantity.trim() === '' || !Number.isFinite(quantity) || quantity < 0) {
    return '量は0以上の数字で入れてください';
  }
  return {
    name: form.name,
    category,
    quantity,
    perPersonDay: form.perPersonDay,
    unit: form.unit,
    note: form.note,
  };
}

interface StockTargetModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  target: StockTarget | null;
  plan: StockPlan;
  onClose: () => void;
  onSubmit: (draft: StockTargetDraft) => void;
  onDelete?: () => void;
}

type Mode = 'perPersonDay' | 'fixed';

const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: 'perPersonDay', label: '1人1日あたり' },
  { value: 'fixed', label: '決まった数' },
];

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

export default function StockTargetModal({ target, plan, onClose, onSubmit, onDelete }: StockTargetModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(target));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const quantity = Number(form.quantity);
  const required = Number.isFinite(quantity)
    ? requiredQuantity({ id: '', quantity, perPersonDay: form.perPersonDay }, plan)
    : null;

  const handleSubmit = () => {
    const draft = toTargetDraft(form, target?.category ?? '');
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    onSubmit(draft);
  };

  const handleDelete = () => {
    if (window.confirm('この必要数を削除しますか？（数えていた備蓄は残ります）')) onDelete?.();
  };

  return (
    <ModalShell
      title={target ? '必要数を編集' : '必要数を追加'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
          >
            {target ? '保存する' : '追加する'}
          </button>
          {target && onDelete && (
            <button type="button" onClick={handleDelete} className="w-full py-2 text-sm text-red-500">
              削除する
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
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="例: 水"
          />
        </label>

        <div>
          <span className={labelClass}>数え方</span>
          <Segmented
            options={MODE_OPTIONS}
            value={form.perPersonDay ? 'perPersonDay' : 'fixed'}
            onChange={(mode) => update({ perPersonDay: mode === 'perPersonDay' })}
          />
        </div>

        <div className="flex gap-3">
          <label className="block flex-1">
            <span className={labelClass}>{form.perPersonDay ? '1人1日あたり' : '必要数'}</span>
            <input
              className={inputClass}
              value={form.quantity}
              onChange={(event) => update({ quantity: event.target.value })}
              inputMode="decimal"
            />
          </label>
          <label className="block w-24">
            <span className={labelClass}>単位</span>
            <input
              className={inputClass}
              value={form.unit}
              onChange={(event) => update({ unit: event.target.value })}
              placeholder="L"
            />
          </label>
        </div>

        {form.perPersonDay && required !== null && (
          <p className="text-[13px] font-bold text-blue-600 tabular-nums">
            必要数 {formatQuantity(Math.round(required * 100) / 100)}
            {form.unit}（{plan.people}人×{plan.days}日）
          </p>
        )}

        <label className="block">
          <span className={labelClass}>メモ</span>
          <input
            className={inputClass}
            value={form.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder="例: 夏場の水分補給用"
          />
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
