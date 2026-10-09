import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Minus, Plus, X } from 'lucide-react-native';
import type { SpecialItem, SpecialItemDraft, SpecialKind } from '@/types/app';
import { colors } from '@/lib/theme';
import { YEAR_MONTHS, cycleLabel, formatYear, parseAmountInput, sortPlans } from '@/lib/specialUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import SegmentedTabs from '@/components/ui/SegmentedTabs';

// 支出予定・収入予定（特別費）の項目を足す・直す（docs/kakei.md §3.5・§4.3）。PWA版の
// `src/components/sukusuku/money/SpecialItemModal.tsx` と同じ項目・同じ文言。
//
// 周期と、月ごとの予定（月・金額）を入れる。実績は入れない（払った額は家計の記録に、特別費の項目として記録する）。

interface PlanForm {
  id: string | null;
  month: number | null;
  amount: string;
  tentative: boolean;
}

interface FormState {
  kind: SpecialKind;
  name: string;
  category: string;
  cycleYears: number;
  baseYear: number;
  plans: PlanForm[];
  note: string;
}

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '収入' },
];

/** 周期の選び方。既にある値（7年おきなど）はそれも並べる。 */
const CYCLE_CHOICES = [1, 2, 3, 5, 10, 0];

const emptyPlan = (): PlanForm => ({ id: null, month: null, amount: '', tentative: false });

const initialState = (item: SpecialItem | null, defaultKind: SpecialKind, year: number): FormState =>
  item
    ? {
        kind: item.kind,
        name: item.name,
        category: item.category,
        cycleYears: item.cycleYears,
        baseYear: item.baseYear ?? year,
        plans: sortPlans(item.plans).map((plan) => ({
          id: plan.id,
          month: plan.month,
          amount: String(plan.amount),
          tentative: plan.tentative,
        })),
        note: item.note,
      }
    : {
        kind: defaultKind,
        name: '',
        category: '',
        cycleYears: 1,
        baseYear: year,
        plans: [emptyPlan()],
        note: '',
      };

interface SpecialItemSheetProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  item: SpecialItem | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** 追加するときの種類（いま見ている支出/収入）。 */
  defaultKind: SpecialKind;
  /** いま見ている年。周期の起点の既定に使う。 */
  year: number;
  onClose: () => void;
  onSubmit: (draft: SpecialItemDraft) => void;
  onDelete?: () => void;
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export default function SpecialItemSheet({
  item,
  categories,
  defaultKind,
  year,
  onClose,
  onSubmit,
  onDelete,
}: SpecialItemSheetProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item, defaultKind, year));
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));
  const updatePlan = (index: number, patch: Partial<PlanForm>) =>
    setForm((prev) => ({
      ...prev,
      plans: prev.plans.map((plan, i) => (i === index ? { ...plan, ...patch } : plan)),
    }));

  const isEditing = item !== null;
  // 予定の無い項目（予定外の出費）を直すときは、予定が0件のままでも保存できる。
  const minPlans = item && item.plans.length === 0 ? 0 : 1;
  const cycleChoices = CYCLE_CHOICES.includes(form.cycleYears) ? CYCLE_CHOICES : [...CYCLE_CHOICES, form.cycleYears];

  const handleSubmit = () => {
    if (form.name.trim() === '') return setError('名前を入れてください');

    if (form.plans.length < minPlans) return setError('予定を1つ以上入れてください');
    const plans: SpecialItemDraft['plans'] = [];
    for (const plan of form.plans) {
      const amount = parseAmountInput(plan.amount);
      if (amount === null) return setError('予定の金額は0以上の整数（円）で入れてください');
      plans.push({ id: plan.id, month: plan.month, amount, tentative: plan.tentative && plan.month !== null });
    }
    onSubmit({
      kind: form.kind,
      category: form.category.trim(),
      name: form.name.trim(),
      cycleYears: form.cycleYears,
      // 毎年なら起点は持たない（既にある起点はそのまま残す）。
      baseYear: form.cycleYears === 1 ? (item?.baseYear ?? null) : form.baseYear,
      note: form.note,
      plans,
    });
  };

  const handleDelete = () =>
    Alert.alert('この項目を削除しますか？', '予定と、この項目で記録した特別費もいっしょに消えます。', [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={isEditing ? '項目を編集' : '予定を追加'}
        onClose={onClose}
        footer={
          <>
            <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
              <Text style={styles.submitText}>{isEditing ? '保存する' : '追加する'}</Text>
            </Pressable>
            {isEditing && onDelete && (
              <Pressable accessibilityRole="button" onPress={handleDelete} style={styles.delete}>
                <Text style={styles.deleteText}>削除する</Text>
              </Pressable>
            )}
          </>
        }
      >
        <SegmentedTabs
          options={KIND_OPTIONS}
          value={form.kind}
          onChange={(kind) => update({ kind })}
          accessibilityLabel="支出か収入か"
        />

        <View style={styles.field}>
          <Text style={styles.label}>名前</Text>
          <TextInput
            style={styles.input}
            value={form.name}
            onChangeText={(name) => update({ name })}
            placeholder="例: 自動車税"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>種類</Text>
          <TextInput
            style={styles.input}
            value={form.category}
            onChangeText={(category) => update({ category })}
            placeholder="例: 税金"
            placeholderTextColor={colors.textFaint}
          />
          {categories.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
              {categories.map((option) => (
                <Chip
                  key={option}
                  label={option}
                  selected={option === form.category.trim()}
                  onPress={() => update({ category: option })}
                />
              ))}
            </ScrollView>
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>周期</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
            {cycleChoices.map((years) => (
              <Chip
                key={years}
                label={cycleLabel(years)}
                selected={years === form.cycleYears}
                onPress={() => update({ cycleYears: years })}
              />
            ))}
          </ScrollView>
          {form.cycleYears !== 1 && (
            <View style={styles.stepRow}>
              <Text style={styles.stepLabel}>{form.cycleYears === 0 ? '出る年' : '最初に出る年'}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="年を戻す"
                onPress={() => update({ baseYear: form.baseYear - 1 })}
                style={styles.stepButton}
              >
                <Minus size={14} color={colors.textSubtle} />
              </Pressable>
              <Text style={styles.stepValue}>{formatYear(form.baseYear)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="年を進める"
                onPress={() => update({ baseYear: form.baseYear + 1 })}
                style={styles.stepButton}
              >
                <Plus size={14} color={colors.textSubtle} />
              </Pressable>
            </View>
          )}
          <Text style={styles.hint}>
            {form.cycleYears === 1
              ? '毎年出ます'
              : form.cycleYears === 0
                ? 'その年だけ出ます'
                : `その年から ${form.cycleYears} 年ごとに出ます（間の年には出ません）`}
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>予定（1年の中で出る回数ぶん）</Text>
          {form.plans.map((plan, index) => (
            <View key={plan.id ?? `new-${index}`} style={styles.planBox}>
              <View style={styles.planHead}>
                <Text style={styles.planTitle}>{index + 1}回目</Text>
                {form.plans.length > minPlans && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${index + 1}回目の予定を消す`}
                    onPress={() => setForm((prev) => ({ ...prev, plans: prev.plans.filter((_, i) => i !== index) }))}
                    hitSlop={8}
                  >
                    <X size={16} color={colors.textFaint} />
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.chips}>
                {[...YEAR_MONTHS, null].map((month) => (
                  <Chip
                    key={month ?? 'none'}
                    label={month === null ? '月未定' : `${month}月`}
                    selected={month === plan.month}
                    onPress={() => updatePlan(index, { month })}
                  />
                ))}
              </ScrollView>
              <View style={styles.planRow}>
                <TextInput
                  style={[styles.input, styles.flex]}
                  value={plan.amount}
                  onChangeText={(amount) => updatePlan(index, { amount })}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  placeholder="金額（円）"
                  placeholderTextColor={colors.textFaint}
                />
                <Chip
                  label="仮"
                  selected={plan.tentative && plan.month !== null}
                  onPress={() => updatePlan(index, { tentative: !plan.tentative })}
                />
              </View>
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => setForm((prev) => ({ ...prev, plans: [...prev.plans, emptyPlan()] }))}
            style={styles.addPlan}
          >
            <Plus size={14} color={colors.livingSpecial} />
            <Text style={styles.addPlanText}>予定を追加（年に複数回出るとき）</Text>
          </Pressable>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.input}
            value={form.note}
            onChangeText={(note) => update({ note })}
            placeholder="任意"
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
  chipSelected: { backgroundColor: colors.livingSpecial },
  chipText: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextSelected: { color: colors.primaryText },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  stepButton: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutralSurface,
  },
  stepValue: { minWidth: 72, textAlign: 'center', fontSize: 14, fontWeight: '700', color: colors.text },
  planBox: {
    gap: 8,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  planHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  planTitle: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  planRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addPlan: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addPlanText: { fontSize: 13, fontWeight: '700', color: colors.livingSpecial },
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.livingSpecial },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  delete: { paddingVertical: 12, alignItems: 'center' },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
