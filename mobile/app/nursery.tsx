import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import NurseryPanel from '@/components/care/NurseryPanel';

// 保活（見学チェック）の画面。設定タブの「保活」から開く（以前は育児タブの切り替え）。
// 戻る操作（端末の戻るボタン・左上の矢印）で設定タブへ戻る。

export default function NurseryScreen() {
  const { session, isLoading } = useSession();
  if (isLoading) return <SafeAreaView style={styles.screen} />;
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeft size={24} color={colors.navActive} />
        </Pressable>
        <Text style={styles.title}>保活</Text>
      </View>
      <NurseryPanel />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingTop: 8 },
  back: { padding: 4 },
  title: { fontSize: 17, fontWeight: '700', color: colors.text },
});
