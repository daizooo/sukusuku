# mobile版 `.apk` の自動配布（Firebase App Distribution）

いまは「Actionsから`.apk`を落とす→NASへ移す→家族それぞれの端末で落とす→入れ直す」を
mainにマージするたびに手でやっている。この手順を、Firebase App Distribution
（ストアには出さず、登録した端末にだけ配れる仕組み）を使って自動化する。

ここは**FCM通知のセットアップ（docs/notifications.md §11）と同じFirebaseプロジェクト**
を使う。Androidアプリ（`com.sukusuku.app`）は既に登録済みなので、そのまま使い回せる。

## セットアップ（一度やれば以降は不要）

### 手順1: App Distributionを有効にする

[Firebase コンソール](https://console.firebase.google.com/)で対象プロジェクトを開き、
左メニューの **Release & Monitor > App Distribution** を開いて「はじめる」を押す。
Androidアプリは追加済みなので、新しく登録する必要はない。

### 手順2: テスターグループを作る

**テスターとグループ**タブ → グループを追加 → 名前を `family` にする
（CI側は `--groups family` で固定しているので、名前を揃えること）。
まず自分のメールアドレスをそのグループに追加する（家族のぶんはあとで足せる）。

### 手順3: 配布用のサービスアカウントを作る

[Google Cloud Console](https://console.cloud.google.com/)で同じプロジェクトを選び、
**IAMと管理 > サービスアカウント > 作成**する（名前は例えば
`github-actions-app-distribution`）。ロールに **Firebase App Distribution Admin**
（`roles/firebaseappdistro.admin`）を付ける。

> FCM送信用のサービスアカウント（docs/notifications.md §11 手順3）とは**別物**にする。
> スコープを配布だけに絞るため。

作成したサービスアカウントの **鍵** タブ → 鍵を追加 → JSON形式でダウンロードする。

### 手順4: GitHub Secretsに登録する

リポジトリの Settings > Secrets and variables > Actions に追加する。

| Secret | 中身 |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | 手順3で落としたJSONファイルの中身そのまま |
| `FIREBASE_ANDROID_APP_ID` | `google-services.json` の `client[0].client_info.mobilesdk_app_id`（`1:...:android:...`の形） |

どちらか未登録のままでも `mobile-apk.yml` は落ちない。配布ステップだけ警告を出して
スキップし、ビルド確認そのものは続く。

### 手順5: 端末で招待を受ける

上記が済んだ状態でmainに何か変更がマージされると、CIが自動でFirebase App
Distributionへ`.apk`をアップロードする。テスターに登録したメールアドレスへ
Firebaseから招待メールが届くので、案内に従ってGoogleアカウントでログインし、
案内される配布用アプリを端末に入れる（初回だけ）。

以後は新しい `.apk` が配布されるたびにその端末へ更新通知が届き、タップしてそのまま
インストールできる。「提供元不明のアプリ」の許可は`mobile/README.md`の初回インストール
時と同じく最初の1回だけ要る。

家族の端末も使うときは、そのメールアドレスを手順2の `family` グループに追加すればよい。

## 配るとき（2026-09-23に変更）

**Actionsの "mobile APK" を手で走らせたときだけ配る。**
Actions > mobile APK > Run workflow で、ブランチに `main` を選び、
`distribute` をonのまま実行する。18分ほどで端末に更新通知が届く。

以前はmainへマージするたびに自動でビルド・配布していたが、1回18分かかるため
マージのたびにActionsの無料枠を削り、実際に使い切った。配るのは「端末に入れて
使いたくなったとき」だけでよく、**複数のPRをまとめて1回のビルドで配れる**。
日々の確認は手元のビルドで足りる（docs/mobile-local-build.md）。

- 動くかどうかだけ見たいときは `distribute` をoffにする（Artifactsに`.apk`が残り、配布はしない）
- PRでは型チェックだけが走る（Androidのフルビルドはしない）

## 動くようになると何が変わるか

- 手動実行のたびにCIが`.apk`を作り直し、自動でFirebase App Distributionへ渡す
- テスター登録した端末に数分後には更新通知が届く
- GitHub Actionsの画面を開いてArtifactsを落とし、NAS経由で端末へ運ぶ手作業が不要になる

## 動かないときの確認

| 症状 | 見るところ |
| --- | --- |
| Actionsの配布ステップが `403` で失敗する | サービスアカウントに Firebase App Distribution Admin ロールが付いているか |
| `app not found` 系のエラーで失敗する | `FIREBASE_ANDROID_APP_ID` が `google-services.json` の値と一致しているか |
| 招待メールが届かない | テスターのメールアドレスが `family` グループに入っているか（手順2） |
| 招待メールは届いたが端末に更新通知が来ない | 案内された配布用アプリのインストールと、招待の承諾（ログイン）が済んでいるか |
| 端末で「アプリがインストールされていません」と出る | 署名が変わった（docs/store-release.md §3）。一度アンインストールしてから入れる |
