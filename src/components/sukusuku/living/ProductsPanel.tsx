'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { HouseholdProduct, HouseholdProductDraft } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import {
  deleteHouseholdProduct,
  insertHouseholdProduct,
  loadHouseholdProducts,
  markHouseholdProductAdded,
  updateHouseholdProduct,
} from '@/lib/api/householdProducts';
import { categoryOptions } from '@/lib/stockUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import ProductModal from '../modals/ProductModal';
import type { ShoppingSender } from './useShoppingSender';

// 暮らしタブの「日用品」の面（docs/home.md §4）。mobile版の
// `mobile/src/components/living/ProductsPanel.tsx` と同じ項目・並び・文言。
//
// 普段買っているものの台帳。行の「＋」で買い出しリストへ送る（お店と同じ名前のグループへ入る）。
// 在庫数は持たない（§4.3）。上で送り先のリストを変えられ、お店で絞れる。
// 並びはお店ごと（お店の名前順、お店の無いものは最後）、その中は品名の順。

/** 編集の対象。null は閉じている、'new' は追加。 */
export type EditingProduct = HouseholdProduct | 'new' | null;

const ALL = '';

interface ProductsPanelProps {
  familyId: string;
  sender: ShoppingSender;
  editing: EditingProduct;
  onEdit: (editing: EditingProduct) => void;
}

const byStoreThenName = (a: HouseholdProduct, b: HouseholdProduct) => {
  if (a.store !== b.store) {
    if (a.store === '') return 1;
    if (b.store === '') return -1;
    return a.store.localeCompare(b.store, 'ja');
  }
  return a.name.localeCompare(b.name, 'ja');
};

export default function ProductsPanel({ familyId, sender, editing, onEdit }: ProductsPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [products, setProducts] = useState<HouseholdProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [store, setStore] = useState(ALL);

  useEffect(() => {
    let isMounted = true;
    loadHouseholdProducts(supabase, familyId)
      .then((loaded) => {
        if (isMounted) setProducts(loaded);
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

  const stores = useMemo(
    () =>
      [...new Set(products.map((product) => product.store.trim()).filter((name) => name !== ''))].sort((a, b) =>
        a.localeCompare(b, 'ja'),
      ),
    [products],
  );
  const activeStore = store === ALL || stores.includes(store) ? store : ALL;
  const visible = useMemo(
    () => [...products].filter((product) => activeStore === ALL || product.store === activeStore).sort(byStoreThenName),
    [products, activeStore],
  );
  const categories = useMemo(() => categoryOptions(products), [products]);
  const storeOptions = useMemo(() => [...new Set([...stores, ...sender.groupNames])], [stores, sender.groupNames]);

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  const save = async (draft: HouseholdProductDraft) => {
    const target = editing;
    onEdit(null);
    if (target === null) return;
    try {
      if (target === 'new') {
        const created = await insertHouseholdProduct(supabase, familyId, draft);
        setProducts((prev) => [...prev, created]);
      } else {
        const updated = await updateHouseholdProduct(supabase, target.id, draft);
        setProducts((prev) => prev.map((product) => (product.id === updated.id ? updated : product)));
      }
    } catch {
      failed('保存');
    }
  };

  const remove = async (id: string) => {
    onEdit(null);
    const previous = products;
    setProducts((prev) => prev.filter((product) => product.id !== id));
    try {
      await deleteHouseholdProduct(supabase, id);
    } catch {
      setProducts(previous);
      failed('削除');
    }
  };

  const sendProduct = (product: HouseholdProduct) =>
    sender.send(product.name, product.store, () => {
      const at = new Date();
      setProducts((prev) =>
        prev.map((row) => (row.id === product.id ? { ...row, lastAddedAt: at.toISOString() } : row)),
      );
      void markHouseholdProductAdded(supabase, product.id, at).catch(() => {});
    });

  return (
    <>
      <button
        type="button"
        onClick={sender.openPicker}
        className="shrink-0 mb-2 w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-gray-200 text-left hover:bg-gray-50"
      >
        <span className="text-xs font-bold text-gray-500">送り先</span>
        <span className="flex-1 text-sm font-bold text-gray-900">{sender.listName ?? '未設定（送るときに選びます）'}</span>
        <ChevronRight size={16} className="text-gray-400" />
      </button>

      {stores.length > 0 && (
        <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-2">
          {[ALL, ...stores].map((value) => {
            const selected = value === activeStore;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setStore(value)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                  selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {value || 'すべて'}
              </button>
            );
          })}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : products.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8 px-6">
          よく買う日用品を「追加」で登録すると、ここから買い出しリストへ送れます
        </p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pb-16">
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
            {visible.map((product) => {
              const sub = [product.store, product.category, product.note].filter((text) => text !== '').join('・');
              return (
                <li key={product.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                  <button type="button" onClick={() => onEdit(product)} className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-bold text-gray-900">{product.name}</p>
                    {sub !== '' && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
                  </button>
                  {product.price !== null && (
                    <span className="shrink-0 text-[13px] font-bold text-gray-700 tabular-nums">
                      {formatPrice(product.price)}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`${product.name}を買い出しリストへ`}
                    onClick={() => sendProduct(product)}
                    className="shrink-0 w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600"
                  >
                    <Plus size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {editing !== null && (
        <ProductModal
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          categories={categories}
          stores={storeOptions}
          onClose={() => onEdit(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
        />
      )}
    </>
  );
}
