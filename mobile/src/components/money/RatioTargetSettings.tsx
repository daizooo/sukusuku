import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { MoneyRatioTargets } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { saveMoneyRatioTargets } from '@/lib/api/money';
import { PrimaryButton, ScreenHeader } from '@/components/money/moneyVisual';

// 目安の割合（docs/kakei.md §0.9。2026-10-24）。PWA版の `src/components/sukusuku/money/RatioTargetSettings.tsx` と同じ並び・文言。
// 支出の種類（変動費・予備費・固定費〔確定＋見込み〕）ごとに、収入に対する目安の割合（%）を決める。年の振り返りの見出しに
// 「11%（目安35%）」の形で出す。収支（残り）は 100% − 合計で、ここに出すだけ。合計が100%を超えると保存できない。
// 空にした種類は目安なし（振り返りに出さない）。

interface RatioTargetSettingsProps {
  familyId: string;
  targets: MoneyRatioTargets;
  onSaved: (targets: MoneyRatioTargets) => void;
  onBack: () => void;
}

const ROWS: { key: keyof MoneyRatioTargets; label: string }[] = [
  { key: 'variable', label: '変動費' },
  { key: 'reserve', label: '予備費' },
  { key: 'fixed', label: '固定費（確定・見込み）' },
];

/** 入力の文字を割合（0〜100 の整数）にする。空は null、読めない・範囲外は undefined。 */
function parsePercent(text: string): number | null | undefined {
  const value = text.replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).replace(/[%％\s]/g, '');
  if (value === '') return null;
  if (!/^\d+$/.test(value)) return undefined;
  const percent = Number(value);
  return percent <= 100 ? percent : undefined;
}

export default function RatioTargetSettings({ familyId, targets, onSaved, onBack }: RatioTargetSettingsProps) {
  const [texts, setTexts] = useState<Record<keyof MoneyRatioTargets, string>>({
    variable: targets.variable === null ? '' : String(targets.variable),
    reserve: targets.reserve === null ? '' : String(targets.reserve),
    fixed: targets.fixed === null ? '' : String(targets.fixed),
  });
  const [saving, setSaving] = useState(false);

  const parsed = ROWS.map((row) => parsePercent(texts[row.key]));
  const invalid = parsed.some((value) => value === undefined);
  const total = parsed.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const over = total > 100;

  const save = async () => {
    if (invalid || over) return;
    const next: MoneyRatioTargets = { variable: parsed[0] ?? null, reserve: parsed[1] ?? null, fixed: parsed[2] ?? null };
    setSaving(true);
    try {
      await saveMoneyRatioTargets(supabase, familyId, next);
      onSaved(next);
      onBack();
    } catch {
      Alert.alert('保存できませんでした', 'もう一度お試しください。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <ScreenHeader title="目安の割合" icon="back" onClose={onBack} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.hint}>収入に対して、支出の種類ごとに何%までに収めたいか。年の振り返りで実績の割合と並べます。</Text>
        <View style={styles.card}>
          {ROWS.map((row, index) => (
            <View key={row.key} style={[styles.row, index > 0 && styles.divided]}>
              <Text style={[styles.label, styles.flex]}>{row.label}</Text>
              <TextInput
                value={texts[row.key]}
                onChangeText={(text) => setTexts((prev) => ({ ...prev, [row.key]: text }))}
                keyboardType="number-pad"
                placeholder="−"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, parsed[index] === undefined && styles.inputError]}
                accessibilityLabel={`${row.label}の目安（%）`}
                maxLength={3}
              />
              <Text style={styles.unit}>%</Text>
            </View>
          ))}
          <View style={[styles.row, styles.divided]}>
            <Text style={[styles.label, styles.flex, styles.muted]}>収支（残り）</Text>
            <Text style={[styles.rest, over && styles.error]}>{`${100 - total}%`}</Text>
          </View>
        </View>
        {over && <Text style={styles.errorText}>合計が100%を超えています</Text>}
        <PrimaryButton label={saving ? '保存しています…' : '保存'} onPress={() => void save()} disabled={saving || invalid || over} />
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { padding: 16, gap: 12 },
  hint: { fontSize: 13, fontWeight: '500', color: colors.textMuted },
  card: { borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  divided: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { fontSize: 15, fontWeight: '600', color: colors.text },
  muted: { color: colors.textMuted },
  input: {
    width: 64,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  inputError: { borderColor: colors.moneyOver },
  unit: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  rest: { fontSize: 16, fontWeight: '700', color: colors.textMuted, fontVariant: ['tabular-nums'] },
  error: { color: colors.moneyOver },
  errorText: { fontSize: 13, fontWeight: '600', color: colors.moneyOver },
});
