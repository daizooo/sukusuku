import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, Store } from 'lucide-react-native';
import type { HouseholdProduct, HouseholdProductDraft } from '@/types/app';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import StorePicker from '@/components/money/StorePicker';
import { swipeBoundary } from '@/hooks/useSwipeNavigation';

// 日用品の台帳の1品を足す・直す（docs/home.md §4.1）。PWA版の
// `src/components/sukusuku/modals/ProductModal.tsx` と同じ項目・同じ文言。
//
// お店は、家計の記録と同じ選択画面（StorePicker。docs/kakei.md §3.2・§3.5）で選ぶ。自由入力ではない。
// 候補は、最近使ったお店・登録したお店（家計の設定）・前に使ったお店。
// 買い出しリストのグループ名と同じ名前のお店を選ぶと、送ったときにそのグループへ入る。

/** カテゴリを選ばないときのチップ。 */
const NO_CATEGORY = 'なし';

const followRenames = (name: string, renames: Record<string, string>): string => {
  let current = name;
  for (let step = 0; step < 20 && renames[current] !== undefined && renames[current] !== current; step += 1) {
    current = renames[current];
  }
  return current;
};

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
  /** カテゴリの一覧（家族で共有。docs/home.md §4.1）の名前。ここから選ぶ。 */
  categories: string[];
  /** お店の候補（家計の記録と同じ。最近使った・登録した・前に使った）。 */
  storeChoices: { registered: string[]; recent: string[]; others: string[] };
  onClose: () => void;
  /** registerStore: お店の選択で「お店に登録して使う」を選んだか（docs/kakei.md §3.5）。 */
  onSubmit: (draft: HouseholdProductDraft, registerStore: boolean) => void;
  onDelete?: () => void;
  /** 一覧で直した・消したカテゴリ（前の名前 → 新しい名前。消したら空）。選んでいるカテゴリを追従させる。 */
  categoryRenames: Record<string, string>;
  /** カテゴリの一覧を直す画面を開く。 */
  onEditCategories: () => void;
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
  storeChoices,
  onClose,
  onSubmit,
  onDelete,
  categoryRenames,
  onEditCategories,
}: ProductSheetProps) {
  const [form, setForm] = useState<FormState>(() => initialState(product));
  // 一覧で直した・消したカテゴリを、選んでいるカテゴリに当てる（続けて直したときは最後の名前まで辿る）。
  const category = followRenames(form.category.trim(), categoryRenames);
  const [error, setError] = useState<string | null>(null);
  const [isPickingStore, setIsPickingStore] = useState(false);
  const [registerStore, setRegisterStore] = useState(false);
  const insets = useSafeAreaInsets();

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const handleSubmit = () => {
    const draft = toProductDraft({ ...form, category });
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    onSubmit(draft, form.store.trim() !== '' && registerStore);
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
          <Pressable accessibilityRole="button" onPress={() => setIsPickingStore(true)} style={[styles.input, styles.storeField]}>
            <Store size={18} color={colors.textMuted} />
            <Text style={[styles.storeText, form.store === '' && styles.placeholder]}>{form.store || 'お店を選ぶ'}</Text>
            <ChevronRight size={18} color={colors.textFaint} />
          </Pressable>
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
          <View style={styles.labelRow}>
            <Text style={styles.label}>カテゴリ</Text>
            <Pressable accessibilityRole="button" onPress={onEditCategories} hitSlop={8}>
              <Text style={styles.labelAction}>一覧を編集</Text>
            </Pressable>
          </View>
          {/* 一覧から選ぶ（自由に書くと人によって書き方がばらつくため）。一覧に無い前の値は、そのまま残して出す。 */}
          <Chips
            options={[
              NO_CATEGORY,
              ...categories,
              ...(category !== '' && !categories.includes(category) ? [category] : []),
            ]}
            value={category === '' ? NO_CATEGORY : category}
            onPick={(category) => update({ category: category === NO_CATEGORY ? '' : category })}
          />
          {categories.length === 0 && <Text style={styles.hint}>「一覧を編集」でカテゴリを作ると、ここで選べます</Text>}
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

      {isPickingStore && (
        <Modal visible animationType="slide" onRequestClose={() => setIsPickingStore(false)}>
          <View style={[styles.frame, { paddingTop: insets.top, paddingBottom: insets.bottom }]} {...swipeBoundary}>
            <StorePicker
              value={form.store}
              registered={storeChoices.registered}
              recent={storeChoices.recent}
              others={storeChoices.others}
              canRegister
              subject="日用品"
              onPick={(store, register) => {
                update({ store });
                setRegisterStore(register);
                setIsPickingStore(false);
              }}
              onClose={() => setIsPickingStore(false)}
            />
          </View>
        </Modal>
      )}
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700', color: colors.textSubtle },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  labelAction: { fontSize: 12, fontWeight: '700', color: colors.navActive },
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
  storeField: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  storeText: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  placeholder: { color: colors.textFaint },
  frame: { flex: 1, backgroundColor: colors.surface },
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
