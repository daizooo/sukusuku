import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, FileText } from 'lucide-react-native';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';

/**
 * 契約の画面（賃貸・保険など）。その他タブの「契約」の行から開く。
 * いまは入口だけで、中身（項目・更新日の知らせ）はこれから作る（docs/family-app.md §4.5）。
 * Web版は `src/components/sukusuku/tabs/ContractsScreen.tsx`。
 */
export default function ContractsScreen() {
  const { session, isLoading } = useSession();
  if (isLoading) return <SafeAreaView style={styles.screen} />;
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/info'))}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeft size={22} color={colors.textMuted} />
          <FileText size={20} color={colors.contract} />
          <Text style={styles.title}>契約</Text>
        </Pressable>
      </View>
      <View style={styles.empty}>
        <FileText size={32} color={colors.textFaint} />
        <Text style={styles.emptyTitle}>準備中です</Text>
        <Text style={styles.emptyBody}>賃貸や保険などの契約を、更新日の知らせつきで控えられるようにします。</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: colors.textSubtle },
  emptyBody: { fontSize: 13, fontWeight: '400', color: colors.textMuted, textAlign: 'center' },
});
