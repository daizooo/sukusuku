import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { handleNotificationAction } from '@/lib/notificationActions';

// アプリが裏にいる・閉じている間に、お知らせのボタン（完了・記録）が押されたときの処理。
//
// expo-task-manager がアプリのJSを裏で読み込んで、ここで定めた処理を動かす。
// 読み込まれるのはアプリの入口（mobile/index.ts）なので、定めるのも入口から読む
// このファイルのいちばん外側でなければならない（画面の中で定めると、閉じている間は動かない）。
//
// ボタンの押下のほか、データだけのお知らせが届いたときにも呼ばれるが、そちらは何もしない
// （お知らせは expo-notifications が出す）。

const NOTIFICATION_ACTION_TASK = 'sukusuku-notification-action';

if (Platform.OS === 'android') {
  TaskManager.defineTask<Notifications.NotificationTaskPayload>(
    NOTIFICATION_ACTION_TASK,
    async ({ data, error }) => {
      if (error || !data || !('actionIdentifier' in data)) return;
      try {
        await handleNotificationAction(data);
      } catch (err) {
        console.error('Failed to handle notification action:', err);
      }
    },
  );
  Notifications.registerTaskAsync(NOTIFICATION_ACTION_TASK).catch((err: unknown) =>
    console.error('Failed to register notification action task:', err),
  );
}
