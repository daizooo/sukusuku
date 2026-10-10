import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ChevronRight, ClipboardCheck } from 'lucide-react-native';
import { readHokatsuVisible, writeHokatsuVisible } from '@/lib/hokatsuVisibility';
import { colors } from '@/lib/theme';

// 保活（見学チェック）の入口。以前は育児タブの切り替えにあったが、見学のときしか
// 開かないので設定タブへ移した。見学が済んだら「保活を表示」を切って入口を隠せる。

export default function HokatsuSetting() {
  const [visible, setVisible] = useState(true);

  // 開くたびに読み直す（保活の画面から戻ってきたときも）。
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

      {visible && (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/nursery')}
          style={styles.row}
        >
          <Text style={styles.rowText}>見学チェックリストを開く</Text>
          <ChevronRight size={18} color={colors.textFaint} />
        </Pressable>
      )}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  rowText: { fontSize: 14, fontWeight: '700', color: colors.navActiveText },
});
