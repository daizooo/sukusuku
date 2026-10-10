import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Ticket } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import LotteryPanel from '@/components/living/LotteryPanel';

/**
 * 福引チャンスの画面（docs/home.md §9）。家計タブの帯の右端のチケットから開く
 * （以前は暮らしタブのメニュー。2026-10-10に暮らしタブを廃止）。戻る操作（端末の戻るボタン・左上の矢印）で
 * 前の画面（家計タブ）へ戻る。Web版の `src/components/sukusuku/tabs/LotteryScreen.tsx` と同じ項目・並び・文言。
 */

export default function LotteryScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;
  const [familyId, setFamilyId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    getMyMembership(supabase, userId)
      .then((membership) => {
        if (isMounted) setFamilyId(membership.familyId);
      })
      .catch(() => {
        // 圏外でも画面は出す。家族が分からないうちは、くじは引けない。
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  if (isSessionLoading) {
    return (
      <SafeAreaView style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.navActive} />
      </SafeAreaView>
    );
  }
  if (!session) return <Redirect href="/login" />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="戻る"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/money'))}
          hitSlop={8}
          style={styles.back}
        >
          <ChevronLeft size={22} color={colors.textMuted} />
          <Ticket size={20} color={colors.livingLottery} />
          <Text style={styles.title}>福引チャンス</Text>
        </Pressable>
      </View>
      <LotteryPanel familyId={familyId} userId={session.user.id} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  back: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
