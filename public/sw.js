// すくすく手帳のService Worker
//
// 役割は3つ。
// 1. 予定のリマインダー: Edge Function `send-reminders` から送られたWeb Pushを受け取り、通知を出す。
// 2. 授乳の経過時間お知らせ: Edge Function `send-nursing-alarms` から送られたWeb Pushを受け取る。
//    画面が消えている・アプリを閉じている間は端末内のタイマーが間引かれて鳴らせないため、
//    その分をここで鳴らす。
// 3. 次の授乳の目安: Edge Function `send-feeding-reminders` から送られたWeb Pushを受け取る。
//    前回の授乳から一定の間隔が経ったことを知らせる（2とは別物）。

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

// 授乳のお知らせの振動パターン。長い振動=30分、短い振動=5分。
// 数え方と時間の対応は src/lib/alarm.ts と揃えること
// (sw.jsはビルドを通さない静的ファイルなので、同じ規則をここにも置いている)。
const LONG_UNIT_MINUTES = 30;
const SHORT_UNIT_MINUTES = 5;

function buildNursingVibration(minutes) {
  const long = Math.floor(minutes / LONG_UNIT_MINUTES);
  const short = Math.round((minutes - long * LONG_UNIT_MINUTES) / SHORT_UNIT_MINUTES);
  const sequence = [];
  for (let i = 0; i < long; i += 1) sequence.push(700, 250);
  // 長い振動と短い振動の境目は長めに空けて、感じ分けやすくする
  if (long > 0 && short > 0) sequence[sequence.length - 1] = 600;
  for (let i = 0; i < short; i += 1) sequence.push(250, 200);
  sequence.pop(); // 末尾の停止時間は不要
  return sequence;
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    // 想定外の本文が来ても通知自体は出す
    payload = {};
  }

  const isNursing = payload.kind === 'nursing';
  const isFeeding = payload.kind === 'feeding';
  const title = payload.title || 'すくすく手帳';
  const options = {
    body: payload.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    lang: 'ja',
    // 同じ予定の通知が重なったら新しいものへ差し替える
    tag: isNursing
      ? 'nursing-alarm'
      : isFeeding
        ? 'feeding-reminder'
        : payload.taskId
          ? `task-${payload.taskId}`
          : 'sukusuku',
    data: { url: payload.url || '/' },
  };

  if (isFeeding) {
    // 前の目安の通知が残ったままでも、新しいものに気づけるよう鳴らし直す。
    options.renotify = true;
    // 寝ていても気づけるように振動させる。授乳の経過時間お知らせ(長短のパターン)とは
    // 別物なので、数え方を持たない素直な2回の振動にしておく。
    options.vibrate = [400, 200, 400];
  }

  if (isNursing) {
    // お知らせは次々に届くので、古いものを積み上げず差し替える。
    // ただし差し替えでも毎回気づけるよう鳴らし直す。
    options.renotify = true;
    // Androidはここで長短のパターンを指定できるので、
    // 画面を見なくても鳴り方だけで経過時間が分かる形を保てる。
    // (iOSは指定を無視して既定の振動になる)
    options.vibrate = buildNursingVibration(payload.minutes || 0);
  }

  event.waitUntil(
    (async () => {
      // アプリ側が持っている「何回目まで鳴らしたか」を進めておく。
      // これをしないと、裏に回っている間にここで鳴らした分を、
      // アプリに戻ってきたときにもう一度鳴らしてしまう。
      if (isNursing && typeof payload.step === 'number') {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const client of windows) {
          client.postMessage({
            type: 'nursing-alarm-notified',
            step: payload.step,
            side: payload.side,
          });
        }
      }
      await self.registration.showNotification(title, options);
    })(),
  );
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
