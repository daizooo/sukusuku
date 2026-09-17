import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';

// まだこちらに作っていないタブの中身。
//
// PWA版には全部そろっているので、作り終えるまでは「どこで見るか」だけを出す。
// タブそのものを隠さないのは、PWA版と並びを揃えておくため（ルートの CLAUDE.md）。

export default function PendingTab({ title, note }: { title: string; note: string }) {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.note}>{note}</Text>
        <Text style={styles.hint}>いまはPWA版で見てください。</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  note: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
  hint: { fontSize: 12, color: colors.textFaint, marginTop: 4 },
});
