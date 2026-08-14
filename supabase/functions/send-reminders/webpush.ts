// Web Push の送信処理。
//
// ライブラリを使わず Web Crypto だけで組んでいる。Deno から使える Web Push の
// ライブラリはいくつかあるが、Edge Function のビルドが外部レジストリに依存すると
// 鍵の形式やAPIの変更で配信が止まりうるため、仕様が固まっている部分を直接実装した。
//
// - RFC 8291 (Message Encryption for Web Push): 本文の暗号化 (aes128gcm)
// - RFC 8292 (VAPID): 送信元を示す Authorization ヘッダー

// ============================================================
// base64url
// ============================================================
export function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const concat = (...chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

// ============================================================
// VAPID 鍵
// ============================================================
// scripts/generate-vapid-keys.mjs が出力する JWK をそのまま受け取る。
// 公開鍵は JWK の x, y から「非圧縮点 (0x04 || x || y)」に組み直す。
// これがブラウザの applicationServerKey や VAPID ヘッダーの k= に載る形式。
export interface VapidKeys {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export interface VapidContext {
  signingKey: CryptoKey;
  publicKeyBytes: Uint8Array;
  subject: string;
}

export async function createVapidContext(keys: VapidKeys, subject: string): Promise<VapidContext> {
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    keys.privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  const { x, y } = keys.publicKey;
  if (!x || !y) throw new Error('VAPID公開鍵(JWK)に x / y がありません');

  return {
    signingKey,
    publicKeyBytes: concat(new Uint8Array([0x04]), base64UrlDecode(x), base64UrlDecode(y)),
    subject,
  };
}

// VAPID の Authorization ヘッダーを作る。
// aud はプッシュサービスのオリジン（endpointごとに変わる）。
async function buildVapidHeader(vapid: VapidContext, endpoint: string): Promise<string> {
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: new URL(endpoint).origin,
    // 有効期限は12時間。RFC 8292 は24時間以内を求めている。
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  };

  const signingInput = `${base64UrlEncode(utf8(JSON.stringify(header)))}.${base64UrlEncode(
    utf8(JSON.stringify(payload)),
  )}`;

  // ECDSA の署名は Web Crypto が r||s の生バイト列で返すため、JWS にそのまま載せられる。
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    vapid.signingKey,
    utf8(signingInput),
  );

  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${base64UrlEncode(vapid.publicKeyBytes)}`;
}

// ============================================================
// 本文の暗号化 (RFC 8291, aes128gcm)
// ============================================================
const RECORD_SIZE = 4096;

async function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  lengthBytes: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

async function encryptPayload(
  payload: string,
  uaPublicKey: Uint8Array,
  authSecret: Uint8Array,
): Promise<Uint8Array> {
  // 送信ごとに使い捨ての鍵ペアを作り、受信端末の公開鍵とECDHして共有鍵を得る。
  const serverKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const serverPublicKey = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeys.publicKey));

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublicKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, serverKeys.privateKey, 256),
  );

  // 共有鍵と購読ごとの auth secret を混ぜて入力鍵を作る (RFC 8291 3.4)
  const keyInfo = concat(utf8('WebPush: info'), new Uint8Array([0]), uaPublicKey, serverPublicKey);
  const ikm = await hkdf(sharedSecret, authSecret, keyInfo, 32);

  // ここから先は RFC 8188 の aes128gcm と同じ導出
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const contentEncryptionKey = await hkdf(
    ikm,
    salt,
    concat(utf8('Content-Encoding: aes128gcm'), new Uint8Array([0])),
    16,
  );
  const nonce = await hkdf(
    ikm,
    salt,
    concat(utf8('Content-Encoding: nonce'), new Uint8Array([0])),
    12,
  );

  const aesKey = await crypto.subtle.importKey('raw', contentEncryptionKey, 'AES-GCM', false, [
    'encrypt',
  ]);
  // 0x02 は「これが最後のレコード」を表す区切り。1レコードに収まる短い本文しか送らない。
  const plaintext = concat(utf8(payload), new Uint8Array([0x02]));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, plaintext),
  );

  // ヘッダー: salt(16) || レコード長(4) || 公開鍵長(1) || 公開鍵(65) || 暗号文
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, RECORD_SIZE);

  return concat(
    salt,
    recordSize,
    new Uint8Array([serverPublicKey.length]),
    serverPublicKey,
    ciphertext,
  );
}

// ============================================================
// 送信
// ============================================================
export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  // 購読が失効している (404 / 410)。この場合は購読情報を削除する。
  gone: boolean;
  error?: string;
}

export async function sendPushNotification(
  vapid: VapidContext,
  subscription: PushSubscriptionRecord,
  payload: string,
  ttlSeconds = 12 * 60 * 60,
): Promise<PushResult> {
  try {
    const body = await encryptPayload(
      payload,
      base64UrlDecode(subscription.p256dh),
      base64UrlDecode(subscription.auth),
    );

    const response = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: {
        Authorization: await buildVapidHeader(vapid, subscription.endpoint),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(ttlSeconds),
        // 端末がスリープ中でも起こして表示する
        Urgency: 'normal',
      },
      body,
    });

    if (response.ok) return { ok: true, status: response.status, gone: false };

    const text = await response.text().catch(() => '');
    return {
      ok: false,
      status: response.status,
      gone: response.status === 404 || response.status === 410,
      error: `${response.status} ${response.statusText} ${text}`.trim().slice(0, 500),
    };
  } catch (cause) {
    return {
      ok: false,
      status: 0,
      gone: false,
      error: (cause instanceof Error ? cause.message : String(cause)).slice(0, 500),
    };
  }
}
