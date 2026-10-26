import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LayoutGrid } from 'lucide-react-native';
import { useWidgetThemeMode } from '@/lib/widgetThemeSetting';
import { refreshAllWidgets } from '@/widgets/refreshWidgets';
import { widgetsAvailable } from '@/widgets/availability';
import type { WidgetThemeMode } from '@/widgets/widgetPalette';
import { colors } from '@/lib/theme';

// ホーム画面のウィジェットの配色（ライト・ダーク）の設定（docs/widgets.md §2.6）。
// ネイティブ版（Android）だけの機能で、Web版には出さない。**この端末だけの設定**で、家族では共有しない。
// 切り替えると、置いてあるウィジェットをその場で描き直す。アプリの画面はライトのまま（ウィジェットだけ）。

const OPTIONS: { mode: WidgetThemeMode; label: string }[] = [
  { mode: 'light', label: 'ライト' },
  { mode: 'dark', label: 'ダーク' },
];

export default function WidgetThemeSetting() {
  const { mode, update } = useWidgetThemeMode();
  const [error, setError] = useState<string | null>(null);

  // ウィジェットの部品の無い環境（Expo Go・iOS）では、ウィジェットを置けないので出さない。
  if (!widgetsAvailable || !mode) return null;

  const select = async (next: WidgetThemeMode) => {
    if (next === mode) return;
    setError(null);
    try {
      await update(next);
      await refreshAllWidgets();
    } catch {
      setError('設定を保存できませんでした。もう一度お試しください。');
    }
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <LayoutGrid size={16} color={colors.textSubtle} />
        <Text style={styles.title}>ウィジェットの配色</Text>
      </View>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {OPTIONS.map((option) => {
          const selected = option.mode === mode;
          return (
            <Pressable
              key={option.mode}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => void select(option.mode)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.note}>ホーム画面のウィジェットだけの配色です。この端末だけの設定で、アプリの画面は変わりません。</Text>
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.borderStrongSoft,
    borderRadius: 10,
    padding: 3,
    gap: 3,
  },
  option: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  optionSelected: { backgroundColor: colors.surface },
  optionText: { fontSize: 14, fontWeight: '500', color: colors.textMuted },
  optionTextSelected: { fontWeight: '700', color: colors.navActiveText },
  note: { fontSize: 12, fontWeight: '400', color: colors.textFaint, lineHeight: 18 },
  error: { fontSize: 12, fontWeight: '400', color: colors.danger },
});
