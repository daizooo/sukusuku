import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import {
  DEFAULT_FEEDING_SETTINGS,
  getFeedingSettings,
  type FeedingSettings,
} from '@/lib/api/feedingSettings';
import {
  DEFAULT_TEMPERATURE_REMINDER_SETTINGS,
  getTemperatureReminderSettings,
  type TemperatureReminderSettings,
} from '@/lib/api/temperatureReminderSettings';
import AccountSection from '@/components/info/AccountSection';
import FamilySection from '@/components/info/FamilySection';
import NotificationSetting from '@/components/info/NotificationSetting';
import FeedingIntervalSetting from '@/components/info/FeedingIntervalSetting';
import TemperatureReminderSetting from '@/components/info/TemperatureReminderSetting';
import VersionInfo from '@/components/info/VersionInfo';

// 設定タブ。アカウント・家族・通知・アプリ情報に絞る（docs/family-app.md §4.3）。
// 以前の自由入力（お子様の情報・パパママ情報・緊急連絡先・カスタム項目）は
// 「家族」（family_members・families）に置き換えた。
// Web版は `src/components/sukusuku/tabs/InfoTab.tsx`。
//
// 設定タブは画面全体がスクロールしてよい（ルートの CLAUDE.md の「画面の作り方」の例外）。

export default function InfoScreen() {
  const { session, isLoading: isSessionLoading } = useSession();
  const userId = session?.user.id ?? null;

  const [familyId, setFamilyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedingSettings, setFeedingSettings] = useState<FeedingSettings>(DEFAULT_FEEDING_SETTINGS);
  const [temperatureReminderSettings, setTemperatureReminderSettings] =
    useState<TemperatureReminderSettings>(DEFAULT_TEMPERATURE_REMINDER_SETTINGS);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    void (async () => {
      try {
        const membership = await getMyMembership(supabase, userId);
        if (!isMounted || !membership.familyId) return;
        setFamilyId(membership.familyId);
        const [feeding, temperature] = await Promise.all([
          getFeedingSettings(supabase, membership.familyId),
          getTemperatureReminderSettings(supabase, membership.familyId),
        ]);
        if (!isMounted) return;
        setFeedingSettings(feeding);
        setTemperatureReminderSettings(temperature);
      } catch {
        // 圏外でも画面は出す。出せるところまで出して、残りは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
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
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {isLoading && <Text style={styles.message}>読み込み中...</Text>}

        {familyId && (
          <>
            <AccountSection familyId={familyId} userId={session.user.id} />

            <FamilySection familyId={familyId} userId={session.user.id} />

            {/* 通知。授乳の目安・検温のお知らせも同じ枠にまとめる（docs/family-app.md §7-5） */}
            <NotificationSetting familyId={familyId} userId={session.user.id}>
              <FeedingIntervalSetting
                familyId={familyId}
                settings={feedingSettings}
                onChange={setFeedingSettings}
              />
              <TemperatureReminderSetting
                familyId={familyId}
                settings={temperatureReminderSettings}
                onChange={setTemperatureReminderSettings}
              />
            </NotificationSetting>
          </>
        )}

        <VersionInfo />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 24, paddingBottom: 32 },
  message: { fontSize: 14, fontWeight: '400', color: colors.textFaint, textAlign: 'center' },
});
