import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ClipboardCheck, FileText, Settings } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { readHokatsuVisible } from '@/lib/hokatsuVisibility';
import MoreRow from '@/components/more/MoreRow';
import LotteryMoreRow from '@/components/more/LotteryMoreRow';
import StockMoreRow from '@/components/more/StockMoreRow';
import VersionInfo from '@/components/info/VersionInfo';

// その他タブ（docs/family-app.md §4.5）。以前の設定タブ。毎日は開かないものの入口を、上から
// 福引チャンス・契約・防災備蓄・保活・設定の順に並べる。中身は、それぞれ別の画面で開く。
//   - 福引チャンス: 以前は家計タブの＋ボタンの中（app/lottery.tsx）
//   - 契約: 賃貸・保険などの控え（app/contracts.tsx。いまは入口だけ）
//   - 防災備蓄: 以前はリストタブの下（app/stock.tsx）
//   - 保活: 以前は設定タブの中（app/nursery.tsx）。見学が済んだら、設定で行ごと隠せる
//   - 設定: 以前の設定タブの中身（app/settings.tsx）
// Web版は `src/components/sukusuku/tabs/InfoTab.tsx`。
//
// 設定タブだった流れで、画面全体がスクロールしてよい（ルートの CLAUDE.md の「画面の作り方」の例外）。

export default function InfoScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [hokatsuVisible, setHokatsuVisible] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    getMyMembership(supabase, userId)
      .then((membership) => {
        if (isMounted) setFamilyId(membership.familyId);
      })
      .catch(() => {
        // 圏外でも画面は出す。家族が分からないうちは、件数のバッジが出ないだけ。
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  // 開くたびに読み直す（設定で保活の表示を切り替えて戻ってきたときも）。
  useFocusEffect(
    useCallback(() => {
      let isActive = true;
      void readHokatsuVisible().then((value) => {
        if (isActive) setHokatsuVisible(value);
      });
      return () => {
        isActive = false;
      };
    }, []),
  );

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
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>その他</Text>

        <View style={styles.group}>
          <LotteryMoreRow familyId={familyId} userId={session.user.id} />
          <View style={styles.divider} />
          <MoreRow
            icon={<FileText size={20} color={colors.contract} />}
            tintSurface={colors.contractSurface}
            title="契約"
            description="賃貸・保険など"
            badge="準備中"
            onPress={() => router.push('/contracts')}
          />
          <View style={styles.divider} />
          <StockMoreRow familyId={familyId} />
          {hokatsuVisible && (
            <>
              <View style={styles.divider} />
              <MoreRow
                icon={<ClipboardCheck size={20} color={colors.primary} />}
                tintSurface={colors.accentSurface}
                title="保活"
                description="見学チェックリスト"
                onPress={() => router.push('/nursery')}
              />
            </>
          )}
          <View style={styles.divider} />
          <MoreRow
            icon={<Settings size={20} color={colors.textSubtle} />}
            tintSurface={colors.neutralSurface}
            title="設定"
            description="家族・通知・授乳の目安・アカウント"
            onPress={() => router.push('/settings')}
          />
        </View>

        <VersionInfo />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12, paddingBottom: 24 },
  title: { fontSize: 21, fontWeight: '800', color: colors.text, paddingHorizontal: 2 },
  group: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  divider: { height: 1, backgroundColor: colors.border },
});
