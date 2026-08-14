// VAPID鍵ペアを生成する。
//
//   node scripts/generate-vapid-keys.mjs
//
// Web Pushでは「誰が送ったプッシュか」をプッシュサービスに示すためにVAPID鍵を使う。
// 一度作ったら作り直さないこと。鍵を変えると、それまでに購読した端末への送信が
// すべて失敗するようになる（各端末で通知をオフ→オンし直す必要がある）。
//
// 出力される2つの値の使い分け:
//   - VAPID_KEYS (JWK)  : Supabase Edge Functionのシークレット。秘密鍵を含むので絶対に公開しない
//   - 公開鍵 (base64url) : Vercelの NEXT_PUBLIC_VAPID_PUBLIC_KEY。ブラウザに埋め込む前提の値
//
// 設定手順は docs/notifications.md を参照。

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const publicJwk = publicKey.export({ format: 'jwk' });
const privateJwk = privateKey.export({ format: 'jwk' });

// ブラウザの applicationServerKey は「非圧縮点 (0x04 || x || y)」のbase64url。
// JWKのx, yはそれぞれ32バイトのbase64urlなので、繋ぎ直せば得られる。
const publicKeyBase64Url = Buffer.concat([
  Buffer.from([0x04]),
  Buffer.from(publicJwk.x, 'base64url'),
  Buffer.from(publicJwk.y, 'base64url'),
]).toString('base64url');

console.log('--- VAPID_KEYS (Supabase Edge Functionのシークレットに設定) ---');
console.log(JSON.stringify({ publicKey: publicJwk, privateKey: privateJwk }));
console.log();
console.log('--- NEXT_PUBLIC_VAPID_PUBLIC_KEY (Vercelの環境変数に設定) ---');
console.log(publicKeyBase64Url);
console.log();
console.log('--- REMINDER_CRON_SECRET (pg_cronからEdge Functionを呼ぶときの合言葉) ---');
console.log(randomBytes(32).toString('base64url'));
