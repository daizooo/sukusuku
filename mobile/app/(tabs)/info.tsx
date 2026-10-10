import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text } from 'react-native';
import { Redirect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { getMyMembership } from '@/lib/api/me';
import { useFamilyRefresh } from '@/lib/familySync';
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
import WakeAlarmSetting from '@/components/info/WakeAlarmSetting';
import HokatsuSetting from '@/components/info/HokatsuSetting';
import TemperatureReminderSetting from '@/components/info/TemperatureReminderSetting';
import VersionInfo from '@/components/info/VersionInfo';

// 設定タブ。家族・通知・アカウント・アプリ情報に絞る（docs/family-app.md §4.3）。
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

  // 相手の端末で変わった授乳の間隔・検温のお知らせの設定に追いつかせる。読み込み中の表示には戻さず、届いたら差し替える。
  useFamilyRefresh(['feeding_settings', 'temperature_reminder_settings'], () => {
    if (!familyId) return;
    void Promise.all([
      getFeedingSettings(supabase, familyId),
      getTemperatureReminderSettings(supabase, familyId),
    ])
      .then(([feeding, temperature]) => {
        setFeedingSettings(feeding);
        setTemperatureReminderSettings(temperature);
      })
      .catch(() => {
        // 圏外なら前に読んだ分を出したままにする。
      });
  });

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
              {/* 夜の授乳の起床アラーム。この端末だけの設定で、Androidのネイティブ版だけに出る。 */}
              <WakeAlarmSetting />
            </NotificationSetting>

            {/* 保活（見学チェック）。見学のときしか開かないので、育児タブから移した。 */}
            <HokatsuSetting />

            <AccountSection familyId={familyId} userId={session.user.id} />
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
  content: { paddingHorizontal: 16, paddingTop: 12, gap: 12, paddingBottom: 24 },
  message: { fontSize: 14, fontWeight: '400', color: colors.textFaint, textAlign: 'center' },
});
