'use client';

import { useMemo, useState } from 'react';
import { Check, Minus, Plus, Search } from 'lucide-react';
import type { HouseholdProduct } from '@/types/app';
import { formatYen } from '@/lib/moneyUtils';
import { normalizeName } from '@/lib/shoppingUtils';
import { PrimaryButton, ScreenHeader, StackedScreen } from './moneyVisual';

// 日用品から選ぶ（docs/kakei.md §3.2）。mobile版の `mobile/src/components/money/ProductPicker.tsx` と同じ並び・文言。
//
// 日用品の台帳（食品も含めた「毎月必ず買うもの」）の一覧。はじめは今の種類の品だけ（台帳の「記録するときの種類」）、
// 「すべて」で全部。印をつけて個数を決め、「n品を入れる」でまとめて品目の行にする（品名・いつもの値段・個数）。

export interface PickedProduct {
  product: HouseholdProduct;
  quantity: number;
}

interface ProductPickerProps {
  products: HouseholdProduct[];
  categoryId: string | null;
  categoryName: string;
  onPick: (picked: PickedProduct[]) => void;
  onClose: () => void;
}

export default function ProductPicker({ products, categoryId, categoryName, onPick, onClose }: ProductPickerProps) {
  const inCategory = useMemo(
    () => products.filter((product) => categoryId !== null && product.moneyCategoryId === categoryId),
    [products, categoryId],
  );
  const [scope, setScope] = useState<'category' | 'all'>(inCategory.length > 0 ? 'category' : 'all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Record<string, number>>({});

  const visible = useMemo(() => {
    const key = normalizeName(query);
    return (scope === 'category' ? inCategory : products)
      .filter((product) => key === '' || normalizeName(product.name).includes(key))
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [scope, inCategory, products, query]);
  const groups = useMemo(() => {
    const map = new Map<string, HouseholdProduct[]>();
    for (const product of visible) {
      const label = product.category.trim() || 'その他';
      map.set(label, [...(map.get(label) ?? []), product]);
    }
    return [...map.entries()];
  }, [visible]);

  const entries = products.filter((product) => picked[product.id] !== undefined);
  const total = entries.reduce((sum, product) => sum + (product.price ?? 0) * picked[product.id], 0);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = { ...prev };
      if (next[id] === undefined) next[id] = 1;
      else delete next[id];
      return next;
    });
  const changeCount = (id: string, delta: number) =>
    setPicked((prev) => ({ ...prev, [id]: Math.max(1, Math.min(99, (prev[id] ?? 1) + delta)) }));

  const scopeClass = (selected: boolean) =>
    `rounded-full px-3.5 py-1.5 text-[13px] ${selected ? 'bg-blue-100 font-bold text-blue-800' : 'bg-gray-100 font-semibold text-gray-700'}`;

  return (
    <StackedScreen onBack={onClose}>
      <ScreenHeader title="日用品から選ぶ" icon="back" onClose={onClose} />
      <div className="shrink-0 mx-4 mt-3 flex items-center gap-2 rounded-xl bg-gray-100 px-3">
        <Search size={18} className="text-gray-400" />
        <input
          className="flex-1 bg-transparent py-2.5 text-[15px] focus:outline-none"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="品名で探す"
        />
      </div>
      <div className="shrink-0 flex gap-2 px-4 py-2.5">
        {categoryId !== null && (
          <button type="button" aria-pressed={scope === 'category'} onClick={() => setScope('category')} className={scopeClass(scope === 'category')}>
            この種類（{categoryName}）
          </button>
        )}
        <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')} className={scopeClass(scope === 'all')}>
          すべて
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-6">
        {products.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">日用品の台帳が空です。暮らしタブの「日用品」で登録できます</p>
        ) : visible.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {scope === 'category' ? 'この種類の品はまだありません。「すべて」から選べます' : '見つかりません'}
          </p>
        ) : (
          groups.map(([label, rows]) => (
            <div key={label}>
              <p className="mt-2.5 mb-0.5 text-xs font-bold text-gray-500">{label}</p>
              {rows.map((product) => {
                const count = picked[product.id];
                const checked = count !== undefined;
                return (
                  <div key={product.id} className="flex items-center gap-3 border-b border-gray-200 py-3">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={checked}
                      onClick={() => toggle(product.id)}
                      className="flex flex-1 items-center gap-3 text-left"
                    >
                      <span
                        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full border-2 ${
                          checked ? 'border-blue-100 bg-blue-100 text-blue-600' : 'border-gray-300'
                        }`}
                      >
                        {checked && <Check size={14} />}
                      </span>
                      <span>
                        <span className="block text-[15px] text-gray-900">{product.name}</span>
                        {product.price !== null && (
                          <span className="block text-xs text-gray-400 tabular-nums">いつも {formatYen(product.price)}</span>
                        )}
                      </span>
                    </button>
                    {checked && (
                      <span className="flex items-center gap-2">
                        <button
                          type="button"
                          aria-label="1つ減らす"
                          onClick={() => changeCount(product.id, -1)}
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-gray-100 text-gray-700"
                        >
                          <Minus size={14} />
                        </button>
                        <span className="min-w-[18px] text-center text-[15px] font-bold tabular-nums">{count}</span>
                        <button
                          type="button"
                          aria-label="1つ増やす"
                          onClick={() => changeCount(product.id, 1)}
                          className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-gray-100 text-gray-700"
                        >
                          <Plus size={14} />
                        </button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
      <div className="shrink-0 border-t border-gray-200 px-4 pt-2.5 pb-4">
        <PrimaryButton
          label={entries.length === 0 ? '品を選んでください' : `${entries.length}品を入れる（${formatYen(total)}）`}
          disabled={entries.length === 0}
          onClick={() => onPick(entries.map((product) => ({ product, quantity: picked[product.id] })))}
        />
      </div>
    </StackedScreen>
  );
}
