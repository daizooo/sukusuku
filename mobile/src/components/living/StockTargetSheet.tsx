import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { StockTarget, StockTargetDraft } from '@/types/app';
import { formatQuantity, requiredQuantity, type StockPlan } from '@/lib/stockUtils';
import { colors } from '@/lib/theme';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 防災備蓄の必要数（目標）を足す・直す（docs/home.md §3.5）。PWA版の
// `src/components/sukusuku/modals/StockTargetModal.tsx` と同じ項目・同じ文言。
//
// 必要数は「1人1日あたり × 人数 × 日数」か「決まった数」。入力中に、いまの人数・日数で
// 何がいくつ要るかを下に出す（水 3L なら「必要数 63L（3人×7日）」）。

interface FormState {
  name: string;
  quantity: string;
  perPersonDay: boolean;
  carry: boolean;
  unit: string;
  note: string;
}

const initialState = (target: StockTarget | null): FormState =>
  target
    ? {
        name: target.name,
        quantity: formatQuantity(target.quantity),
        perPersonDay: target.perPersonDay,
        carry: target.carry,
        unit: target.unit,
        note: target.note,
      }
    : { name: '', quantity: '1', perPersonDay: true, carry: false, unit: '', note: '' };

function toTargetDraft(form: FormState, category: string): StockTargetDraft | string {
  if (form.name.trim() === '') return '名前を入れてください';
  const quantity = Number(form.quantity.trim());
  if (form.quantity.trim() === '' || !Number.isFinite(quantity) || quantity < 0) {
    return '量は0以上の数字で入れてください';
  }
  return {
    name: form.name,
    category,
    quantity,
    perPersonDay: form.perPersonDay,
    carry: form.carry,
    unit: form.unit,
    note: form.note,
  };
}

interface StockTargetSheetProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  target: StockTarget | null;
  plan: StockPlan;
  onClose: () => void;
  onSubmit: (draft: StockTargetDraft) => void;
  onDelete?: () => void;
}

const MODES: { value: boolean; label: string }[] = [
  { value: true, label: '1人1日あたり' },
  { value: false, label: '決まった数' },
];

export default function StockTargetSheet({ target, plan, onClose, onSubmit, onDelete }: StockTargetSheetProps) {
  const [form, setForm] = useState<FormState>(() => initialState(target));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const quantity = Number(form.quantity);
  const required = Number.isFinite(quantity)
    ? requiredQuantity({ id: '', quantity, perPersonDay: form.perPersonDay }, plan)
    : null;

  const handleSubmit = () => {
    const draft = toTargetDraft(form, target?.category ?? '');
    if (typeof draft === 'string') {
      setError(draft);
      return;
    }
    onSubmit(draft);
  };

  const handleDelete = () =>
    Alert.alert('この必要数を削除しますか？', '数えていた備蓄は残ります。', [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={target ? '必要数を編集' : '必要数を追加'}
        onClose={onClose}
        footer={
          <>
            <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
              <Text style={styles.submitText}>{target ? '保存する' : '追加する'}</Text>
            </Pressable>
            {target && onDelete && (
              <Pressable accessibilityRole="button" onPress={handleDelete} style={styles.delete}>
                <Text style={styles.deleteText}>削除する</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View style={styles.field}>
          <Text style={styles.label}>名前</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(name) => update({ name })}
            placeholder="例: 水"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>数え方</Text>
          <View style={styles.segmented}>
            {MODES.map((mode) => {
              const selected = mode.value === form.perPersonDay;
              return (
                <Pressable
                  key={mode.label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => update({ perPersonDay: mode.value })}
                  style={[styles.segment, selected && styles.segmentSelected]}
                >
                  <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{mode.label}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.row}>
          <View style={[styles.field, styles.flex]}>
            <Text style={styles.label}>{form.perPersonDay ? '1人1日あたり' : '必要数'}</Text>
            <TextInput
              style={styles.input}
              value={form.quantity}
              onChangeText={(value) => update({ quantity: value })}
              keyboardType="decimal-pad"
              inputMode="decimal"
            />
          </View>
          <View style={[styles.field, styles.unitField]}>
            <Text style={styles.label}>単位</Text>
            <TextInput
              style={styles.input}
              value={form.unit}
              onChangeText={(unit) => update({ unit })}
              placeholder="L"
              placeholderTextColor={colors.textFaint}
            />
          </View>
        </View>

        {form.perPersonDay && required !== null && (
          <Text style={styles.required}>
            必要数 {formatQuantity(Math.round(required * 100) / 100)}
            {form.unit}（{plan.people}人×{plan.days}日）
          </Text>
        )}

        <View style={styles.switchRow}>
          <View style={styles.flex}>
            <Text style={styles.label}>持ち出しにも入れる</Text>
            <Text style={styles.hint}>
              {form.perPersonDay
                ? `持ち出しに${plan.carryDays}日分（${formatQuantity(
                    Number.isFinite(quantity) ? Math.round(quantity * plan.people * plan.carryDays * 100) / 100 : 0,
                  )}${form.unit}）あるかも確かめる`
                : '決まった数を全部、持ち出しに入れる'}
            </Text>
          </View>
          <Switch value={form.carry} onValueChange={(carry) => update({ carry })} />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.input}
            value={form.note}
            onChangeText={(note) => update({ note })}
            placeholder="例: 夏場の水分補給用"
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hint: { fontSize: 11, fontWeight: '500', color: colors.textFaint, marginTop: 2 },
  required: { fontSize: 13, fontWeight: '700', color: colors.navActiveText, fontVariant: ['tabular-nums'] },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.navActive },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  delete: { paddingVertical: 12, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
