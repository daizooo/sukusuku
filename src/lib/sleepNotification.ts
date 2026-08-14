// ねんね計測中の通知まわり。
// 通知の「起きた」ボタンはサービスワーカー経由でしか出せないため、
// public/sw.js を登録したうえで registration.showNotification を使う。
//
// 端末による差:
//   - Android / PC のブラウザ: 通知に「起きた」ボタンが出て、通知だけで終了できる。
//   - iOS: ホーム画面に追加した場合のみ通知が出せ、ボタンは表示されない。
//     その場合は通知タップでアプリが開くので、アプリ内のバーから終了する。
//   - 通知が使えない・許可されていない場合も、アプリ内のバーで通常どおり記録できる。

import { formatTimeString } from '@/lib/dateUtils';
import { registerServiceWorker } from '@/lib/push';

const NOTIFICATION_TAG = 'sukusuku-sleep';
const WAKE_CACHE = 'sukusuku-sleep';
const WAKE_URL = '/__sukusuku_sleep_wake';
const WAKE_MESSAGE = 'sukusuku:sleep-wake';

export const isSleepNotificationSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'Notification' in window &&
  'caches' in window;

export const sleepNotificationPermission = (): NotificationPermission | 'unsupported' =>
  isSleepNotificationSupported() ? Notification.permission : 'unsupported';

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

const getRegistration = (): Promise<ServiceWorkerRegistration | null> => {
  if (!isSleepNotificationSupported()) return Promise.resolve(null);
  if (!registrationPromise) {
    // 予定のリマインダーと同じService Workerを使う。
    registrationPromise = registerServiceWorker().catch((err) => {
      console.error('Failed to register service worker:', err);
      return null;
    });
  }
  return registrationPromise;
};

/** 初回の「ねんね開始」で一度だけ許可を確認する。断られても計測自体は続けられる。 */
export const requestSleepNotificationPermission = async (): Promise<boolean> => {
  if (!isSleepNotificationSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch (err) {
    console.error('Failed to request notification permission:', err);
    return false;
  }
};

/**
 * 計測中であることを通知欄に出す。
 * 経過時間は端末側で更新できないため、本文には開始時刻だけを載せる。
 */
export const showSleepNotification = async (startedAt: Date): Promise<void> => {
  if (!isSleepNotificationSupported() || Notification.permission !== 'granted') return;
  const registration = await getRegistration();
  if (!registration) return;

  try {
    await registration.showNotification('ねんね中', {
      body: `${formatTimeString(startedAt)} から計測しています`,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'ja',
      tag: NOTIFICATION_TAG,
      // 起床まで通知欄に残す。対応していない端末では通知センターに残る。
      requireInteraction: true,
      silent: true,
      actions: [{ action: 'wake', title: '起きた' }],
    } as NotificationOptions);
  } catch (err) {
    console.error('Failed to show sleep notification:', err);
  }
};

export const clearSleepNotification = async (): Promise<void> => {
  if (!isSleepNotificationSupported()) return;
  const registration = await getRegistration();
  if (!registration) return;
  const notifications = await registration.getNotifications({ tag: NOTIFICATION_TAG });
  notifications.forEach((notification) => notification.close());
};

/**
 * アプリを閉じている間に通知から終了していた場合の起床時刻を取り出す。
 * 一度読んだら消す。
 */
export const takePendingWake = async (): Promise<Date | null> => {
  if (!isSleepNotificationSupported()) return null;
  try {
    const cache = await caches.open(WAKE_CACHE);
    const response = await cache.match(WAKE_URL);
    if (!response) return null;
    const { endedAt } = (await response.json()) as { endedAt: number };
    await cache.delete(WAKE_URL);
    return Number.isFinite(endedAt) ? new Date(endedAt) : null;
  } catch (err) {
    console.error('Failed to read pending wake:', err);
    return null;
  }
};

/** 控えてある起床時刻を破棄する。アプリ側で先に終了させた場合に古い値を残さないため。 */
export const clearPendingWake = async (): Promise<void> => {
  if (!isSleepNotificationSupported()) return;
  try {
    const cache = await caches.open(WAKE_CACHE);
    await cache.delete(WAKE_URL);
  } catch (err) {
    console.error('Failed to clear pending wake:', err);
  }
};

/** アプリが開いたまま通知から終了された場合に呼ばれる。 */
export const subscribeToWake = (onWake: (endedAt: Date) => void): (() => void) => {
  if (!isSleepNotificationSupported()) return () => {};

  const handler = (event: MessageEvent) => {
    const data = event.data as { type?: string; endedAt?: number } | undefined;
    if (data?.type !== WAKE_MESSAGE || !Number.isFinite(data.endedAt)) return;
    onWake(new Date(data.endedAt as number));
  };

  navigator.serviceWorker.addEventListener('message', handler);
  return () => navigator.serviceWorker.removeEventListener('message', handler);
};
