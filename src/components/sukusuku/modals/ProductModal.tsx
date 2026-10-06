'use client';

import { useState } from 'react';
import type { HouseholdProduct, HouseholdProductDraft } from '@/types/app';
import { ModalShell } from './TaskForm';

// 日用品の台帳の1品を足す・直す（docs/home.md §4.1）。mobile版の
// `mobile/src/components/living/ProductSheet.tsx` と同じ項目・同じ文言。
//
// お店は、買い出しリストのグループ名と同じ書き方にすると、送ったときにそのグループへ入る。
// 候補には、台帳に既にあるお店と、送り先リストのグループ名を出す。

interface FormState {
  name: string;
  category: string;
  store: string;
  price: string;
  note: string;
}

const initialState = (product: HouseholdProduct | null): FormState =>
  product
    ? {
        name: product.name,
        category: product.category,
        store: product.store,
        price: product.price === null ? '' : String(product.price),
        note: product.note,
      }
    : { name: '', category: '', store: '', price: '', note: '' };

function toProductDraft(form: FormState): HouseholdProductDraft | string {
  if (form.name.trim() === '') return '品名を入れてください';
  const priceText = form.price.trim().replace(/[¥,円]/g, '');
  const price = priceText === '' ? null : Number(priceText);
  if (price !== null && (!Number.isInteger(price) || price < 0)) return '値段は0以上の整数（円）で入れてください';
  return { name: form.name, category: form.category, store: form.store, price, note: form.note };
}

interface ProductModalProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  product: HouseholdProduct | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** お店の候補（台帳のお店と、送り先リストのグループ名）。 */
  stores: string[];
  onClose: () => void;
  onSubmit: (draft: HouseholdProductDraft) => void;
  onDelete?: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400';
const labelClass = 'block text-xs font-bold text-gray-700 mb-1.5';

function Chips({ options, value, onPick }: { options: string[]; value: string; onPick: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <div className="flex gap-1.5 overflow-x-auto pt-2 pb-0.5">
      {options.map((option) => {
        const selected = option === value.trim();
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(option)}
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
              selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}

export default function ProductModal({ product, categories, stores, onClose, onSubmit, onDelete }: ProductModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = () => {
    const draft = toProductDraft(form);
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    onSubmit(draft);
  };

  const handleDelete = () => {
    if (window.confirm('この日用品を削除しますか？')) onDelete?.();
  };

  return (
    <ModalShell
      title={product ? '日用品を編集' : '日用品を追加'}
      onClose={onClose}
      footer={
        <div className="space-y-1">
          <button
            type="button"
            onClick={handleSubmit}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
          >
            {product ? '保存する' : '追加する'}
          </button>
          {product && onDelete && (
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
            placeholder="例: トイレットペーパー ダブル 12ロール"
          />
        </label>

        <div>
          <label className="block">
            <span className={labelClass}>お店</span>
            <input
              className={inputClass}
              value={form.store}
              onChange={(event) => update({ store: event.target.value })}
              placeholder="例: イオン"
            />
          </label>
          <Chips options={stores} value={form.store} onPick={(store) => update({ store })} />
          <span className="block text-[11px] text-gray-400 mt-1">
            買い出しリストのグループと同じ名前にすると、送ったときにそのグループへ入ります
          </span>
        </div>

        <label className="block">
          <span className={labelClass}>いつもの値段（円）</span>
          <input
            className={inputClass}
            value={form.price}
            onChange={(event) => update({ price: event.target.value })}
            inputMode="numeric"
            placeholder="例: 598"
          />
        </label>

        <div>
          <label className="block">
            <span className={labelClass}>カテゴリ</span>
            <input
              className={inputClass}
              value={form.category}
              onChange={(event) => update({ category: event.target.value })}
              placeholder="例: 紙類"
            />
          </label>
          <Chips options={categories} value={form.category} onPick={(category) => update({ category })} />
        </div>

        <label className="block">
          <span className={labelClass}>メモ</span>
          <input
            className={inputClass}
            value={form.note}
            onChange={(event) => update({ note: event.target.value })}
            placeholder="例: セールなら¥398"
          />
        </label>

        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    </ModalShell>
  );
}
