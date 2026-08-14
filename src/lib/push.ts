// ブラウザ側のプッシュ通知まわり（Service Workerの登録・購読）
//
// 購読は「ブラウザ + 端末 + オリジン」ごとに作られる。スマホとPCの両方で
// 通知を受け取りたい場合は、それぞれの端末で通知をオンにする必要がある。

const SERVICE_WORKER_PATH = '/sw.js';

export const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

// この端末でWeb Pushが使えるか。
// iOSはホーム画面に追加したPWAとして起動したときだけ PushManager が生える。
export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

// iOS Safari は「ホーム画面に追加」してからでないと通知を購読できない。
// 通知が出せない理由を画面で説明するために使う。
export function isIosStandaloneRequired(): boolean {
  if (typeof window === 'undefined') return false;
  const isIos = /iP(hone|ad|od)/.test(navigator.userAgent);
  if (!isIos) return false;
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari 独自のフラグ
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return !isStandalone;
}

// applicationServerKey は base64url ではなく Uint8Array で渡す必要がある
function decodeVapidKey(base64Url: string): Uint8Array<ArrayBuffer> {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register(SERVICE_WORKER_PATH, {
    scope: '/',
    // sw.js 自体をHTTPキャッシュから読ませない。
    // 古いService Workerが残り続けて更新が反映されなくなるのを防ぐ。
    updateViaCache: 'none',
  });
  // 登録直後は active になっていないことがあるので、使えるようになるまで待つ
  return navigator.serviceWorker.ready;
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) return null;
  return registration.pushManager.getSubscription();
}

// 通知の許可を取り、この端末の購読を作る。
// 既に購読済みならそれをそのまま返す。
export async function subscribeToPush(): Promise<PushSubscription> {
  if (!VAPID_PUBLIC_KEY) {
    throw new Error('通知の設定(NEXT_PUBLIC_VAPID_PUBLIC_KEY)がされていません');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'この端末で通知がブロックされています。ブラウザの設定から許可してください。'
        : '通知が許可されませんでした',
    );
  }

  const registration = await registerServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) return existing;

  return registration.pushManager.subscribe({
    // Web Push の仕様上、受け取ったら必ずユーザーに見える通知を出す約束
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(VAPID_PUBLIC_KEY),
  });
}

// PushSubscription から、DBに保存する形（base64urlの鍵）へ変換する
export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function extractSubscriptionKeys(subscription: PushSubscription): PushSubscriptionKeys {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error('購読情報の鍵を取得できませんでした');
  return { endpoint: subscription.endpoint, p256dh, auth };
}
