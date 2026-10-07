import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Minus, Plus, Search } from 'lucide-react-native';
import type { HouseholdProduct } from '@/types/app';
import { colors } from '@/lib/theme';
import { formatYen } from '@/lib/moneyUtils';
import { normalizeName } from '@/lib/shoppingUtils';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 日用品から選ぶ（docs/kakei.md §3.2）。PWA版の `src/components/sukusuku/money/ProductPicker.tsx` と同じ並び・文言。
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

  return (
    <View style={styles.screen}>
      <ScreenHeader title="日用品から選ぶ" icon="back" onClose={onClose} />
      <View style={styles.searchBox}>
        <Search size={18} color={colors.textFaint} />
        <TextInput
          style={styles.search}
          value={query}
          onChangeText={setQuery}
          placeholder="品名で探す"
          placeholderTextColor={colors.textFaint}
        />
      </View>
      <View style={styles.scopes}>
        {categoryId !== null && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: scope === 'category' }}
            onPress={() => setScope('category')}
            style={[styles.scope, scope === 'category' && styles.scopeSelected]}
          >
            <Text style={[styles.scopeText, scope === 'category' && styles.scopeTextSelected]}>
              この種類（{categoryName}）
            </Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: scope === 'all' }}
          onPress={() => setScope('all')}
          style={[styles.scope, scope === 'all' && styles.scopeSelected]}
        >
          <Text style={[styles.scopeText, scope === 'all' && styles.scopeTextSelected]}>すべて</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {products.length === 0 ? (
          <Text style={styles.empty}>日用品の台帳が空です。暮らしタブの「日用品」で登録できます</Text>
        ) : visible.length === 0 ? (
          <Text style={styles.empty}>
            {scope === 'category' ? 'この種類の品はまだありません。「すべて」から選べます' : '見つかりません'}
          </Text>
        ) : (
          groups.map(([label, rows]) => (
            <View key={label}>
              <Text style={styles.groupTitle}>{label}</Text>
              {rows.map((product) => {
                const count = picked[product.id];
                const checked = count !== undefined;
                return (
                  <Pressable
                    key={product.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                    onPress={() => toggle(product.id)}
                    style={styles.row}
                  >
                    <View style={[styles.check, checked && styles.checkOn]}>
                      {checked && <Check size={14} color={colors.money} />}
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.name}>{product.name}</Text>
                      {product.price !== null && <Text style={styles.price}>いつも {formatYen(product.price)}</Text>}
                    </View>
                    {checked && (
                      <View style={styles.stepper}>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="1つ減らす"
                          onPress={() => changeCount(product.id, -1)}
                          hitSlop={6}
                          style={styles.stepButton}
                        >
                          <Minus size={14} color={colors.textSubtle} />
                        </Pressable>
                        <Text style={styles.count}>{count}</Text>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="1つ増やす"
                          onPress={() => changeCount(product.id, 1)}
                          hitSlop={6}
                          style={styles.stepButton}
                        >
                          <Plus size={14} color={colors.textSubtle} />
                        </Pressable>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton
          label={entries.length === 0 ? '品を選んでください' : `${entries.length}品を入れる（${formatYen(total)}）`}
          disabled={entries.length === 0}
          onPress={() => onPick(entries.map((product) => ({ product, quantity: picked[product.id] })))}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.neutralSurface,
  },
  search: { flex: 1, paddingVertical: 10, fontSize: 15, fontWeight: '500', color: colors.text },
  scopes: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  scope: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.neutralSurface },
  scopeSelected: { backgroundColor: colors.moneySoft },
  scopeText: { fontSize: 13, fontWeight: '600', color: colors.textSubtle },
  scopeTextSelected: { color: colors.moneyText, fontWeight: '700' },
  content: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { fontSize: 14, fontWeight: '500', color: colors.textFaint, textAlign: 'center', paddingVertical: 32 },
  groupTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: 10, marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { borderColor: colors.moneySoft, backgroundColor: colors.moneySoft },
  name: { fontSize: 15, fontWeight: '500', color: colors.text },
  price: { fontSize: 12, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  count: { minWidth: 18, textAlign: 'center', fontSize: 15, fontWeight: '700', color: colors.text },
  footer: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 16, borderTopWidth: 1, borderTopColor: colors.border },
});
