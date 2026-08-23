// すくすく手帳のService Worker
//
// 役割は1つ。
// 予定のリマインダー: Edge Function `send-reminders` から送られたWeb Pushを受け取り、通知を出す。

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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  );

  // 通知のタップはアプリを前面に出す。
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
