'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import type { HouseholdProduct, HouseholdProductCategory, HouseholdProductDraft, MoneyStore } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import {
  deleteHouseholdProduct,
  deleteProductCategory,
  insertHouseholdProduct,
  insertProductCategory,
  loadHouseholdProducts,
  loadProductCategories,
  markHouseholdProductAdded,
  renameProductCategory,
  reorderProductCategories,
  updateHouseholdProduct,
} from '@/lib/api/householdProducts';
import { insertMoneyStore, loadMoneyStores, loadStoreUses } from '@/lib/api/money';
import { storeChoices as buildStoreChoices, type StoreUse } from '@/lib/moneyUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import ProductModal from '../modals/ProductModal';
import ProductDetail from './ProductDetail';
import ProductCategoriesModal from '../modals/ProductCategoriesModal';
import type { ShoppingSender } from './useShoppingSender';
import { useSwipeTabs } from '../ui/useSwipeTabs';

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
  // 詳しい画面を開いている品（docs/home.md §4.6）。品は一覧から引くので、直したり消したりすると追従する。
  const [detailId, setDetailId] = useState<string | null>(null);
  // カテゴリの一覧（家族で共有。docs/home.md §4.1）と、それを直す画面を開いているか。
  const [categoryList, setCategoryList] = useState<HouseholdProductCategory[]>([]);
  const [isEditingCategories, setIsEditingCategories] = useState(false);
  // 編集中の品のカテゴリを、一覧で直した・消した名前に追従させる（前の名前 → 新しい名前。消したら空）。
  const [categoryRenames, setCategoryRenames] = useState<Record<string, string>>({});
  // お店の候補は家計の記録と同じ（docs/home.md §4.1）。家計のお店の設定と、記録で使ったお店を、編集を開くたびに読む。
  const [moneyStores, setMoneyStores] = useState<MoneyStore[]>([]);
  const [storeUses, setStoreUses] = useState<StoreUse[]>([]);
  const isEditing = editing !== null;
  useEffect(() => {
    if (!isEditing || !familyId) return;
    let isMounted = true;
    void Promise.all([loadMoneyStores(supabase, familyId), loadStoreUses(supabase, familyId)])
      .then(([loadedStores, loadedUses]) => {
        if (!isMounted) return;
        setMoneyStores(loadedStores);
        setStoreUses(loadedUses);
      })
      .catch(() => {
        // 読めなかったぶんは、前に読んだ候補のまま（打って足すことはできる）。
      });
    return () => {
      isMounted = false;
    };
  }, [supabase, isEditing, familyId]);

  useEffect(() => {
    let isMounted = true;
    loadProductCategories(supabase, familyId)
      .then((loaded) => {
        if (isMounted) setCategoryList(loaded);
      })
      .catch(() => {
        // 読めなかったぶんは空のままにする。
      });
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
  // お店は、一覧の上の左右スワイプでも切り替える（一覧が指に合わせて動く）。
  const { handlers: swipeHandlers, attachContent } = useSwipeTabs([ALL, ...stores], activeStore, setStore);
  // 選んだお店が帯の外に隠れないよう、帯をそのお店まで寄せる（スワイプで選んだときのため）。
  const storeBar = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const bar = storeBar.current;
    const selected = bar?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!bar || !selected) return;
    bar.scrollTo({ left: selected.offsetLeft - (bar.clientWidth - selected.offsetWidth) / 2, behavior: 'smooth' });
  }, [activeStore]);
  const detail = detailId === null ? null : (products.find((product) => product.id === detailId) ?? null);
  const categories = useMemo(() => categoryList.map((category) => category.name), [categoryList]);
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of products) counts[product.category] = (counts[product.category] ?? 0) + 1;
    return counts;
  }, [products]);
  const storeChoices = useMemo(() => {
    const base = buildStoreChoices(moneyStores, storeUses);
    // 台帳に前からあるお店のうち、記録にも設定にも無いものは「前に使ったお店」に出す（使わなくしたお店は除く）。
    const known = new Set([...base.registered, ...base.recent, ...base.others, ...moneyStores.map((entry) => entry.name)]);
    const fromProducts = stores.filter((name) => !known.has(name));
    return { ...base, others: [...base.others, ...fromProducts].sort((a, b) => a.localeCompare(b, 'ja')) };
  }, [moneyStores, storeUses, stores]);

  const failed = (what: string) => window.alert(`${what}できませんでした。もう一度お試しください。`);

  const save = async (draft: HouseholdProductDraft, registerStore: boolean) => {
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
      // 「お店に登録して使う」を選んだお店は、家計のお店の設定にも登録する（docs/kakei.md §3.5）。
      const storeName = draft.store.trim();
      if (registerStore && storeName !== '' && !moneyStores.some((entry) => entry.name === storeName && !entry.archived)) {
        const savedStore = await insertMoneyStore(supabase, familyId, storeName);
        setMoneyStores((prev) => [...prev.filter((entry) => entry.id !== savedStore.id), savedStore]);
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

  // カテゴリの一覧を直す。名前を直す・消すときは、同じ名前の品も書き換える（API の中で）。
  // 失敗したら、一覧と品を読み直して画面を DB に合わせる。
  const reloadAfterFailure = (what: string) => {
    failed(what);
    void loadProductCategories(supabase, familyId).then(setCategoryList).catch(() => {});
    void loadHouseholdProducts(supabase, familyId).then(setProducts).catch(() => {});
  };

  const addCategory = async (name: string) => {
    try {
      const created = await insertProductCategory(supabase, familyId, name, categoryList.length);
      setCategoryList((prev) => [...prev, created]);
    } catch {
      reloadAfterFailure('追加');
    }
  };

  const renameCategory = async (category: HouseholdProductCategory, name: string) => {
    const existing = categoryList.find((row) => row.id !== category.id && row.name === name) ?? null;
    setCategoryList((prev) =>
      existing ? prev.filter((row) => row.id !== category.id) : prev.map((row) => (row.id === category.id ? { ...row, name } : row)),
    );
    setProducts((prev) => prev.map((product) => (product.category === category.name ? { ...product, category: name } : product)));
    setCategoryRenames((prev) => ({ ...prev, [category.name]: name }));
    try {
      await renameProductCategory(supabase, familyId, category, name, existing);
    } catch {
      reloadAfterFailure('保存');
    }
  };

  const deleteCategory = async (category: HouseholdProductCategory) => {
    setCategoryList((prev) => prev.filter((row) => row.id !== category.id));
    setProducts((prev) => prev.map((product) => (product.category === category.name ? { ...product, category: '' } : product)));
    setCategoryRenames((prev) => ({ ...prev, [category.name]: '' }));
    try {
      await deleteProductCategory(supabase, familyId, category);
    } catch {
      reloadAfterFailure('削除');
    }
  };

  const moveCategory = async (category: HouseholdProductCategory, offset: -1 | 1) => {
    const index = categoryList.findIndex((row) => row.id === category.id);
    const target = index + offset;
    if (index < 0 || target < 0 || target >= categoryList.length) return;
    const next = [...categoryList];
    [next[index], next[target]] = [next[target], next[index]];
    const renumbered = next.map((row, position) => ({ ...row, position }));
    setCategoryList(renumbered);
    try {
      await reorderProductCategories(supabase, renumbered);
    } catch {
      reloadAfterFailure('並べ替え');
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
        <div ref={storeBar} className="relative shrink-0 flex gap-1.5 overflow-x-auto pb-2">
          {[ALL, ...stores].map((value) => {
            const selected = value === activeStore;
            return (
              <button
                key={value || 'all'}
                type="button"
                aria-pressed={selected}
                onClick={() => setStore(value)}
                className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold transition ${
                  selected ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
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
        <div ref={attachContent} className="flex-1 min-h-0 overflow-y-auto pb-16" {...swipeHandlers}>
          <ul className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-200 overflow-hidden">
            {visible.map((product) => {
              const sub = [product.store, product.category, product.note].filter((text) => text !== '').join('・');
              return (
                <li key={product.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                  <button type="button" onClick={() => setDetailId(product.id)} className="flex-1 min-w-0 text-left">
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
                    className="shrink-0 w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center hover:bg-emerald-700"
                  >
                    <Plus size={18} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {detail && (
        <ProductDetail
          key={detail.id}
          product={detail}
          onClose={() => setDetailId(null)}
          onEdit={() => onEdit(detail)}
          onSend={() => sendProduct(detail)}
          banner={sender.banner}
        />
      )}

      {editing !== null && (
        <ProductModal
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          categories={categories}
          storeChoices={storeChoices}
          onClose={() => onEdit(null)}
          onSubmit={(draft, registerStore) => void save(draft, registerStore)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
          categoryRenames={categoryRenames}
          onEditCategories={() => setIsEditingCategories(true)}
        />
      )}

      {isEditingCategories && (
        <ProductCategoriesModal
          categories={categoryList}
          counts={categoryCounts}
          onClose={() => setIsEditingCategories(false)}
          onAdd={(name) => void addCategory(name)}
          onRename={(category, name) => void renameCategory(category, name)}
          onDelete={(category) => void deleteCategory(category)}
          onMove={(category, offset) => void moveCategory(category, offset)}
        />
      )}
    </>
  );
}
