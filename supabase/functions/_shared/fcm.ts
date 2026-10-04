// FCM (Firebase Cloud Messaging) HTTP v1 での送信処理。
//
// ネイティブ版(Android)はService Workerを持たないため、Web Push(RFC 8291)では届かない。
// 代わりにFCMの登録トークンへ送る。宛先は push_subscriptions の kind = 'fcm' の行
// （endpoint は 'fcm:' + 登録トークン。0037を参照）。
//
// ライブラリを使わず Web Crypto だけで組んでいるのは、配信が外部レジストリのAPI変更で
// 止まらないようにするため（撤去した _shared/webpush.ts も同じ理由だった）。
// FCM側で必要なのは次の2つだけ。
//
// 1. サービスアカウントの鍵でJWTを作り、OAuth2のアクセストークンに交換する
//    (RFC 7523 の jwt-bearer グラント)
// 2. そのトークンで messages:send を叩く
//
// アクセストークンは1時間有効なので、1回の実行の中では取り直さない。

/** サービスアカウントの鍵(JSON)のうち、ここで使う分。 */
export interface FcmServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

export interface FcmContext {
  projectId: string;
  accessToken: string;
}

export interface FcmResult {
  ok: boolean;
  /** トークンが失効している（アプリを消した・再インストールした等）。行を消してよい。 */
  gone: boolean;
  error?: string;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** endpoint から登録トークンを取り出す。'fcm:' で始まらない行はここへ来ない。 */
export const FCM_ENDPOINT_PREFIX = 'fcm:';

export const toFcmEndpoint = (token: string): string => `${FCM_ENDPOINT_PREFIX}${token}`;

export const fcmTokenOf = (endpoint: string): string =>
  endpoint.startsWith(FCM_ENDPOINT_PREFIX) ? endpoint.slice(FCM_ENDPOINT_PREFIX.length) : endpoint;

// ============================================================
// base64url
// ============================================================
const base64UrlEncode = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlEncodeText = (value: string): string =>
  base64UrlEncode(new TextEncoder().encode(value));

// ============================================================
// サービスアカウントの鍵
// ============================================================
// 鍵は PKCS#8 の PEM で入っている。Web Crypto は DER しか受け取らないので、
// ヘッダー行と改行を落として base64 をほどく。
//
// 環境変数に入れる都合で改行が `\n` の2文字になっていることがあるため、
// そこも戻してから扱う。
function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/**
 * サービスアカウントの鍵でアクセストークンを取る。
 * 1時間有効なので、1回の実行につき1度だけ呼ぶ（createFcmContext がそれにあたる）。
 */
export async function createFcmContext(account: FcmServiceAccount): Promise<FcmContext> {
  const signingKey = await importPrivateKey(account.private_key);

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = base64UrlEncodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncodeText(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: issuedAt,
      exp: issuedAt + 3600,
    }),
  );
  const signature = base64UrlEncode(
    new Uint8Array(
      await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        signingKey,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    ),
  );

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${payload}.${signature}`,
    }),
  });
  if (!response.ok) {
    throw new Error(`FCMのアクセストークンを取れませんでした: ${response.status} ${await response.text()}`);
  }

  const token = (await response.json()) as { access_token?: string };
  if (!token.access_token) throw new Error('FCMのアクセストークンが空でした');

  return { projectId: account.project_id, accessToken: token.access_token };
}

/** 通知の中身。Web Push側(public/sw.js)が受け取るものと同じ形で渡す。 */
export interface FcmNotification {
  title: string;
  body: string;
  /** タップしたときの飛び先を決める材料。sw.js と同じキーで data に載せる。 */
  data: Record<string, string>;
  /** Androidの通知チャンネル。アプリ側で作ったidと合わせる。 */
  channelId: string;
  /** 同じ用件のお知らせを積み上げず差し替えるための目印（Web Push側のtagと同じ値）。 */
  tag: string;
  ttlSeconds: number;
}

/**
 * 1台へ送る。
 *
 * notification と data の両方を載せる。notification があるとアプリが起きていなくても
 * OSがそのまま出してくれるので、寝ている間の予定のリマインダーも落とさない。
 * data はタップしたときの飛び先に使う。
 */
export async function sendFcmNotification(
  fcm: FcmContext,
  token: string,
  notification: FcmNotification,
): Promise<FcmResult> {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fcm.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: notification.title, body: notification.body },
            data: notification.data,
            android: {
              // 端末が寝ていても起こして出す。決まった時刻のお知らせなので、
              // 後回しにされると意味がなくなる。
              priority: 'HIGH',
              ttl: `${notification.ttlSeconds}s`,
              notification: {
                channel_id: notification.channelId,
                // 同じ用件のお知らせは積み上げずに差し替える（Web Push側のtagと同じ考え方）
                tag: notification.tag,
                // **click_action は指定しない。** 指定すると、その名前のアクションに合う
                // intent-filter を持つActivityが探されるが、MainActivity の MAIN のフィルタは
                // LAUNCHER しか持たず android.intent.category.DEFAULT が無いため、どれにも
                // 当たらない。タップしても通知が消えるだけでアプリが開かなくなる。
                //
                // 指定しなければFCMの既定どおりランチャーのActivityが開き、通知の data が
                // Intentのextrasで渡る。expo-notifications の ExpoNotificationLifecycleListener が
                // それを拾って「通知のタップ」として扱うので、飛び先の処理
                // (mobile/app/_layout.tsx) が動く。アプリを消していたときも、起こしてからでも同じ。
                //
                // 「タップで既にあるアプリを前面に出す（新しく積み上げない）」ことは、
                // MainActivity の launchMode="singleTask" が担っているので指定は要らない。
              },
            },
          },
        }),
      },
    );

    if (response.ok) return { ok: true, gone: false };

    const body = await response.text();
    // 404 = トークンが失効している（アプリを消した・入れ直した）。
    // 403 は鍵とプロジェクトの取り違えなので、宛先を消してはいけない。
    const gone = response.status === 404 || body.includes('UNREGISTERED');
    return { ok: false, gone, error: `${response.status} ${body}` };
  } catch (error) {
    return { ok: false, gone: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 1台へデータだけを送る（画面には何も出ない）。
 *
 * notification を載せないと、アプリが閉じていても端末側の FirebaseMessagingService が
 * 受け取って処理できる（notification があると、アプリが裏にいる間はOSが黙って出すだけで
 * アプリのコードは動かない）。起床アラームの予約を端末へ伝えるのに使う。
 * data は文字列しか載らない。
 */
export async function sendFcmData(
  fcm: FcmContext,
  token: string,
  data: Record<string, string>,
  ttlSeconds: number,
): Promise<FcmResult> {
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${fcm.projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${fcm.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token,
            data,
            // 端末が寝ていても届ける。省電力で後回しにされると、予約の入れ替えが間に合わない。
            android: { priority: 'HIGH', ttl: `${ttlSeconds}s` },
          },
        }),
      },
    );

    if (response.ok) return { ok: true, gone: false };

    const body = await response.text();
    const gone = response.status === 404 || body.includes('UNREGISTERED');
    return { ok: false, gone, error: `${response.status} ${body}` };
  } catch (error) {
    return { ok: false, gone: false, error: error instanceof Error ? error.message : String(error) };
  }
}
