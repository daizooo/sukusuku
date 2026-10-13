import { useCallback, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ClipboardCheck } from 'lucide-react-native';
import { readHokatsuVisible, writeHokatsuVisible } from '@/lib/hokatsuVisibility';
import { colors } from '@/lib/theme';

// 保活（見学チェック）の入口をその他タブに出すかどうかの切り替え。保活は見学のときしか
// 開かないので、見学が済んだら「表示する」を切って入口を隠せる。保活の画面への入口そのものは
// その他タブの「保活」の行（app/(tabs)/info.tsx）。

export default function HokatsuSetting() {
  const [visible, setVisible] = useState(true);

  // 開くたびに読み直す。
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      void readHokatsuVisible().then((value) => {
        if (isActive) setVisible(value);
      });
      return () => {
        isActive = false;
      };
    }, []),
  );

  const toggle = (next: boolean) => {
    setVisible(next);
    void writeHokatsuVisible(next);
  };

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <ClipboardCheck size={16} color={colors.textSubtle} />
        <Text style={styles.sectionTitle}>保活</Text>
        <Text style={styles.switchLabel}>表示する</Text>
        <Switch
          accessibilityLabel="保活を表示"
          value={visible}
          onValueChange={toggle}
          trackColor={{ true: colors.navActive }}
        />
      </View>

      <Text style={styles.hint}>
        見学が済んだら切ると、その他タブから保活の行が消えます。
      </Text>
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
  sectionTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: colors.text },
  switchLabel: { fontSize: 12, fontWeight: '500', color: colors.textMuted },
  hint: { fontSize: 12, fontWeight: '400', color: colors.textMuted },
});
