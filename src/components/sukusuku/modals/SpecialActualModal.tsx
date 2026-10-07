'use client';

import { useState } from 'react';
import type { SpecialActualDraft } from '@/types/app';
import { toDateString } from '@/lib/dateUtils';
import { parseAmountInput, parseDateInput, type SpecialRow } from '@/lib/specialUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import { ModalShell } from './TaskForm';

// 特別費の実績を入れる・直す・取り消す（docs/home.md §5.4）。mobile版の
// `mobile/src/components/living/SpecialActualSheet.tsx` と同じ項目・同じ文言。
//
// 行（予定1回ぶん、または予定外の出費1件）を押すと開く。「済」ボタンの1タップで
// 予算どおりに入れたあとの、金額・日付の直しもここでする。項目そのものの直しは「項目を編集」から。

interface SpecialActualModalProps {
  row: SpecialRow;
  onClose: () => void;
  /** 実績を保存する（まだ無ければ足す。あれば直す）。 */
  onSubmit: (draft: SpecialActualDraft) => void;
  /** 実績を取り消す（予定の行は予定に戻り、予定外の出費はそのまま消える）。 */
  onClear?: () => void;
  onEditItem: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

export default function SpecialActualModal({ row, onClose, onSubmit, onClear, onEditItem }: SpecialActualModalProps) {
  const current = row.actuals[0] ?? null;
  const [amount, setAmount] = useState(() => String(current?.amount ?? row.budget));
  const [date, setDate] = useState(() => current?.occurredOn ?? toDateString(new Date()));
  const [note, setNote] = useState(() => current?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const value = parseAmountInput(amount);
    if (value === null) return setError('金額は0以上の整数（円）で入れてください');
    const occurredOn = parseDateInput(date);
    if (occurredOn === null) return setError('日付は 2026-07-20 の形で入れてください');
    onSubmit({ occurredOn, amount: value, note });
  };

  const handleClear = () => {
    const message = row.planId === null ? 'この出費を削除しますか？' : '実績を取り消しますか？';
    if (window.confirm(message)) onClear?.();
  };

  const verb = row.item.kind === 'income' ? '入った' : '払った';

  return (
    <ModalShell
      title={row.item.name}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-bold hover:bg-blue-700 transition"
          >
            {current ? '保存する' : `${verb}（実績にする）`}
          </button>
          <button type="button" onClick={onEditItem} className="w-full py-2 text-sm font-bold text-blue-600">
            項目を編集（予定・周期）
          </button>
          {current && onClear && (
            <button type="button" onClick={handleClear} className="w-full py-2 text-sm text-red-500">
              {row.planId === null ? '削除する' : '実績を取り消す'}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] font-bold text-gray-500 tabular-nums">
          {row.planId === null ? '予定外' : `予算 ${formatPrice(row.budget)}`}
          {row.tentative ? '（月は仮）' : ''}
        </p>

        <label className="block">
          <span className={labelClass}>実績（円）</span>
          <input className={inputClass} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="numeric" />
        </label>

        <label className="block">
          <span className={labelClass}>日付</span>
          <input
            className={inputClass}
            value={date}
            onChange={(event) => setDate(event.target.value)}
            placeholder="2026-07-20"
          />
        </label>

        <label className="block">
          <span className={labelClass}>メモ</span>
          <input className={inputClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder="任意" />
        </label>

        {row.actuals.length > 1 && (
          <p className="text-[11px] text-gray-400">
            この予定には実績が {row.actuals.length} 件あります（ここでは最初の1件を直します）
          </p>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
