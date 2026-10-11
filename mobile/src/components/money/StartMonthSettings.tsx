import { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { formatMonthKey, monthKeyOfDate, shiftMonth } from '@/lib/moneyUtils';
import { saveMoneyStartMonth } from '@/lib/api/money';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 集計の開始月の設定（docs/kakei.md §0.4）。PWA版の `src/components/sukusuku/money/StartMonthSettings.tsx` と同じ並び・文言。
// 年の振り返りと、年初からの累計は、この月以降の記録のある月だけを数える。それより前の月は、月の画面では見られる。

interface StartMonthSettingsProps {
  familyId: string;
  /** いまの開始月（YYYY-MM）。null は全部の月を数える。 */
  startMonth: string | null;
  onSaved: (startMonth: string | null) => void;
  onBack: () => void;
}

export default function StartMonthSettings({ familyId, startMonth, onSaved, onBack }: StartMonthSettingsProps) {
  const [enabled, setEnabled] = useState(startMonth !== null);
  const [month, setMonth] = useState(startMonth ?? monthKeyOfDate(new Date()));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const value = enabled ? month : null;
      await saveMoneyStartMonth(supabase, familyId, value);
      onSaved(value);
      onBack();
    } catch {
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenHeader title="集計の開始月" icon="back" onClose={onBack} />
      <View style={styles.content}>
        <Text style={styles.note}>
          年の振り返りと、年初からの累計は、この月以降の記録のある月だけを数えます。それより前の月は、月の振り返りでは見られますが、年と累計には入りません。
        </Text>
        <View style={styles.choices}>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: enabled }}
            onPress={() => setEnabled(true)}
            style={[styles.choice, enabled && styles.choiceOn]}
          >
            <Text style={[styles.choiceText, enabled && styles.choiceTextOn]}>月を決める</Text>
          </Pressable>
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ selected: !enabled }}
            onPress={() => setEnabled(false)}
            style={[styles.choice, !enabled && styles.choiceOn]}
          >
            <Text style={[styles.choiceText, !enabled && styles.choiceTextOn]}>すべての月を数える</Text>
          </Pressable>
        </View>
        {enabled && (
          <View style={styles.stepper}>
            <Pressable accessibilityRole="button" accessibilityLabel="前の月" onPress={() => setMonth(shiftMonth(month, -1))} hitSlop={10}>
              <ChevronLeft size={26} color={colors.textSubtle} />
            </Pressable>
            <Text style={styles.month}>{formatMonthKey(month)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="次の月" onPress={() => setMonth(shiftMonth(month, 1))} hitSlop={10}>
              <ChevronRight size={26} color={colors.textSubtle} />
            </Pressable>
          </View>
        )}
      </View>
      <View style={styles.footer}>
        <PrimaryButton label={saving ? '保存しています' : '保存する'} onPress={() => void save()} disabled={saving} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: { flex: 1, padding: 16, gap: 16 },
  note: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: colors.textMuted },
  choices: { flexDirection: 'row', gap: 8 },
  choice: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  choiceOn: { borderColor: colors.moneySoft, backgroundColor: colors.moneySoft },
  choiceText: { fontSize: 14, fontWeight: '600', color: colors.textSubtle },
  choiceTextOn: { color: colors.moneyText, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingVertical: 8 },
  month: { fontSize: 22, fontWeight: '800', color: colors.text, minWidth: 140, textAlign: 'center' },
  footer: { padding: 16 },
});
