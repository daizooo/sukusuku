import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Trash2 } from 'lucide-react-native';
import type { GrowthRecord } from '@/types/app';
import {
  formatDateString,
  monthsSinceBirth,
  parseDateString,
  toDateString,
} from '@/lib/dateUtils';
import {
  maxWeightFor,
  round2,
  toWeightKg,
  validateGrowthRecordForm,
  type GrowthRecordDraft,
  type WeightUnit,
} from '@/lib/growthRecordInput';
import { colors } from '@/lib/theme';
import LogModalShell, { LOG_SHEET_HEIGHT } from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 身長・体重の記録。Web版の
// `src/components/sukusuku/modals/GrowthRecordFormModal.tsx` を置き換えたもの。
// 入力の順序・既定値・保存する中身・突き返す文言は同じにしてある。

interface FormState {
  recordedDate: string;
  // null は「誕生日から自動計算」の状態。ユーザーが触ると文字列になる。
  monthAge: string | null;
  height: string;
  weight: string;
  weightUnit: WeightUnit;
}

const initialState = (mode: 'add' | 'edit' | null, record: GrowthRecord | null): FormState => {
  if (mode === 'edit' && record) {
    return {
      recordedDate: record.recordedDate,
      // 生後ヶ月が未入力のままの記録は、開いたときに自動計算で補えるよう null にしておく
      monthAge: record.month !== null ? String(record.month) : null,
      height: record.height !== null ? String(record.height) : '',
      weight: record.weight !== null ? String(record.weight) : '',
      weightUnit: 'kg',
    };
  }
  return {
    recordedDate: toDateString(new Date()),
    monthAge: null,
    height: '',
    weight: '',
    weightUnit: 'kg',
  };
};

interface GrowthRecordFormModalProps {
  mode: 'add' | 'edit' | null;
  record: GrowthRecord | null;
  /** プロフィールに登録された子の誕生日（'YYYY-MM-DD'）。未設定なら空文字。 */
  birthDate?: string;
  onClose: () => void;
  onSubmit: (draft: GrowthRecordDraft) => void;
  onDelete?: (id: string) => void;
}

// 呼び出し側で対象が変わるたびに作り直す前提（初期値をそのとき計算するため）。
export default function GrowthRecordFormModal({
  mode,
  record,
  birthDate = '',
  onClose,
  onSubmit,
  onDelete,
}: GrowthRecordFormModalProps) {
  const [form, setForm] = useState<FormState>(() => initialState(mode, record));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setError(null);
  };

  // 生後ヶ月は誕生日と記録日から自動で埋める。ユーザーが自分で入力したらそちらを優先する。
  const autoMonthAge = birthDate ? monthsSinceBirth(birthDate, form.recordedDate) : null;
  const isMonthAgeAuto = form.monthAge === null && autoMonthAge !== null;
  const monthAgeValue = form.monthAge ?? (autoMonthAge !== null ? String(autoMonthAge) : '');

  const weightInKg = toWeightKg(form.weight, form.weightUnit);

  // 単位を切り替えたら入力済みの数値も換算する。
  // 「3.2」と入れたあとにgへ切り替えて3.2gとして保存されてしまうのを防ぐ。
  const changeWeightUnit = (unit: WeightUnit) => {
    if (unit === form.weightUnit) return;
    const parsed = Number(form.weight);
    const converted =
      form.weight.trim() === '' || !Number.isFinite(parsed)
        ? form.weight
        : String(round2(unit === 'g' ? parsed * 1000 : parsed / 1000));
    update({ weightUnit: unit, weight: converted });
  };

  const handleSubmit = () => {
    const result = validateGrowthRecordForm({
      recordedDate: form.recordedDate,
      monthAge: monthAgeValue,
      height: form.height,
      weight: form.weight,
      weightUnit: form.weightUnit,
    });
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSubmit(result.draft);
  };

  // 記録日は <input type="date"> が無いので端末のピッカーで選ぶ。
  const openDatePicker = () =>
    DateTimePickerAndroid.open({
      value: parseDateString(form.recordedDate) ?? new Date(),
      mode: 'date',
      onChange: (_event, picked) => {
        if (picked) update({ recordedDate: toDateString(picked) });
      },
    });

  return (
    <SheetModal visible={mode !== null} onClose={onClose} height={LOG_SHEET_HEIGHT}>
      {/* 他の記録の入力と同じ枠・同じ大きさで開く。 */}
      <LogModalShell
        title={mode === 'add' ? '身長・体重を記録' : '記録を編集'}
        onClose={onClose}
        footer={
          <>
            <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
              <Text style={styles.submitText}>{mode === 'add' ? '追加する' : '保存する'}</Text>
            </Pressable>
            {mode === 'edit' && record && onDelete && (
              <Pressable
                accessibilityRole="button"
                onPress={() => onDelete(record.id)}
                style={styles.delete}
              >
                <Trash2 size={14} color={colors.danger} />
                <Text style={styles.deleteText}>削除する</Text>
              </Pressable>
            )}
          </>
        }
      >
        <View>
          <Text style={styles.label}>記録日</Text>
          <Pressable accessibilityRole="button" onPress={openDatePicker} style={styles.input}>
            <Text style={styles.inputText}>{form.recordedDate}</Text>
          </Pressable>
          {form.recordedDate !== '' && (
            <Text style={styles.hint}>{formatDateString(parseDateString(form.recordedDate))}</Text>
          )}
        </View>

        <View>
          <Text style={styles.label}>生後ヶ月</Text>
          <TextInput
            style={styles.input}
            value={monthAgeValue}
            onChangeText={(monthAge) => update({ monthAge })}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder="例: 1"
            placeholderTextColor={colors.textFaint}
          />
          <Text style={styles.hint}>
            {isMonthAgeAuto
              ? '誕生日と記録日から自動で計算しています。変更もできます。'
              : 'グラフの横軸に使います。未入力の場合は記録日で並びます。'}
          </Text>
        </View>

        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.label}>身長 (cm)</Text>
            <TextInput
              style={styles.input}
              value={form.height}
              onChangeText={(height) => update({ height })}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder="例: 50.2"
              placeholderTextColor={colors.textFaint}
            />
          </View>

          <View style={styles.flex}>
            <Text style={styles.label}>体重</Text>
            <TextInput
              style={styles.input}
              value={form.weight}
              onChangeText={(weight) => update({ weight })}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={form.weightUnit === 'kg' ? '例: 3.2' : '例: 3200'}
              placeholderTextColor={colors.textFaint}
            />
            <View accessibilityLabel="体重の単位" style={styles.units}>
              {(['kg', 'g'] as const).map((unit) => {
                const selected = form.weightUnit === unit;
                return (
                  <Pressable
                    key={unit}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => changeWeightUnit(unit)}
                    style={[styles.unit, selected && styles.unitSelected]}
                  >
                    <Text style={[styles.unitText, selected && styles.unitTextSelected]}>
                      {unit}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {form.weightUnit === 'g' && weightInKg !== null && (
              <Text style={styles.hint}>= {weightInKg}kg として保存します</Text>
            )}
          </View>
        </View>

        {error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', gap: 12 },
  label: { fontSize: 12, fontWeight: '500', color: colors.textSubtle, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    fontSize: 14,
    color: colors.textSubtle,
    backgroundColor: colors.surface,
    fontVariant: ['tabular-nums'],
  },
  inputText: { fontSize: 14, color: colors.textSubtle, fontWeight: '500', fontVariant: ['tabular-nums'] },
  hint: { fontSize: 10, color: colors.textFaint, marginTop: 4 },
  units: {
    flexDirection: 'row',
    backgroundColor: colors.border,
    borderRadius: 8,
    padding: 2,
    marginTop: 6,
  },
  unit: { flex: 1, alignItems: 'center', paddingVertical: 4, borderRadius: 6 },
  unitSelected: { backgroundColor: colors.surface },
  unitText: { fontSize: 11, fontWeight: '700', color: colors.textMuted },
  unitTextSelected: { color: colors.navActiveText },
  error: {
    fontSize: 12,
    color: colors.danger,
    backgroundColor: colors.alertSurface,
    borderRadius: 8,
    padding: 8,
  },
  submit: {
    backgroundColor: colors.navActive,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { fontSize: 15, fontWeight: '500', color: colors.primaryText },
  delete: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
  },
  deleteText: { fontSize: 12, fontWeight: '500', color: colors.danger },
});
