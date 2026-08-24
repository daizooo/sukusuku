# すくすく（Androidネイティブ版）

[docs/native-app-rewrite.md](../docs/native-app-rewrite.md) の案Dにもとづく、Expo(React Native)の
プロジェクト。ルートのNext.js（凍結中のPWA）とは**独立したプロジェクト**で、依存もここで
完結している（npm workspacesにはしていない）。バックエンドは `supabase/` を両方から共有する。

いまは**フェーズ0（土台）**。到達点は「実機で自分のデータが1つ読める」こと。

## いま入っているもの

| | 中身 |
| --- | --- |
| `app/` | 画面（Expo Router）。`login.tsx`（ログイン）と `index.tsx`（読めているかを確かめる画面） |
| `src/lib/` | Web版から**そのまま持ってきた**計算・API層（約1,500行）。`@/` はこのフォルダを指す |
| `src/types/` | ドメイン型とSupabaseの生成型。Web版と同じもの |
| `src/lib/supabase.ts` | ネイティブ用のSupabaseクライアント（セッションを端末に保存する） |
| `src/lib/session.tsx` | ログイン状態をアプリ全体で1つ持つ |

`src/lib/api/` と `src/lib/*.ts` はWeb版(`../src/lib/`)からのコピー。凍結側は動かさない前提なので
分岐していく心配は小さい（docs/native-app-rewrite.md §1）。持ってこなかったものは次の3つ。

- `pushSubscriptions.ts` / `nursingAlarms.ts` — Web Push専用。FCMへ移すフェーズ3で作り直す
- `alarm.ts` / `nursingTimer.ts` / `push.ts` — 鳴らし方は前面サービスへ。フェーズ1
- `documents.ts` の `uploadDocument` — `<input type="file">` の `File` はReact Nativeに無い。
  `expo-document-picker` で選ぶ形になるフェーズ2で足す（読み・削除は持ってきている）

## 動かす

```bash
cd mobile
npm install
cp .env.local.example .env.local
# .env.local に Supabase の値を入れる（ルートの .env.local と同じプロジェクト）
npm start
```

Android端末に **Expo Go** を入れ、同じWi-Fiにつないでターミナルに出るQRコードを読む。
フェーズ0で使っているものはすべてExpo Goに同梱されているので、これだけで実機で開ける。

Web版と同じメールアドレス・パスワードでログインでき（`signInWithPassword`）、
ログインすると今日の記録と「次の授乳の目安」が出る。ここまで出れば、
ログイン・RLS(`family_id`)・移植した計算がひととおり通っている。

一度ログインすればセッションは端末(AsyncStorage)に残るので、2回目からはログイン画面を通らない。

### `.apk` を作る（フェーズ1以降）

前面サービス（Kotlin）を入れるフェーズ1からはExpo Goでは動かせないので、開発ビルドが要る。

```bash
npm run prebuild   # android/ を生成する
npm run android    # USB接続した端末へインストールする
```

**Android SDKが要るので、これは手元のPCで行う**（Claude Code側の環境では通せない）。
ストアには出さず `.apk` を自分たちの端末に直接入れる方針（docs/native-app-rewrite.md §8）。
署名鍵(keystore)はリポジトリにコミットしない。

## この先

| フェーズ | やること |
| --- | --- |
| 1 | 記録タブの授乳まわり＋前面サービス＋端末内に控える仕組み |
| 2 | ホーム / 予定 / メモ / 情報 の各タブ |
| 3 | 通知をWeb PushからFCMへ |
| 4 | PWAを畳む |

## 気をつけること

- ルートの `package.json` / `tsconfig.json` / `eslint.config.mjs` は触らない
- 画面の作り方（タブ全体をスクロールさせない等）はルートの `CLAUDE.md` に従う
- Expoは変わりが速い。書く前に `AGENTS.md` の指すバージョン付きのドキュメントを読む
