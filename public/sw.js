// かぞく手帳のService Worker（自分で登録を外すだけの空のもの）
//
// 以前はここでWeb Pushを受けて通知を出していたが、Web版（PWA）の通知は撤去した
// （docs/notifications.md §11）。ただ、すでにこのService Workerを登録した端末（開発確認用の
// ブラウザなど）には古い版が残っている。ファイルごと消すと、そうした端末が更新を取りに来て
// 失敗するだけで古い版が残り続けるため、入れ替わったら自分で登録を外す版を置いておく。
// 新しくService Workerを登録するコードはもう無いので、行き渡ったあとは消してよい。

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.registration.unregister());
});
