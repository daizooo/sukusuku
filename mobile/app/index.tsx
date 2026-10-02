import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Redirect } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { colors } from '@/lib/theme';
import { notificationTarget, OPEN_LOG_PARAM } from '@/lib/appLinks';
import { getMyStartTab, START_TAB_ROUTE } from '@/lib/api/me';

// アプリを開いたときの入口。最初に開くタブは設定タブで1人ずつ選ぶ（users.start_tab。
// docs/family-app.md §3.4）。お知らせをタップして起動したときは、その用件の画面を開く
// （app/_layout.tsx の useNotificationTapHandler と同じ飛び先）。
export default function Index() {
  const { session, isLoading } = useSession();
  const userId = session?.user.id ?? null;
  const [startRoute, setStartRoute] = useState<string | null>(null);

  // 起動のもとになったお知らせ。読むのは最初の1回だけでよい。
  const [launchedFrom] = useState(() => Notifications.getLastNotificationResponse());

  useEffect(() => {
    if (!userId || launchedFrom) return;
    let cancelled = false;
    getMyStartTab(supabase, userId)
      .then((tab) => {
        if (!cancelled) setStartRoute(START_TAB_ROUTE[tab]);
      })
      .catch(() => {
        // 圏外でも開けるよう、読めなければ予定から始める。
        if (!cancelled) setStartRoute(START_TAB_ROUTE.schedule);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, launchedFrom]);

  if (!isLoading && !session) return <Redirect href="/login" />;

  if (launchedFrom) {
    const target = notificationTarget(launchedFrom.notification.request.content.data?.kind);
    return (
      <Redirect
        href={{
          pathname: `/${target.tab}`,
          params: target.openLog ? { [OPEN_LOG_PARAM]: target.openLog } : {},
        }}
      />
    );
  }

  if (!startRoute) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.navActive} />
      </View>
    );
  }
  return <Redirect href={startRoute} />;
}
