import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { SessionProvider, useSession } from '@/lib/session';
import { useNursingAlarmWatcher } from '@/lib/nursingTimer';
import { useNursingStateSync } from '@/lib/nursingState';
import { useSettledNotificationCleanup } from '@/lib/notificationCleanup';
import { configureNotificationChannels } from '@/lib/push';
import { notificationTarget, OPEN_LOG_PARAM } from '@/lib/appLinks';
import { colors } from '@/lib/theme';

// アプリを開いている間に届いたお知らせも、そのまま画面の上に出す。
// PWA版はService Workerが必ず showNotification() するので、開いていても出る
// （Web版 public/sw.js）。同じ見え方にするために既定を上書きしている。
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
        <AppEffects />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * どの画面を開いていても要るものを、アプリの一番外側で1回だけ動かす。
 * セッションを使うものがあるので SessionProvider の内側に置く。
 */
function AppEffects() {
  const { session } = useSession();

  // 端末に控えた計測を読み戻し、前面サービスへ預け直す。
  useNursingAlarmWatcher();
  // 「いま授乳中」をサーバーへ預ける（「そろそろ次の授乳」を止めるため）。
  useNursingStateSync(session?.user.id ?? null);
  // お知らせのタップで、その用件の画面を開く。
  useNotificationTapHandler();
  // 用が済んだお知らせを端末から消す。
  useSettledNotificationCleanup(session?.user.id ?? null);

  return null;
}

/**
 * お知らせをタップしたときに、その用件の画面へ移る。
 * 飛び先の決まりごとは PWA版（public/sw.js の URL_BY_KIND）と同じ
 * （src/lib/appLinks.ts）。
 */
function useNotificationTapHandler(): void {
  useEffect(() => {
    // 鳴り方・振動はチャンネルに固定されるので、起動のたびに用意しておく
    // （既にあれば作り直されない）。通知をオンにする前に届くことはないが、
    // オンにした端末では入れ替え後の起動でも必ずそろっている状態にする。
    void configureNotificationChannels();

    const open = (data: Record<string, unknown> | undefined) => {
      const target = notificationTarget(data?.kind);
      // タブのパスはグループ名を含まない（app/index.tsx の `/home` と同じ形）。
      router.navigate({
        pathname: `/${target.tab}`,
        params: target.openLog ? { [OPEN_LOG_PARAM]: target.openLog } : {},
      });
    };

    // 通知から起動した場合（アプリが動いていなかった）。
    // 入口(app/index.tsx)がホームへ移すのを待ってから動かす。同じ回で移そうとすると
    // そちらに上書きされて、タップした用件の画面が開かない。
    const last = Notifications.getLastNotificationResponse();
    const timer = last
      ? setTimeout(() => {
          open(last.notification.request.content.data);
          // 次の起動で同じお知らせをもう一度開かないようにする。
          Notifications.clearLastNotificationResponse();
        }, 0)
      : null;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      open(response.notification.request.content.data);
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      subscription.remove();
    };
  }, []);
}
