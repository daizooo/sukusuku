'use client';

import { useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { StockItem, StockItemDraft, StockTarget } from '@/types/app';
import { formatExpiry, formatQuantity, parseExpiryInput } from '@/lib/stockUtils';
import { ModalShell } from './TaskForm';

// 防災備蓄の1行を足す・直す（docs/home.md §3.2）。mobile版の
// `mobile/src/components/living/StockItemSheet.tsx` と同じ項目・同じ文言。
//
// 期限は元の一覧と同じ書き方（「2031.08.25」「2027.06」）で打つ。日付の選択画面にしないのは、
// 月までしか無い期限があるのと、袋に書いてある数字をそのまま打つほうが早いため。

interface FormState {
  name: string;
  category: string;
  quantity: string;
  unit: string;
  expiry: string;
  note: string;
  targetId: string | null;
  amountPerUnit: string;
}

const initialState = (item: StockItem | null): FormState =>
  item
    ? {
        name: item.name,
        category: item.category,
        quantity: formatQuantity(item.quantity),
        unit: item.unit,
        expiry: formatExpiry(item),
        note: item.note,
        targetId: item.targetId,
        amountPerUnit: formatQuantity(item.amountPerUnit),
      }
    : { name: '', category: '', quantity: '1', unit: '', expiry: '', note: '', targetId: null, amountPerUnit: '1' };

/** 入力を確かめて保存する形にする。だめなら突き返す文言。 */
function toStockDraft(form: FormState): StockItemDraft | string {
  if (form.name.trim() === '') return '品名を入れてください';
  const quantity = Number(form.quantity.trim());
  if (form.quantity.trim() === '' || !Number.isFinite(quantity) || quantity < 0) {
    return '数は0以上の数字で入れてください';
  }
  const expiry = parseExpiryInput(form.expiry);
  if (!expiry) return '期限は「2031.08.25」か「2027.06」の形で入れてください';
  const amountPerUnit = form.targetId === null ? 1 : Number(form.amountPerUnit.trim());
  if (!Number.isFinite(amountPerUnit) || amountPerUnit <= 0) {
    return '1つあたりの量は0より大きい数字で入れてください';
  }
  return {
    name: form.name,
    category: form.category,
    quantity,
    unit: form.unit,
    expiresOn: expiry.expiresOn,
    expiresMonthOnly: expiry.expiresMonthOnly,
    note: form.note,
    targetId: form.targetId,
    amountPerUnit,
  };
}

interface StockItemModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す（初期値をそのとき決めるため）。 */
  item: StockItem | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** 数える先の候補（必要数）。 */
  targets: StockTarget[];
  onClose: () => void;
  onSubmit: (draft: StockItemDraft) => void;
  onDelete?: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

export default function StockItemModal({
  item,
  categories,
  targets,
  onClose,
  onSubmit,
  onDelete,
}: StockItemModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const selectedTarget = targets.find((target) => target.id === form.targetId) ?? null;

  /** 「使った」「足した」を1つずつ。数の欄が読めないときは0から数える。 */
  const step = (delta: number) => {
    const current = Number(form.quantity);
    const base = Number.isFinite(current) ? current : 0;
    update({ quantity: formatQuantity(Math.max(0, base + delta)) });
  };

  const handleSubmit = () => {
    const draft = toStockDraft(form);
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    onSubmit(draft);
  };

  const handleDelete = () => {
    if (window.confirm('この備蓄を削除しますか？')) onDelete?.();
  };

  return (
    <ModalShell
      title={item ? '備蓄を編集' : '備蓄を追加'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
          >
            {item ? '保存する' : '追加する'}
          </button>
          {item && onDelete && (
            <button type="button" onClick={handleDelete} className="w-full py-2 text-sm text-red-500">
              削除する
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={labelClass}>品名</span>
          <input
            className={inputClass}
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="例: 水 500ml"
          />
        </label>

        <div>
          <label className="block">
            <span className={labelClass}>カテゴリ</span>
            <input
              className={inputClass}
              value={form.category}
              onChange={(event) => update({ category: event.target.value })}
              placeholder="例: 飲料・水"
            />
          </label>
          {categories.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto pt-2 pb-0.5">
              {categories.map((category) => {
                const selected = category === form.category.trim();
                return (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update({ category })}
                    className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                      selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {category}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <span className={labelClass}>数</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                aria-label="1つ減らす"
                onClick={() => step(-1)}
                className="w-10 h-10 shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
              >
                <Minus size={16} />
              </button>
              <input
                className={`${inputClass} text-center`}
                value={form.quantity}
                onChange={(event) => update({ quantity: event.target.value })}
                inputMode="decimal"
                aria-label="数"
              />
              <button
                type="button"
                aria-label="1つ増やす"
                onClick={() => step(1)}
                className="w-10 h-10 shrink-0 rounded-lg bg-gray-100 flex items-center justify-center text-gray-700"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          <label className="block w-24">
            <span className={labelClass}>単位</span>
            <input
              className={inputClass}
              value={form.unit}
              onChange={(event) => update({ unit: event.target.value })}
              placeholder="本"
            />
          </label>
        </div>

        <label className="block">
          <span className={labelClass}>期限</span>
          <input
            className={inputClass}
            value={form.expiry}
            onChange={(event) => update({ expiry: event.target.value })}
            placeholder="2031.08.25 / 2027.06"
            inputMode="decimal"
          />
          <span className="block text-[11px] text-gray-400 mt-1">
            月までのものは「2027.06」。期限が無いものは空のまま
          </span>
        </label>

        {targets.length > 0 && (
          <div>
            <span className={labelClass}>必要数に数える</span>
            <div className="flex flex-wrap gap-1.5">
              {[null, ...targets].map((target) => {
                const id = target?.id ?? null;
                const selected = form.targetId === id;
                return (
                  <button
                    key={id ?? 'none'}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => update({ targetId: id })}
                    className={`px-2.5 py-1 rounded-full text-xs font-bold transition ${
                      selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                    }`}
                  >
                    {target?.name ?? '数えない'}
                  </button>
                );
              })}
            </div>
            {selectedTarget && (
              <>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-sm text-gray-700">1つあたり</span>
                  <input
                    className="w-22 border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-blue-400"
                    value={form.amountPerUnit}
                    onChange={(event) => update({ amountPerUnit: event.target.value })}
                    inputMode="decimal"
                    aria-label="1つあたりの量"
                  />
                  <span className="text-sm text-gray-700">{selectedTarget.unit}</span>
                </div>
                <span className="block text-[11px] text-gray-400 mt-1">
                  単位が同じなら1のまま。水 500ml の本を L で数えるなら 0.5
                </span>
              </>
            )}
          </div>
        )}

        <label className="block">
          <span className={labelClass}>メモ</span>
          <input
            className={inputClass}
            value={form.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder="置き場所など"
          />
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
