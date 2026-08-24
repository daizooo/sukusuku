// webpush.ts の検証。
//
//   npm run test:webpush
//
// Web Push の暗号化は自前で実装しているため、実際に端末へ送ってみるまで
// 正しさが分かりにくい。ここでは受信側(ブラウザ)がやることを RFC 8291 に沿って
// 別に書き起こし、送ったものがその手順で復号できるかを確かめている。
import assert from 'node:assert';
import { createVapidContext, sendPushNotification, base64UrlDecode, base64UrlEncode } from './webpush.ts';

const utf8 = (s: string) => new TextEncoder().encode(s);
const concat = (...cs: Uint8Array[]) => {
  const out = new Uint8Array(cs.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of cs) { out.set(c, o); o += c.length; }
  return out;
};

// ---- 受信端末の鍵ペア（ブラウザが PushSubscription で作るもの相当）----
const uaKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeys.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));

const subscription = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  p256dh: base64UrlEncode(uaPublicRaw),
  auth: base64UrlEncode(authSecret),
};

// ---- VAPID 鍵（scripts/generate-vapid-keys.mjs と同じ形式）----
const { generateKeyPairSync } = await import('node:crypto');
const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const vapidKeys = {
  publicKey: kp.publicKey.export({ format: 'jwk' }) as JsonWebKey,
  privateKey: kp.privateKey.export({ format: 'jwk' }) as JsonWebKey,
};
const vapid = await createVapidContext(vapidKeys, 'mailto:info@example.com');

// ---- fetch を差し替えて送信内容を捕まえる ----
let captured: { body: Uint8Array; headers: Record<string, string> } | null = null;
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  captured = { body: new Uint8Array(init.body as ArrayBuffer), headers: init.headers as Record<string, string> };
  return new Response(null, { status: 201 });
}) as typeof fetch;

const message = JSON.stringify({ taskId: 'x', title: '3ヶ月健診', body: '8月20日(水) 10:00 ・ 城南まちづくりセンター', url: '/' });
const result = await sendPushNotification(vapid, subscription, message);
assert.equal(result.ok, true, '送信が成功扱いになること');
assert.ok(captured, 'fetch が呼ばれること');

const { body, headers } = captured!;
assert.equal(headers['Content-Encoding'], 'aes128gcm');
assert.equal(headers['Content-Type'], 'application/octet-stream');

// ============================================================
// 1. 受信側として復号する (RFC 8291 / RFC 8188)
// ============================================================
const salt = body.slice(0, 16);
const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
const idLength = body[20];
const asPublicRaw = body.slice(21, 21 + idLength);
const ciphertext = body.slice(21 + idLength);

assert.equal(recordSize, 4096, 'レコード長ヘッダー');
assert.equal(idLength, 65, '公開鍵は非圧縮点の65バイト');
assert.equal(asPublicRaw[0], 0x04, '非圧縮点の先頭は 0x04');

const asPublic = await crypto.subtle.importKey('raw', asPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asPublic }, uaKeys.privateKey, 256));

const hkdf = async (ikm: Uint8Array, s: Uint8Array, info: Uint8Array, len: number) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, k, len * 8));
};

const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublicRaw, asPublicRaw);
const ikm = await hkdf(shared, authSecret, keyInfo, 32);
const cek = await hkdf(ikm, salt, concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
const nonce = await hkdf(ikm, salt, concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])), 12);

const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, aesKey, ciphertext));

assert.equal(plaintext[plaintext.length - 1], 0x02, '最終レコードの区切り 0x02');
assert.equal(new TextDecoder().decode(plaintext.slice(0, -1)), message, '本文が復号できること');
console.log('OK: 本文の暗号化 (aes128gcm) が復号できた');

// ============================================================
// 2. VAPID ヘッダーの検証
// ============================================================
const authHeader = headers['Authorization'];
const match = /^vapid t=([^,]+), k=(.+)$/.exec(authHeader);
assert.ok(match, `Authorization の形式: ${authHeader}`);
const [, jwt, k] = match!;

const [h64, p64, s64] = jwt.split('.');
const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(h64)));
const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(p64)));
assert.deepEqual(header, { typ: 'JWT', alg: 'ES256' });
assert.equal(payload.aud, 'https://fcm.googleapis.com', 'aud はプッシュサービスのオリジン');
assert.equal(payload.sub, 'mailto:info@example.com');
assert.ok(payload.exp > Date.now() / 1000 && payload.exp < Date.now() / 1000 + 24 * 3600, 'exp は24時間以内');

// k= はブラウザに渡す applicationServerKey と同じ値のはず
const expectedK = base64UrlEncode(concat(new Uint8Array([0x04]), base64UrlDecode(vapidKeys.publicKey.x!), base64UrlDecode(vapidKeys.publicKey.y!)));
assert.equal(k, expectedK, 'k= が VAPID 公開鍵(非圧縮点)であること');

const verifyKey = await crypto.subtle.importKey('jwk', vapidKeys.publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const valid = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifyKey, base64UrlDecode(s64), utf8(`${h64}.${p64}`));
assert.equal(valid, true, 'JWT の署名が公開鍵で検証できること');
console.log('OK: VAPID の Authorization ヘッダーが検証できた');

// ============================================================
// 3. 失効した購読の扱い
// ============================================================
globalThis.fetch = (async () => new Response('gone', { status: 410 })) as typeof fetch;
const goneResult = await sendPushNotification(vapid, subscription, message);
assert.equal(goneResult.ok, false);
assert.equal(goneResult.gone, true, '410 は購読失効として扱う');

globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
const failResult = await sendPushNotification(vapid, subscription, message);
assert.equal(failResult.gone, false, '500 は失効ではない');
console.log('OK: 410/500 の扱い');
