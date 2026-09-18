// fcm.ts の検証。
//
//   npm run test:fcm
//
// サービスアカウントの鍵からアクセストークンを取る手順（RFC 7523 の jwt-bearer）は
// 自前で組んでいるため、実際に端末へ送ってみるまで正しさが分かりにくい。
// ここでは Google 側がやることを別に書き起こし、
//   1. 送ったJWTがサービスアカウントの公開鍵で検証できるか
//   2. messages:send に載せる中身が意図どおりか
//   3. 失効したトークンを失効として扱えるか
// を確かめている。
import assert from 'node:assert';
import { generateKeyPairSync } from 'node:crypto';
import {
  createFcmContext,
  fcmTokenOf,
  sendFcmNotification,
  toFcmEndpoint,
  type FcmServiceAccount,
} from './fcm.ts';

/** messages:send のリクエストボディ。確かめたい部分だけを書いてある。 */
interface SendBody {
  message: {
    token: string;
    notification: { title: string; body: string };
    data: Record<string, string>;
    android: {
      priority: string;
      ttl: string;
      notification: { channel_id: string; tag: string };
    };
  };
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const base64UrlDecode = (value: string): Uint8Array => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')), (c) =>
    c.charCodeAt(0),
  );
};

// ============================================================
// 0. endpoint の組み立て
// ============================================================
// push_subscriptions.endpoint には 'fcm:' + トークンで入る（0037）。
assert.equal(toFcmEndpoint('tok-123'), 'fcm:tok-123');
assert.equal(fcmTokenOf('fcm:tok-123'), 'tok-123', '接頭辞を外してトークンが取れること');
assert.equal(fcmTokenOf('tok-123'), 'tok-123', '接頭辞が無い値はそのまま返す');
console.log('OK: endpoint とトークンの行き来');

// ---- サービスアカウントの鍵（Firebaseコンソールが出すJSONと同じ形式）----
const kp = generateKeyPairSync('rsa', { modulusLength: 2048 });
const privatePem = kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const account: FcmServiceAccount = {
  project_id: 'sukusuku-test',
  client_email: 'sender@sukusuku-test.iam.gserviceaccount.com',
  // 環境変数に入れる都合で改行が2文字の `\n` になっていることがあるため、その形で渡す
  private_key: privatePem.replace(/\n/g, '\\n'),
};

// ============================================================
// 1. アクセストークンを取るJWT
// ============================================================
let tokenRequest: URLSearchParams | null = null;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  tokenRequest = new URLSearchParams(init.body as string);
  return new Response(JSON.stringify({ access_token: 'access-abc', expires_in: 3599 }), {
    status: 200,
  });
}) as unknown as typeof fetch;

const fcm = await createFcmContext(account);
assert.equal(fcm.projectId, 'sukusuku-test');
assert.equal(fcm.accessToken, 'access-abc');
assert.ok(tokenRequest, 'トークンの取得が呼ばれること');

assert.equal(
  tokenRequest!.get('grant_type'),
  'urn:ietf:params:oauth:grant-type:jwt-bearer',
  'jwt-bearer グラントで交換すること',
);

const [h64, p64, s64] = tokenRequest!.get('assertion')!.split('.');
const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h64)));
const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(p64)));
assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
assert.equal(payload.iss, account.client_email, 'iss はサービスアカウントのメールアドレス');
assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
assert.equal(payload.scope, 'https://www.googleapis.com/auth/firebase.messaging');
assert.ok(
  payload.exp > Date.now() / 1000 && payload.exp <= Date.now() / 1000 + 3600,
  'exp は1時間以内',
);

const verifyKey = await crypto.subtle.importKey(
  'jwk',
  kp.publicKey.export({ format: 'jwk' }) as JsonWebKey,
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  false,
  ['verify'],
);
assert.equal(
  await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    verifyKey,
    base64UrlDecode(s64),
    utf8(`${h64}.${p64}`),
  ),
  true,
  'JWT の署名がサービスアカウントの公開鍵で検証できること',
);
console.log('OK: アクセストークンを取るJWTが検証できた');

// ============================================================
// 2. messages:send に載せる中身
// ============================================================
let sendRequest: { url: string; headers: Record<string, string>; body: unknown } | null = null;
globalThis.fetch = (async (url: string, init: RequestInit) => {
  sendRequest = {
    url,
    headers: init.headers as Record<string, string>,
    body: JSON.parse(init.body as string),
  };
  return new Response('{}', { status: 200 });
}) as unknown as typeof fetch;

const notification = {
  title: '朝の検温',
  body: '07:00 です。体温を測って記録しましょう',
  data: { kind: 'temperature', url: '/' },
  channelId: 'temperature-reminder',
  tag: 'temperature-reminder',
  ttlSeconds: 30 * 60,
};
const result = await sendFcmNotification(fcm, 'tok-123', notification);
assert.equal(result.ok, true, '送信が成功扱いになること');
assert.ok(sendRequest, 'fetch が呼ばれること');

assert.equal(
  sendRequest!.url,
  'https://fcm.googleapis.com/v1/projects/sukusuku-test/messages:send',
  'プロジェクトIDがURLに入ること',
);
assert.equal(sendRequest!.headers.Authorization, 'Bearer access-abc');

const message = (sendRequest!.body as SendBody).message;
assert.equal(message.token, 'tok-123');
// notification を載せるのは、アプリが起きていなくてもOSがそのまま出せるようにするため。
assert.deepEqual(message.notification, { title: notification.title, body: notification.body });
// data はタップしたときの飛び先に使う（受け取り側は mobile/src/lib/appLinks.ts）。
assert.deepEqual(message.data, { kind: 'temperature', url: '/' });
assert.equal(message.android.priority, 'HIGH', '時刻のお知らせは後回しにさせない');
assert.equal(message.android.ttl, '1800s', 'ttl は秒数 + s で渡す');
assert.equal(
  message.android.notification.channel_id,
  'temperature-reminder',
  'チャンネルはアプリ側(mobile/src/lib/push.ts)が作ったidと合わせる',
);
assert.equal(message.android.notification.tag, 'temperature-reminder');
console.log('OK: messages:send の中身');

// 予定のリマインダーは種類を持たない。data には taskId だけが載る。
await sendFcmNotification(fcm, 'tok-123', {
  ...notification,
  data: { taskId: 'task-1', url: '/' },
  channelId: 'task-reminder',
  tag: 'task-task-1',
});
assert.deepEqual((sendRequest!.body as SendBody).message.data, {
  taskId: 'task-1',
  url: '/',
});
console.log('OK: 予定のリマインダーの data');

// ============================================================
// 3. 失効したトークンの扱い
// ============================================================
globalThis.fetch = (async () =>
  new Response('{"error":{"status":"NOT_FOUND"}}', { status: 404 })) as unknown as typeof fetch;
const gone = await sendFcmNotification(fcm, 'tok-123', notification);
assert.equal(gone.ok, false);
assert.equal(gone.gone, true, '404 はトークン失効として扱う');

globalThis.fetch = (async () =>
  new Response('{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}', {
    status: 400,
  })) as unknown as typeof fetch;
const unregistered = await sendFcmNotification(fcm, 'tok-123', notification);
assert.equal(unregistered.gone, true, 'UNREGISTERED もトークン失効');

// 403 は鍵とプロジェクトの取り違え。宛先を消してしまうと、直したあとに
// 各端末でオンにし直すことになるので失効にはしない。
globalThis.fetch = (async () =>
  new Response('{"error":{"status":"PERMISSION_DENIED"}}', {
    status: 403,
  })) as unknown as typeof fetch;
const denied = await sendFcmNotification(fcm, 'tok-123', notification);
assert.equal(denied.ok, false);
assert.equal(denied.gone, false, '403 は失効ではない');

globalThis.fetch = (async () => {
  throw new Error('network down');
}) as unknown as typeof fetch;
const offline = await sendFcmNotification(fcm, 'tok-123', notification);
assert.equal(offline.ok, false);
assert.equal(offline.gone, false, '通信できないだけなら失効ではない');
console.log('OK: 404/UNREGISTERED/403/通信断の扱い');
