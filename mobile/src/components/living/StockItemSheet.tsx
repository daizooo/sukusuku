import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Minus, Plus } from 'lucide-react-native';
import type { StockItem, StockItemDraft, StockTarget } from '@/types/app';
import {
  formatExpiry,
  formatQuantity,
  parseExpiryInput,
  STORAGE_LABEL,
  type StockStorage,
} from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 防災備蓄の1行を足す・直す（docs/home.md §3.2）。PWA版の
// `src/components/sukusuku/modals/StockItemModal.tsx` と同じ項目・同じ文言。
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
  storage: StockStorage;
}

const STORAGES: StockStorage[] = ['home', 'carry'];

const initialState = (item: StockItem | null, defaultStorage: StockStorage): FormState =>
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
        storage: item.storage,
      }
    : {
        name: '',
        category: '',
        quantity: '1',
        unit: '',
        expiry: '',
        note: '',
        targetId: null,
        amountPerUnit: '1',
        storage: defaultStorage,
      };

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
    storage: form.storage,
  };
}

interface StockItemSheetProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す（初期値をそのとき決めるため）。 */
  item: StockItem | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** 数える先の候補（必要数）。 */
  targets: StockTarget[];
  onClose: () => void;
  onSubmit: (draft: StockItemDraft) => void;
  onDelete?: () => void;
  /** 追加のときの保管場所（持ち出しで絞っているときは持ち出し）。 */
  defaultStorage?: StockStorage;
  /** 一部（count個）をもう一方の保管場所へ移す。編集のときだけ。 */
  onMove?: (count: number) => void;
}

export default function StockItemSheet({
  item,
  categories,
  targets,
  onClose,
  onSubmit,
  onDelete,
  defaultStorage = 'home',
  onMove,
}: StockItemSheetProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item, defaultStorage));
  const [moveCount, setMoveCount] = useState('1');
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

  /** 一部を移す。移せるのは1以上、今の数まで（全部なら場所ごと変わる）。 */
  const otherStorage: StockStorage = item?.storage === 'carry' ? 'home' : 'carry';
  const handleMove = () => {
    const count = Number(moveCount.trim());
    if (!item || !Number.isFinite(count) || count <= 0 || count > item.quantity) {
      setError(`移す数は1〜${item ? formatQuantity(item.quantity) : ''}で入れてください`);
      return;
    }
    onMove?.(count);
  };

  const handleDelete = () =>
    Alert.alert('この備蓄を削除しますか？', undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={item ? '備蓄を編集' : '備蓄を追加'}
        onClose={onClose}
        footer={
          <>
            <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
              <Text style={styles.submitText}>{item ? '保存する' : '追加する'}</Text>
            </Pressable>
            {item && onDelete && (
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
            placeholder="例: 水 500ml"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>カテゴリ</Text>
          <TextInput
            style={styles.input}
            value={form.category}
            onChangeText={(category) => update({ category })}
            placeholder="例: 飲料・水"
            placeholderTextColor={colors.textFaint}
          />
          {categories.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.chips}
            >
              {categories.map((category) => {
                const selected = category === form.category.trim();
                return (
                  <Pressable
                    key={category}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => update({ category })}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{category}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>数</Text>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="1つ減らす"
                onPress={() => step(-1)}
                style={styles.stepButton}
              >
                <Minus size={16} color={colors.textSubtle} />
              </Pressable>
              <TextInput
                style={[styles.input, styles.stepInput]}
                value={form.quantity}
                onChangeText={(quantity) => update({ quantity })}
                keyboardType="decimal-pad"
                inputMode="decimal"
                accessibilityLabel="数"
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="1つ増やす"
                onPress={() => step(1)}
                style={styles.stepButton}
              >
                <Plus size={16} color={colors.textSubtle} />
              </Pressable>
            </View>
          </View>
          <View style={[styles.field, styles.unitField]}>
            <Text style={styles.label}>単位</Text>
            <TextInput
              style={styles.input}
              value={form.unit}
              onChangeText={(unit) => update({ unit })}
              placeholder="本"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>保管場所</Text>
          <View style={styles.segmented}>
            {STORAGES.map((storage) => {
              const selected = storage === form.storage;
              return (
                <Pressable
                  key={storage}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => update({ storage })}
                  style={[styles.segment, selected && styles.segmentSelected]}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                    {STORAGE_LABEL[storage]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {item && onMove && item.quantity > 1 && (
            <View style={styles.perUnitRow}>
              <Text style={styles.perUnitLabel}>一部を{STORAGE_LABEL[otherStorage]}へ</Text>
              <TextInput
                style={[styles.input, styles.perUnitInput]}
                value={moveCount}
                onChangeText={setMoveCount}
                keyboardType="decimal-pad"
                inputMode="decimal"
                accessibilityLabel="移す数"
              />
              <Text style={styles.perUnitLabel}>{item.unit}</Text>
              <Pressable accessibilityRole="button" onPress={handleMove} style={styles.moveButton}>
                <Text style={styles.moveButtonText}>移す</Text>
              </Pressable>
            </View>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>期限</Text>
          <TextInput
            style={styles.input}
            value={form.expiry}
            onChangeText={(expiry) => update({ expiry })}
            placeholder="2031.08.25 / 2027.06"
            placeholderTextColor={colors.textFaint}
            keyboardType="numbers-and-punctuation"
          />
          <Text style={styles.hint}>月までのものは「2027.06」。期限が無いものは空のまま</Text>
        </View>

        {targets.length > 0 && (
          <View style={styles.field}>
            <Text style={styles.label}>必要数に数える</Text>
            <View style={styles.wrapChips}>
              {[null, ...targets].map((target) => {
                const id = target?.id ?? null;
                const selected = form.targetId === id;
                return (
                  <Pressable
                    key={id ?? 'none'}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => update({ targetId: id })}
                    style={[styles.chip, selected && styles.chipSelected]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                      {target?.name ?? '数えない'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {selectedTarget && (
              <View style={styles.perUnitRow}>
                <Text style={styles.perUnitLabel}>1つあたり</Text>
                <TextInput
                  style={[styles.input, styles.perUnitInput]}
                  value={form.amountPerUnit}
                  onChangeText={(amountPerUnit) => update({ amountPerUnit })}
                  keyboardType="decimal-pad"
                  inputMode="decimal"
                  accessibilityLabel="1つあたりの量"
                />
                <Text style={styles.perUnitLabel}>{selectedTarget.unit}</Text>
              </View>
            )}
            {selectedTarget && (
              <Text style={styles.hint}>単位が同じなら1のまま。水 500ml の本を L で数えるなら 0.5</Text>
            )}
          </View>
        )}

        <View style={styles.field}>
          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.input}
            value={form.note}
            onChangeText={(note) => update({ note })}
            placeholder="置き場所など"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { gap: 6 },
  row: { flexDirection: 'row', gap: 12 },
  unitField: { width: 96 },
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
  wrapChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.neutralSurface,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, borderRadius: 8, paddingVertical: 9, alignItems: 'center' },
  segmentSelected: { backgroundColor: colors.surface },
  segmentText: { fontSize: 13, color: colors.textMuted, fontWeight: '500' },
  segmentTextSelected: { color: colors.text, fontWeight: '700' },
  moveButton: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: colors.neutralSurface },
  moveButtonText: { fontSize: 13, fontWeight: '700', color: colors.navActiveText },
  perUnitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  perUnitLabel: { fontSize: 13, fontWeight: '500', color: colors.textSubtle },
  perUnitInput: { width: 88, textAlign: 'center' },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.neutralSurface,
  },
  chipSelected: { backgroundColor: colors.navActive },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  stepInput: { flex: 1, textAlign: 'center' },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  delete: { paddingVertical: 12, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
