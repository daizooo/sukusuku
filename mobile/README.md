# すくすく（Androidネイティブ版）

[docs/native-app-rewrite.md](../docs/native-app-rewrite.md) の案Dにもとづく、Expo(React Native)の
プロジェクト。ルートのNext.js（PWA）とは**独立したプロジェクト**で、依存もここで
完結している（npm workspacesにはしていない）。バックエンドは `supabase/` を両方から共有する。

いまは**フェーズ1（授乳）**。到達点は「授乳だけネイティブで回せる」こと。
おむつ・搾乳の記録と、ホーム / 予定 / メモ / 情報 の各タブはPWA版で見る。

> **2026-08-27〜09-17は止めていた（凍結）。** その間にPWA側の授乳が
> **セット制**（左5分 → 右5分 → ゲップ5分、区切りごとにお知らせ1回、ゲップまで
> 終われば計測も止まる）へ作り直されたので、**ここの授乳はまだ作り直す前の仕組み**
> （左右の累積＋経過分数を長短で鳴らし分ける形）のまま。追いつかせるのが再始動の
> 最初の作業になる（docs/native-app-rewrite.md の【現況】）。

## いま入っているもの

| | 中身 |
| --- | --- |
| `app/` | 画面（Expo Router）。`login.tsx`（ログイン）と `index.tsx`（記録タブ・授乳まわり） |
| `src/components/` | 画面の部品。`log/`（記録タブ）と `ui/`（入力欄・選択肢などの共通部品） |
| `src/lib/` | Web版から**そのまま持ってきた**計算・API層。`@/` はこのフォルダを指す |
| `src/lib/offline/` | 端末内に控える仕組み（SQLite）。読みは控え先出し、書きはoutboxで後送り |
| `src/lib/nursingTimer.ts` | 左右別の授乳タイマー。計測中の値は端末に控える |
| `src/lib/nursingAlarm.ts` | お知らせを前面サービスへ預ける層。無い環境では振動だけに落とす |
| `src/types/` | ドメイン型とSupabaseの生成型。Web版と同じもの |
| `modules/nursing-alarm/` | 前面サービス（Kotlin）。授乳中だけ動き、区切りごとに鳴らす |

`src/lib/api/` と `src/lib/dateUtils.ts` などはWeb版(`../src/lib/`)からのコピー。凍結側は動かさない
前提なので分岐していく心配は小さい（docs/native-app-rewrite.md §1）。持ってこなかったものは次の3つ。

- `pushSubscriptions.ts` / `nursingAlarms.ts` — Web Push専用。FCMへ移すフェーズ3で作り直す
- `alarm.ts` / `push.ts` — 鳴らし方は前面サービスへ。長短の規則だけ `src/lib/alarmPattern.ts` と
  `modules/nursing-alarm/.../AlarmPattern.kt` に持ってきた
- `documents.ts` の `uploadDocument` — `<input type="file">` の `File` はReact Nativeに無い。
  `expo-document-picker` で選ぶ形になるフェーズ2で足す（読み・削除は持ってきている）

## 授乳のお知らせはどう鳴るか

短い「ピッ」1回＝5分、長い「ポーン」1回＝30分。鳴り方だけで経過時間が分かる規則は
PWA版から変えていない（docs/native-app-rewrite.md §4）。鳴らす場所だけが変わった。

```
[画面] 左/右をタップ
  └ src/lib/nursingTimer.ts が「いまどちらを何時から測っているか」を前面サービスへ預ける
       └ 常駐通知「授乳 0分 左」を出し、自分で経過時間を数える
            └ 5分ごとに 音（USAGE_ALARM）+ 振動 + 常駐通知の書き換え
[画面] 左右の切り替え → 新しい baselineAt で預け直す
[画面] 停止・記録の保存 → サービス終了・常駐通知も消える
```

- 画面が消えていても、アプリを閉じていても、圏外でも鳴る。マナーモードでも鳴る
- 音量は端末の**アラーム音量**に乗る（夜中に鳴らすものなので着信音量とは分ける）
- 聞き逃しても、通知バーに「授乳 12分 左」と出ているので分かる
- **端末のバッテリー最適化から除外する設定を1回入れておく**（設定 > アプリ > 電池 > 制限しない）。
  前面サービスは強い部類だが、機種によっては切られることがある

前面サービスは開発ビルドにしか入らないため、**Expo Goで開いた場合はアプリを開いている間の
振動だけ**になる（記録タブの下にその旨が出る）。

## 圏外でも記録できる

授乳中に電波が悪くて記録できないのがいちばん困る形の失敗なので、記録は端末内(SQLite)に
先に入れてから送る（docs/native-app-rewrite.md §6）。

- 起動直後は端末の控えが出る。サーバーの返事は待たない
- 圏外で付けた記録は「未送信」と出て、電波が戻ったときにまとめて送られる
- 送る順番は付けた順のまま。1つでも送れなければそこで止めて、次の機会に続きから送る

## 動かす

```bash
cd mobile
npm install
cp .env.local.example .env.local
# .env.local に Supabase の値を入れる（ルートの .env.local と同じプロジェクト）
npm start
```

Web版と同じメールアドレス・パスワードでログインできる（`signInWithPassword`）。
一度ログインすればセッションは端末(AsyncStorage)に残るので、2回目からはログイン画面を通らない。

### `.apk` を作る

前面サービス（Kotlin）はExpo Goに入っていないので、**アラームを実機で試すには
`.apk` を作って入れる必要がある**。

**いつもはCIが作る。** `mobile/` を触ったPRでGitHub Actionsが走り
（`.github/workflows/mobile-apk.yml`）、実行ページの Artifacts から `.apk` を落として
端末に入れられる。`src/` をVercelのプレビューで確かめるのと同じ形。

- 初回だけ、リポジトリの Settings > Secrets and variables > Actions に
  `EXPO_PUBLIC_SUPABASE_URL` と `EXPO_PUBLIC_SUPABASE_ANON_KEY` を登録する
  （Web版の `.env.local` と同じ値）。未登録だとCIが止まる
- 端末側は「提供元不明のアプリ」の許可が要る（初回のみ）

手元のPCで作ることもできる。**Android SDKが要る**（Claude Code側の環境では通せない）。

```bash
npm run prebuild   # android/ を生成する（modules/nursing-alarm も自動で組み込まれる）
npm run android    # USB接続した端末へインストールする
```

ストアには出さず `.apk` を自分たちの端末に直接入れる方針（docs/native-app-rewrite.md §8）。
署名鍵(keystore)はリポジトリにコミットしない。

### 実機で確かめること

1. 授乳を始めて画面を消し、30分放置して区切りごとに鳴るか（5分・10分…）
2. 鳴り方が長短の規則どおりか（30分で長音1回、35分で長音1回+短音1回）
3. マナーモードでも鳴るか。音量がアラーム音量に乗るか
4. 常駐通知の分数が進むか。タップでアプリが開くか
5. 機内モードで記録を付け、戻したときに送られるか（「未送信」が消えるか）

## この先

| | やること |
| --- | --- |
| **再始動1** | 授乳をPWA版と同じ**セット制**へ作り直す（`src/lib/nursingTimer.ts` と `modules/nursing-alarm`） |
| 2 | おむつ・搾乳の記録と、ホーム / 予定 / メモ / 情報 の各タブ |
| 3 | 通知をWeb PushからFCMへ |
| 4 | PWAを畳む |

フェーズ1で残していること。

- 常駐通知からの操作（「停止」ボタン）。いまはタップでアプリを開くだけ
- お知らせ間隔（5/10/15分）の設定画面。いまは5分で固定（フェーズ2の設定タブで作る）
- 搾乳の記録そのもの。飲ませる側（授乳の「搾乳」）だけ作ってあるので、
  ストックを足すのはPWA版で行う

## 気をつけること

- ルートの `package.json` / `tsconfig.json` / `eslint.config.mjs` は触らない
- 画面の作り方（タブ全体をスクロールさせない等）はルートの `CLAUDE.md` に従う
- Expoは変わりが速い。書く前に `AGENTS.md` の指すバージョン付きのドキュメントを読む
