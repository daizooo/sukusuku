import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';

// 予定・次の授乳の目安・検温・備蓄の期限のお知らせを、この端末で受け取るための層。
//
// PWA版はブラウザのWeb Push購読（src/lib/push.ts）だが、ネイティブ版はService Workerを
// 持たないのでFCMの登録トークンで受け取る。宛先は同じ push_subscriptions に
// kind = 'fcm' の行として入る（supabase/migrations/0037）。
//
// 送るのはこれまでどおりEdge Functionで、通知の文面もそちらが作る。
// **PWA版とネイティブ版で同じ文面が出るのはそのためである**（ルートの CLAUDE.md）。
//
// 授乳の計測中のお知らせ（区切りが5分に達したら鳴らすもの）はここではなく前面サービスの
// 担当で、サーバーを通らない（src/lib/nursingAlarm.ts）。ここで扱うのは
// 「時刻が来たことをサーバーが知らせるもの」だけ。

/** 宛先の種類。push_subscriptions.kind に入る値。 */
export const PUSH_KIND = 'fcm';

/** endpoint に付ける接頭辞。トークンだけではWeb PushのURLと見分けが付かないため。 */
const ENDPOINT_PREFIX = 'fcm:';

/** 登録トークンから、push_subscriptions.endpoint に入れる値を作る。 */
export const toPushEndpoint = (token: string): string => `${ENDPOINT_PREFIX}${token}`;

/**
 * お知らせの種類ごとの通知チャンネル。
 *
 * Androidは鳴り方・振動をチャンネルに固定するので、種類ごとに分けておく
 * （PWA版は通知1つずつに vibrate を付けられるが、ネイティブではここで決まる）。
 * idは送る側（supabase/functions/_shared/deliver.ts の channelOf）と合わせること。
 */
const CHANNELS: {
  id: string;
  name: string;
  description: string;
  vibrationPattern?: number[];
}[] = [
  {
    id: 'task-reminder',
    name: '予定のリマインダー',
    description: '予定に設定した時刻に届きます。',
  },
  {
    id: 'feeding-reminder',
    name: '次の授乳の目安',
    description: '前回の授乳から設定した間隔が経ったときに届きます。',
    // 寝ていても気づけるように振動させる。PWA版の feeding/temperature と同じ形
    // （授乳の計測中のお知らせの長短のパターンとは別物の、素直な2回の振動）。
    vibrationPattern: [0, 400, 200, 400],
  },
  {
    id: 'temperature-reminder',
    name: '検温のお知らせ',
    description: '設定した朝・夕の時刻に届きます。',
    vibrationPattern: [0, 400, 200, 400],
  },
  {
    id: 'stock-expiry',
    name: '備蓄の期限',
    description: '備蓄の期限の3か月前・1か月前に、朝まとめて届きます。',
  },
];

/**
 * 通知チャンネルを用意する。
 *
 * チャンネルは作ったあと名前と説明しか変えられない（Androidの決まり）。
 * 起動のたびに呼んでよく、既にあれば作り直されない。
 */
export async function configureNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    CHANNELS.map((channel) =>
      Notifications.setNotificationChannelAsync(channel.id, {
        name: channel.name,
        description: channel.description,
        // 画面の上に出して気づけるようにする。時刻を知らせるものなので、
        // 通知バーに静かに積まれるだけでは用が足りない。
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: channel.vibrationPattern,
      }),
    ),
  );
}

/**
 * この環境で受け取れるか。受け取れない理由があればその文言を返す（PWA版と同じ考え方で、
 * 設定タブにそのまま出す）。
 *
 * Expo Goにはこのアプリ用のFCMの設定が入っていないため、開発ビルド・`.apk` でしか
 * 受け取れない。授乳の計測中のお知らせ（前面サービス）と同じ制約。
 */
export function pushUnavailableReason(): string | null {
  if (Platform.OS !== 'android') {
    return 'この端末では通知を受け取れません。';
  }
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return 'Expo Goでは通知を受け取れません。`.apk` を入れたアプリで設定してください。';
  }
  return null;
}

/** いま通知を出す許可があるか。 */
export async function hasNotificationPermission(): Promise<boolean> {
  const { granted } = await Notifications.getPermissionsAsync();
  return granted;
}

/**
 * この端末のFCMの登録トークンを取る。許可が無ければもらってから取る。
 * 許可されなかった場合は null。
 */
export async function registerForPush(): Promise<string | null> {
  const { granted, canAskAgain } = await Notifications.getPermissionsAsync();
  if (!granted) {
    if (!canAskAgain) return null;
    const requested = await Notifications.requestPermissionsAsync();
    if (!requested.granted) return null;
  }
  await configureNotificationChannels();
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === 'string' ? token.data : null;
}

/**
 * この端末の登録トークン。まだ許可をもらっていなければ null（聞き直さない）。
 * 設定タブが「いまオンかどうか」を見るときに使う。
 *
 * 受け取れない環境では取りに行かない。Expo GoにはFirebaseの設定が入らないため、
 * 取りに行くと必ず失敗する（`FirebaseMessaging.getInstance()` が投げる）。
 */
export async function getPushTokenIfAllowed(): Promise<string | null> {
  if (pushUnavailableReason()) return null;
  if (!(await hasNotificationPermission())) return null;
  const token = await Notifications.getDevicePushTokenAsync();
  return typeof token.data === 'string' ? token.data : null;
}

/**
 * 端末側の登録を解く。オフにしたあともFCMがトークンを送り続けないようにする
 * （PWA版の `subscription.unsubscribe()` にあたる）。
 */
export async function unregisterFromPush(): Promise<void> {
  await Notifications.unregisterForNotificationsAsync();
}
