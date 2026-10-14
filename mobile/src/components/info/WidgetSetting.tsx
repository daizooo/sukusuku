import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { EyeOff } from 'lucide-react-native';
import { colors } from '@/lib/theme';
import { widgetsAvailable } from '@/widgets/availability';
import { readWidgetHideAmounts, writeWidgetHideAmounts } from '@/widgets/widgetData';
import { refreshWidgets } from '@/widgets/refreshWidgets';

// ホーム画面のウィジェットの設定（docs/widgets.md §2.3）。
// ネイティブ版（Androidの `.apk`）だけの機能で、Web版・Expo Go には出さない。
// **この端末だけの設定**。ホーム画面は人に見られやすいので、家計の金額を出すかを端末ごとに選ぶ。

export default function WidgetSetting() {
  const [hideAmounts, setHideAmounts] = useState<boolean | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!widgetsAvailable) return;
    void readWidgetHideAmounts().then(setHideAmounts);
  }, []);

  if (!widgetsAvailable || hideAmounts === null) return null;

  const toggle = async (value: boolean) => {
    setError(false);
    setHideAmounts(value);
    try {
      await writeWidgetHideAmounts(value);
      await refreshWidgets();
    } catch {
      setHideAmounts(!value);
      setError(true);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>ホーム画面のウィジェット</Text>
      <View style={styles.row}>
        <EyeOff size={16} color={colors.money} />
        <Text style={styles.label}>家計のウィジェットで金額を隠す</Text>
        <Switch
          accessibilityLabel="家計のウィジェットで金額を隠す"
          value={hideAmounts}
          onValueChange={(value) => void toggle(value)}
          trackColor={{ true: colors.navActive, false: colors.borderStrong }}
          thumbColor={colors.surface}
        />
      </View>
      <Text style={styles.note}>
        この端末だけの設定です。隠すと、今月・今日の支出を出さずにボタンだけになります。ウィジェットはホーム画面を長押しして「ウィジェット」から置けます。
      </Text>
      {error && <Text style={styles.error}>設定を保存できませんでした。もう一度お試しください。</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  // 設定の画面の枠（NotificationSetting と同じ形）。
  section: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    gap: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.text },
  note: { fontSize: 12, fontWeight: '400', color: colors.textFaint, lineHeight: 18 },
  error: { fontSize: 12, fontWeight: '400', color: colors.danger },
});
