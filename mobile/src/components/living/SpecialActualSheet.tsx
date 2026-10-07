import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { SpecialActualDraft } from '@/types/app';
import { colors } from '@/lib/theme';
import { toDateString } from '@/lib/dateUtils';
import { parseAmountInput, parseDateInput, type SpecialRow } from '@/lib/specialUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LogModalShell from '@/components/log/LogModalShell';
import SheetModal from '@/components/ui/SheetModal';

// 特別費の実績を入れる・直す・取り消す（docs/home.md §5.4）。PWA版の
// `src/components/sukusuku/modals/SpecialActualModal.tsx` と同じ項目・同じ文言。
//
// 行（予定1回ぶん、または予定外の出費1件）を押すと開く。「済」ボタンの1タップで
// 予算どおりに入れたあとの、金額・日付の直しもここでする。項目そのものの直しは「項目を編集」から。

interface SpecialActualSheetProps {
  row: SpecialRow;
  onClose: () => void;
  /** 実績を保存する（まだ無ければ足す。あれば直す）。 */
  onSubmit: (draft: SpecialActualDraft) => void;
  /** 実績を取り消す（予定の行は予定に戻り、予定外の出費はそのまま消える）。 */
  onClear?: () => void;
  onEditItem: () => void;
}

export default function SpecialActualSheet({ row, onClose, onSubmit, onClear, onEditItem }: SpecialActualSheetProps) {
  const current = row.actuals[0] ?? null;
  const [amount, setAmount] = useState(() => String(current?.amount ?? row.budget));
  const [date, setDate] = useState(() => current?.occurredOn ?? toDateString(new Date()));
  const [note, setNote] = useState(() => current?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    const value = parseAmountInput(amount);
    if (value === null) return setError('金額は0以上の整数（円）で入れてください');
    const occurredOn = parseDateInput(date);
    if (occurredOn === null) return setError('日付は 2026-07-20 の形で入れてください');
    onSubmit({ occurredOn, amount: value, note });
  };

  const handleClear = () =>
    Alert.alert(row.planId === null ? 'この出費を削除しますか？' : '実績を取り消しますか？', undefined, [
      { text: 'やめる', style: 'cancel' },
      { text: row.planId === null ? '削除' : '取り消す', style: 'destructive', onPress: () => onClear?.() },
    ]);

  const verb = row.item.kind === 'income' ? '入った' : '払った';

  return (
    <SheetModal visible onClose={onClose}>
      <LogModalShell
        title={row.item.name}
        onClose={onClose}
        footer={
          <>
            <Pressable accessibilityRole="button" onPress={handleSubmit} style={styles.submit}>
              <Text style={styles.submitText}>{current ? '保存する' : `${verb}（実績にする）`}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onEditItem} style={styles.secondary}>
              <Text style={styles.secondaryText}>項目を編集（予定・周期）</Text>
            </Pressable>
            {current && onClear && (
              <Pressable accessibilityRole="button" onPress={handleClear} style={styles.secondary}>
                <Text style={styles.deleteText}>{row.planId === null ? '削除する' : '実績を取り消す'}</Text>
              </Pressable>
            )}
          </>
        }
      >
        <Text style={styles.budget}>
          {row.planId === null ? '予定外' : `予算 ${formatPrice(row.budget)}`}
          {row.tentative ? '（月は仮）' : ''}
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>実績（円）</Text>
          <TextInput
            style={styles.input}
            value={amount}
            onChangeText={setAmount}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>日付</Text>
          <TextInput
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="2026-07-20"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>メモ</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="任意"
            placeholderTextColor={colors.textFaint}
          />
        </View>

        {row.actuals.length > 1 && (
          <Text style={styles.hint}>この予定には実績が {row.actuals.length} 件あります（ここでは最初の1件を直します）</Text>
        )}
        {error && <Text style={styles.error}>{error}</Text>}
      </LogModalShell>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  budget: { fontSize: 13, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
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
  error: { fontSize: 12, fontWeight: '500', color: colors.danger },
  submit: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', backgroundColor: colors.livingSpecial },
  submitText: { color: colors.primaryText, fontSize: 15, fontWeight: '700' },
  secondary: { paddingVertical: 10, alignItems: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '700', color: colors.livingSpecial },
  deleteText: { fontSize: 13, fontWeight: '500', color: colors.danger },
});
