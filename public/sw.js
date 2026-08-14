// すくすく手帳のサービスワーカー。
// 用途はひとつだけ: ねんね計測中の通知を表示し、通知の「起きた」から起床時刻を受け取ること。
// アプリが開いていれば postMessage で即座に渡し、閉じていれば Cache Storage に控えて
// 次にアプリを開いたときに拾わせる（サービスワーカーからは localStorage を触れないため）。

const WAKE_CACHE = 'sukusuku-sleep';
const WAKE_URL = '/__sukusuku_sleep_wake';
const WAKE_MESSAGE = 'sukusuku:sleep-wake';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

async function recordWake(endedAt) {
  const cache = await caches.open(WAKE_CACHE);
  await cache.put(
    WAKE_URL,
    new Response(JSON.stringify({ endedAt }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  );

  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage({ type: WAKE_MESSAGE, endedAt });
  }
}

async function focusApp() {
  const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const existing = clientList.find((client) => 'focus' in client);
  if (existing) {
    await existing.focus();
    return;
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow('/');
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'wake') {
    // 通知のボタンから終了した場合はアプリを開かずに完結させる。
    event.waitUntil(recordWake(Date.now()));
    return;
  }

  // 通知本体のタップ（ボタンに対応していない端末を含む）はアプリを前面に出す。
  event.waitUntil(focusApp());
});
