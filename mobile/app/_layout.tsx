import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { SessionProvider, useSession } from '@/lib/session';
import { FamilySyncProvider } from '@/lib/familySync';
import { useNursingAlarmWatcher } from '@/lib/nursingTimer';
import { useNursingStateSync } from '@/lib/nursingState';
import { useSettledNotificationCleanup } from '@/lib/notificationCleanup';
import { useWakeAlarmSync } from '@/lib/wakeAlarm';
import { configureNotificationChannels } from '@/lib/push';
import { notificationTarget, OPEN_LOG_PARAM } from '@/lib/appLinks';
import {
  configureNotificationCategories,
  handleNotificationAction,
  presentActionableNotification,
} from '@/lib/notificationActions';
import { colors } from '@/lib/theme';
import { useWidgetRefresh } from '@/widgets/useWidgetRefresh';

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
        {/* 他の端末での変更を各画面へ届ける（src/lib/familySync.tsx）。画面より外側に1つだけ置く。 */}
        <FamilySyncProvider>
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </FamilySyncProvider>
        <StatusBarBand />
        <AppEffects />
      </SessionProvider>
    </SafeAreaProvider>
  );
}

/**
 * 画面の一番上（時計や電池が出ている帯）をアプリの色で塗る。
 *
 * PWA版はmanifestの theme_color でここが同じ色になる。塗らないと地の灰色のままで、
 * 2つを行き来したときに別のアプリに見えるため、同じ形にそろえる。
 * どの画面の上にも出したいので、タブではなくアプリの一番外側に置く。
 */
function StatusBarBand() {
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: insets.top,
        backgroundColor: colors.brand,
      }}
    />
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
  // 夜間の起床アラームの予約を、いまの授乳の目安に合わせて組み直す（Androidのネイティブ版だけ）。
  useWakeAlarmSync(session?.user.id ?? null);
  // ホーム画面のウィジェットを、アプリを閉じるたびに描き直す（docs/widgets.md §3.3）。
  useWidgetRefresh();

  return null;
}

/**
 * お知らせをタップしたときに、その用件の画面へ移る。
 * 飛び先の決まりごとは mobile/src/lib/appLinks.ts の notificationTarget。
 */
function useNotificationTapHandler(): void {
  useEffect(() => {
    // 鳴り方・振動はチャンネルに固定されるので、起動のたびに用意しておく
    // （既にあれば作り直されない）。通知をオンにする前に届くことはないが、
    // オンにした端末では入れ替え後の起動でも必ずそろっている状態にする。
    void configureNotificationChannels();
    // お知らせの上のボタン（タスクの完了）も、閉じている間に届く分に付くよう先に登録する。
    void configureNotificationCategories().catch((err: unknown) =>
      console.error('Failed to configure notification categories:', err),
    );

    // ボタン付きのお知らせは、開いている間はアプリが自分で出す（src/lib/notificationActions.ts）。
    const received = Notifications.addNotificationReceivedListener((notification) => {
      void presentActionableNotification(notification).catch((err: unknown) =>
        console.error('Failed to present actionable notification:', err),
      );
    });

    // ボタンの押下は画面を移さずにその場で済ませる。タップ（既定の操作）だけ画面を開く。
    const isTap = (response: Notifications.NotificationResponse) =>
      response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;

    const open = (data: Record<string, unknown> | undefined) => {
      const target = notificationTarget(data?.kind);
      // タブのパスはグループ名を含まない（`/care` など。app/index.tsx と同じ形）。
      router.navigate({
        pathname: `/${target.tab}`,
        params: target.openLog ? { [OPEN_LOG_PARAM]: target.openLog } : {},
      });
    };

    // 通知から起動した場合（アプリが動いていなかった）。入口(app/index.tsx)も同じ
    // 飛び先へ移すが、入口が移し終えるのを待ってからもう一度動かす。同じ回で移そうとすると
    // そちらに上書きされて、タップした用件の画面が開かない。
    const last = Notifications.getLastNotificationResponse();
    const timer = last && isTap(last)
      ? setTimeout(() => {
          open(last.notification.request.content.data);
          // 次の起動で同じお知らせをもう一度開かないようにする。
          Notifications.clearLastNotificationResponse();
        }, 0)
      : null;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (isTap(response)) {
        open(response.notification.request.content.data);
        return;
      }
      // 裏の処理（notificationActionTask.ts）が済ませた押下も届くが、二重には行わない。
      void handleNotificationAction(response).catch((err: unknown) =>
        console.error('Failed to handle notification action:', err),
      );
    });
    return () => {
      if (timer !== null) clearTimeout(timer);
      received.remove();
      subscription.remove();
    };
  }, []);
}
