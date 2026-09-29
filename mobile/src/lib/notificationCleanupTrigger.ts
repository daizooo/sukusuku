// 「お知らせを消してよいか見直して」という合図の受け渡し。
//
// 授乳や体温を記録した・計測を始めたのは、アプリを開いている最中の出来事なので、
// 「開いた・前面に戻った」の見直し（notificationCleanup.ts）だけでは間に合わない。
// 記録・計測の側からはこの合図だけを出し、見直しの本体（サーバーへの問い合わせなど）とは
// 依存しないようにする（nursingTimer.ts から notificationCleanup.ts を読むと循環するため）。

type Listener = () => void;

const listeners = new Set<Listener>();

/** 記録した・計測を始めた直後に呼ぶ。見直しを受け付けていなければ何もしない。 */
export const requestNotificationCleanup = (): void => {
  listeners.forEach((listener) => listener());
};

/** 合図の受け手を登録する。戻り値で解除。 */
export const onNotificationCleanupRequest = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
