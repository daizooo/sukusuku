import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Minus, Plus, X } from 'lucide-react-native';
import type { SpecialActualDraft, SpecialItem, SpecialItemDraft, SpecialKind } from '@/types/app';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import {
  FISCAL_MONTHS,
  MAX_CYCLE_YEARS,
  cycleLabel,
  formatFiscalYear,
  parseAmountInput,
  parseDateInput,
  sortPlans,
} from '@/lib/specialUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';
import SegmentedTabs from '@/components/ui/SegmentedTabs';

// 特別費の項目を足す・直す（docs/home.md §5.4）。PWA版の
// `src/components/sukusuku/modals/SpecialItemModal.tsx` と同じ項目・同じ文言。
//
// 足すときは、予定として登録する（周期と、月ごとの予定を入れる）か、すでに払った予定外の出費
// （金額と日付だけ。予定の無い項目＋実績になる）かを選ぶ。直すときは項目と予定だけ（実績は行から）。

/** 追加・保存の結果。 */
export type SpecialItemSheetResult =
  | { type: 'plan'; draft: SpecialItemDraft }
  | {
      type: 'unplanned';
      fields: { kind: SpecialKind; category: string; name: string };
      actual: SpecialActualDraft;
    };

interface PlanForm {
  id: string | null;
  month: number | null;
  amount: string;
  tentative: boolean;
}

type Mode = 'plan' | 'unplanned';

interface FormState {
  mode: Mode;
  kind: SpecialKind;
  name: string;
  category: string;
  cycleYears: number;
  baseYear: number;
  plans: PlanForm[];
  note: string;
  paidAmount: string;
  paidDate: string;
}

const MODE_OPTIONS: { id: Mode; label: string }[] = [
  { id: 'plan', label: '予定として登録' },
  { id: 'unplanned', label: 'すでに払った（予定外）' },
];

const KIND_OPTIONS: { id: SpecialKind; label: string }[] = [
  { id: 'expense', label: '支出' },
  { id: 'income', label: '収入' },
];

/** 周期の選び方。既にある値（7年おきなど）はそれも並べる。 */
const CYCLE_CHOICES = [1, 2, 3, 5, 10, 0];

const emptyPlan = (): PlanForm => ({ id: null, month: null, amount: '', tentative: false });

const initialState = (item: SpecialItem | null, defaultKind: SpecialKind, fiscalYear: number): FormState =>
  item
    ? {
        mode: 'plan',
        kind: item.kind,
        name: item.name,
        category: item.category,
        cycleYears: item.cycleYears,
        baseYear: item.baseYear ?? fiscalYear,
        plans: sortPlans(item.plans).map((plan) => ({
          id: plan.id,
          month: plan.month,
          amount: String(plan.amount),
          tentative: plan.tentative,
        })),
        note: item.note,
        paidAmount: '',
        paidDate: toDateString(new Date()),
      }
    : {
        mode: 'plan',
        kind: defaultKind,
        name: '',
        category: '',
        cycleYears: 1,
        baseYear: fiscalYear,
        plans: [emptyPlan()],
        note: '',
        paidAmount: '',
        paidDate: toDateString(new Date()),
      };

interface SpecialItemSheetProps {
  /** null なら追加。呼び出し側で対象が変わるたびに作り直す。 */
  item: SpecialItem | null;
  /** カテゴリの候補（既にある値）。 */
  categories: string[];
  /** 追加するときの種類（いま見ている支出/収入）。 */
  defaultKind: SpecialKind;
  /** いま見ている年度。起点・予定外の年度の既定に使う。 */
  fiscalYear: number;
  onClose: () => void;
  onSubmit: (result: SpecialItemSheetResult) => void;
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
  fiscalYear,
  onClose,
  onSubmit,
  onDelete,
}: SpecialItemSheetProps) {
  const [form, setForm] = useState<FormState>(() => initialState(item, defaultKind, fiscalYear));
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

    if (form.mode === 'unplanned') {
      const amount = parseAmountInput(form.paidAmount);
      if (amount === null) return setError('金額は0以上の整数（円）で入れてください');
      const occurredOn = parseDateInput(form.paidDate);
      if (occurredOn === null) return setError('日付は 2026-07-20 の形で入れてください');
      return onSubmit({
        type: 'unplanned',
        fields: { kind: form.kind, category: form.category.trim(), name: form.name.trim() },
        actual: { occurredOn, amount, note: form.note },
      });
    }

    if (form.plans.length < minPlans) return setError('予定を1つ以上入れてください');
    const plans: SpecialItemDraft['plans'] = [];
    for (const plan of form.plans) {
      const amount = parseAmountInput(plan.amount);
      if (amount === null) return setError('予定の金額は0以上の整数（円）で入れてください');
      plans.push({ id: plan.id, month: plan.month, amount, tentative: plan.tentative && plan.month !== null });
    }
    onSubmit({
      type: 'plan',
      draft: {
        kind: form.kind,
        category: form.category.trim(),
        name: form.name.trim(),
        cycleYears: form.cycleYears,
        // 毎年なら起点は持たない（既にある起点はそのまま残す）。
        baseYear: form.cycleYears === 1 ? (item?.baseYear ?? null) : form.baseYear,
        note: form.note,
        plans,
      },
    });
  };

  const handleDelete = () =>
    Alert.alert('この項目を削除しますか？', '予定と実績もいっしょに消えます。', [
      { text: 'やめる', style: 'cancel' },
      { text: '削除', style: 'destructive', onPress: () => onDelete?.() },
    ]);

  const unplanned = form.mode === 'unplanned';

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={isEditing ? '項目を編集' : '特別費を追加'}
        onClose={onClose}
        subheader={
          !isEditing ? (
            <SegmentedTabs options={MODE_OPTIONS} value={form.mode} onChange={(mode) => update({ mode })} />
          ) : undefined
        }
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

        {unplanned ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>金額（円）</Text>
              <TextInput
                style={styles.input}
                value={form.paidAmount}
                onChangeText={(paidAmount) => update({ paidAmount })}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="例: 30500"
                placeholderTextColor={colors.textFaint}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>日付</Text>
              <TextInput
                style={styles.input}
                value={form.paidDate}
                onChangeText={(paidDate) => update({ paidDate })}
                placeholder="2026-07-20"
                placeholderTextColor={colors.textFaint}
              />
              <Text style={styles.hint}>{formatFiscalYear(fiscalYear)}以外の日付なら、その年度に入ります</Text>
            </View>
          </>
        ) : (
          <>
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
                  <Text style={styles.stepLabel}>{form.cycleYears === 0 ? '出る年度' : '最初に出る年度'}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="年度を戻す"
                    onPress={() => update({ baseYear: form.baseYear - 1 })}
                    style={styles.stepButton}
                  >
                    <Minus size={14} color={colors.textSubtle} />
                  </Pressable>
                  <Text style={styles.stepValue}>{formatFiscalYear(form.baseYear)}</Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="年度を進める"
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
                    ? 'その年度だけ出ます'
                    : `その年度から ${form.cycleYears} 年ごとに出ます（間の年度には出ません）`}
              </Text>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>予定（年度の中で出る回数ぶん）</Text>
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
                    {[...FISCAL_MONTHS, null].map((month) => (
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
          </>
        )}

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
