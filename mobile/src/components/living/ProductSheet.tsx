import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { HouseholdProduct, HouseholdProductDraft } from '@/types/app';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 日用品の台帳の1品を足す・直す（docs/home.md §4.1）。PWA版の
// `src/components/sukusuku/modals/ProductModal.tsx` と同じ項目・同じ文言。
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

interface ProductSheetProps {
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

function Chips({ options, value, onPick }: { options: string[]; value: string; onPick: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chips}
    >
      {options.map((option) => {
        const selected = option === value.trim();
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onPick(option)}
            style={[styles.chip, selected && styles.chipSelected]}
          >
            <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function ProductSheet({
  product,
  categories,
  stores,
  onClose,
  onSubmit,
  onDelete,
}: ProductSheetProps) {
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

  const handleDelete = () =>
    Alert.alert('この日用品を削除しますか？', undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={product ? '日用品を編集' : '日用品を追加'}
        onClose={onClose}
        footer={
          <>
            <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
              <Text style={styles.submitText}>{product ? '保存する' : '追加する'}</Text>
            </Pressable>
            {product && onDelete && (
              <Pressable accessibilityRole="button" onPress={handleDelete} style={styles.delete}>
                <Text style={styles.deleteText}>削除する</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <Text style={styles.label}>品名</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(name) => update({ name })}
            placeholder="例: トイレットペーパー ダブル 12ロール"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>お店</Text>
          <TextInput
            style={styles.input}
            value={form.store}
            onChangeText={(store) => update({ store })}
            placeholder="例: イオン"
            placeholderTextColor={colors.textFaint}
          />
          <Chips options={stores} value={form.store} onPick={(store) => update({ store })} />
          <Text style={styles.hint}>買い出しリストのグループと同じ名前にすると、送ったときにそのグループへ入ります</Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>いつもの値段（円）</Text>
          <TextInput
            style={styles.input}
            value={form.price}
            onChangeText={(price) => update({ price })}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="例: 598"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>カテゴリ</Text>
          <TextInput
            style={styles.input}
            value={form.category}
            onChangeText={(category) => update({ category })}
            placeholder="例: 紙類"
            placeholderTextColor={colors.textFaint}
          />
          <Chips options={categories} value={form.category} onPick={(category) => update({ category })} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.input}
            value={form.note}
            onChangeText={(note) => update({ note })}
            placeholder="例: セールなら¥398"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint },
  chips: { gap: 6, paddingTop: 2 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: colors.neutralSurface },
  chipSelected: { backgroundColor: colors.navActive },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  delete: { paddingVertical: 12, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
