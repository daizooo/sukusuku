// すくすく手帳のService Worker
//
// 役割は2つ。
// 1. 予定のリマインダー: Edge Function `send-reminders` から送られたWeb Pushを受け取り、通知を出す。
// 2. ねんね計測: 計測中であることを通知欄に出し、通知の「起きた」から起床時刻を受け取る。
//    アプリが開いていれば postMessage で即座に渡し、閉じていれば Cache Storage に控えて
//    次にアプリを開いたときに拾わせる（Service Workerからは localStorage を触れないため）。

const WAKE_CACHE = 'sukusuku-sleep';
const WAKE_URL = '/__sukusuku_sleep_wake';
const WAKE_MESSAGE = 'sukusuku:sleep-wake';

// 更新したService Workerを次回の読み込みからすぐ有効にする。
// 通知の見た目や遷移先を直したときに、古いものが残り続けないようにするため。
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// fetchハンドラを持たないService WorkerはPWAとしてインストール可能と判定されない
// ブラウザがあるため、何もしないハンドラだけ置いておく。
// respondWith()を呼ばないので通信は通常どおりネットワークへ流れる。
self.addEventListener('fetch', () => {});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // 想定外の本文が来ても通知自体は出す
    payload = {};
  }

  const title = payload.title || 'すくすく手帳';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'ja',
    // 同じ予定の通知が重なったら新しいものへ差し替える
    tag: payload.taskId ? `task-${payload.taskId}` : 'sukusuku',
    data: { url: payload.url || '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'wake') {
    // 通知のボタンから終了した場合はアプリを開かずに完結させる。
    event.waitUntil(recordWake(Date.now()));
    return;
  }

  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  );

  // 通知本体のタップ（ボタンに対応していない端末を含む）はアプリを前面に出す。
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });

      for (const client of windows) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ('navigate' in client) await client.navigate(targetUrl.href);
        return;
      }

      await self.clients.openWindow(targetUrl.href);
    })(),
  );
});
