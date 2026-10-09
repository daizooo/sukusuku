import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ChevronRight, Plus } from 'lucide-react-native';
import type { HouseholdProduct, HouseholdProductCategory, HouseholdProductDraft } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useSwipeTabs } from '@/hooks/useSwipeTabs';
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
import { formatPrice } from '@/lib/shoppingUtils';
import ProductSheet from '@/components/living/ProductSheet';
import ProductDetail from '@/components/living/ProductDetail';
import ProductCategoriesSheet from '@/components/living/ProductCategoriesSheet';
import type { ShoppingSender } from '@/components/living/useShoppingSender';

// 暮らしタブの「日用品」の面（docs/home.md §4）。PWA版の
// `src/components/sukusuku/living/ProductsPanel.tsx` と同じ項目・並び・文言。
//
// 普段買っているものの台帳。行の「＋」で買い出しリストへ送る（お店と同じ名前のグループへ入る）。
// 在庫数は持たない（§4.3）。上で送り先のリストを変えられ、お店で絞れる。
// 並びはお店ごと（お店の名前順、お店の無いものは最後）、その中は品名の順。

/** 編集の対象。null は閉じている、'new' は追加。 */
export type EditingProduct = HouseholdProduct | 'new' | null;

const ALL = '';

interface ProductsPanelProps {
  familyId: string | null;
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

  useEffect(() => {
    if (!familyId) return;
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
  }, [familyId]);

  const stores = useMemo(
    () => [...new Set(products.map((product) => product.store.trim()).filter((name) => name !== ''))].sort((a, b) =>
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
  const swipe = useSwipeTabs([ALL, ...stores], activeStore, setStore);
  // 選んだお店が帯の外に隠れないよう、帯をそのお店まで寄せる（スワイプで選んだときのため）。
  const storeBar = useRef<ScrollView>(null);
  const barWidth = useRef(0);
  const chipLayouts = useRef(new Map<string, { x: number; width: number }>());
  useEffect(() => {
    const chip = chipLayouts.current.get(activeStore);
    if (!chip) return;
    storeBar.current?.scrollTo({ x: Math.max(0, chip.x - (barWidth.current - chip.width) / 2), animated: true });
  }, [activeStore]);
  const detail = detailId === null ? null : (products.find((product) => product.id === detailId) ?? null);
  const categories = useMemo(() => categoryList.map((category) => category.name), [categoryList]);
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const product of products) counts[product.category] = (counts[product.category] ?? 0) + 1;
    return counts;
  }, [products]);
  const storeOptions = useMemo(() => [...new Set([...stores, ...sender.groupNames])], [stores, sender.groupNames]);

  const failed = (what: string) => Alert.alert(`${what}できませんでした`, 'もう一度お試しください。');

  const save = async (draft: HouseholdProductDraft) => {
    const target = editing;
    onEdit(null);
    if (!familyId || target === null) return;
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

  // カテゴリの一覧を直す。名前を直す・消すときは、同じ名前の品も書き換える（API の中で）。
  // 失敗したら、一覧と品を読み直して画面を DB に合わせる。
  const reloadAfterFailure = (what: string) => {
    failed(what);
    if (!familyId) return;
    void loadProductCategories(supabase, familyId).then(setCategoryList).catch(() => {});
    void loadHouseholdProducts(supabase, familyId).then(setProducts).catch(() => {});
  };

  const addCategory = async (name: string) => {
    if (!familyId) return;
    try {
      const created = await insertProductCategory(supabase, familyId, name, categoryList.length);
      setCategoryList((prev) => [...prev, created]);
    } catch {
      reloadAfterFailure('追加');
    }
  };

  const renameCategory = async (category: HouseholdProductCategory, name: string) => {
    if (!familyId) return;
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
    if (!familyId) return;
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
      <Pressable accessibilityRole="button" onPress={sender.openPicker} style={styles.destination}>
        <Text style={styles.destinationLabel}>送り先</Text>
        <Text style={styles.destinationName}>{sender.listName ?? '未設定（送るときに選びます）'}</Text>
        <ChevronRight size={16} color={colors.textFaint} />
      </Pressable>

      {stores.length > 0 && (
        <View>
          <ScrollView
            ref={storeBar}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chips}
            onLayout={(event) => {
              barWidth.current = event.nativeEvent.layout.width;
            }}
          >
            {[ALL, ...stores].map((value) => {
              const selected = value === activeStore;
              return (
                <Pressable
                  key={value || 'all'}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setStore(value)}
                  onLayout={(event) => {
                    const { x, width } = event.nativeEvent.layout;
                    chipLayouts.current.set(value, { x, width });
                  }}
                  style={[styles.chip, selected && { backgroundColor: colors.livingProducts }]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{value || 'すべて'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {isLoading ? (
        <Text style={styles.message}>読み込み中...</Text>
      ) : products.length === 0 ? (
        <View style={[styles.centered, styles.flex]}>
          <Text style={styles.message}>よく買う日用品を「追加」で登録すると、ここから買い出しリストへ送れます</Text>
        </View>
      ) : (
        <Animated.ScrollView
          style={[styles.flex, swipe.style]}
          contentContainerStyle={styles.listContent}
          {...swipe.handlers}
        >
          <View style={styles.card}>
            {visible.map((product, index) => {
              const sub = [product.store, product.category, product.note].filter((text) => text !== '').join('・');
              return (
                <Pressable
                  key={product.id}
                  accessibilityRole="button"
                  onPress={() => setDetailId(product.id)}
                  style={[styles.row, index > 0 && styles.rowDivided]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.name}>{product.name}</Text>
                    {sub !== '' && <Text style={styles.sub}>{sub}</Text>}
                  </View>
                  {product.price !== null && <Text style={styles.price}>{formatPrice(product.price)}</Text>}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${product.name}を買い出しリストへ`}
                    onPress={() => sendProduct(product)}
                    hitSlop={8}
                    style={styles.sendButton}
                  >
                    <Plus size={18} color={colors.primaryText} />
                  </Pressable>
                </Pressable>
              );
            })}
          </View>
        </Animated.ScrollView>
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
        <ProductSheet
          key={editing === 'new' ? 'new' : editing.id}
          product={editing === 'new' ? null : editing}
          categories={categories}
          stores={storeOptions}
          onClose={() => onEdit(null)}
          onSubmit={(draft) => void save(draft)}
          onDelete={editing === 'new' ? undefined : () => void remove(editing.id)}
          categoryRenames={categoryRenames}
          onEditCategories={() => setIsEditingCategories(true)}
        />
      )}

      {isEditingCategories && (
        <ProductCategoriesSheet
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  destination: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  destinationLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  destinationName: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  chips: { gap: 6, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.neutralSurface },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  message: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 80 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10 },
  rowDivided: { borderTopWidth: 1, borderTopColor: colors.border },
  name: { fontSize: 14, fontWeight: '700', color: colors.text },
  sub: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  price: { fontSize: 13, fontWeight: '700', color: colors.textSubtle, fontVariant: ['tabular-nums'] },
  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.livingProducts,
  },
});
