'use client';

import { useState } from 'react';
import type { StockItem } from '@/types/app';
import { formatExpiry, formatQuantity, parseExpiryInput } from '@/lib/stockUtils';
import { ModalShell } from './TaskForm';

// 「買い替えた」（防災備蓄の要対応。docs/home.md §10.2）。同じ品の新しいロットを、
// 新しい期限・数で作る。mobile版の `mobile/src/components/living/StockRestockSheet.tsx` と同じ項目・文言。

export interface RestockInput {
  expiresOn: string | null;
  expiresMonthOnly: boolean;
  quantity: number;
  /** 古いロットを処分（削除）する。 */
  discardOld: boolean;
}

interface StockRestockModalProps {
  /** 買い替える元のロット。 */
  item: StockItem;
  /** 古いロットが期限切れか。切れていれば、処分を初めから選んでおく。 */
  expired: boolean;
  onClose: () => void;
  onSubmit: (input: RestockInput) => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

export default function StockRestockModal({ item, expired, onClose, onSubmit }: StockRestockModalProps) {
  const [expiry, setExpiry] = useState('');
  const [quantity, setQuantity] = useState(formatQuantity(item.quantity));
  const [discardOld, setDiscardOld] = useState(expired);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const parsed = parseExpiryInput(expiry);
    if (!parsed || parsed.expiresOn === null) {
      setError('新しい期限を「2031.08.25」か「2027.06」の形で入れてください');
      return;
    }
    const count = Number(quantity.trim());
    if (quantity.trim() === '' || !Number.isFinite(count) || count <= 0) {
      setError('数は0より大きい数字で入れてください');
      return;
    }
    onSubmit({ ...parsed, quantity: count, discardOld });
  };

  return (
    <ModalShell
      title="買い替えた"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={handleSubmit}
          className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
        >
          新しいロットを追加する
        </button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm font-bold text-gray-900">
          {item.name}
          {item.expiresOn ? `（いまの期限 ${formatExpiry(item)}）` : ''}
        </p>

        <label className="block">
          <span className={labelClass}>新しい期限</span>
          <input
            className={inputClass}
            value={expiry}
            onChange={(event) => setExpiry(event.target.value)}
            placeholder="2031.08.25 / 2027.06"
            inputMode="decimal"
            aria-label="新しい期限"
          />
        </label>

        <div className="flex gap-3">
          <label className="block flex-1">
            <span className={labelClass}>数{item.unit ? `（${item.unit}）` : ''}</span>
            <input
              className={inputClass}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              inputMode="decimal"
              aria-label="数"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm text-gray-900">
          <input type="checkbox" checked={discardOld} onChange={(event) => setDiscardOld(event.target.checked)} />
          古いロットは処分する
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
