# 手元で `.apk` を作る・動かす

Claude Code側の環境にはAndroid SDKが無いため、**コードを書くのがClaude、実機で動かすのが
手元**という分担になっている（docs/native-app-rewrite.md §8）。これまでは手元に環境が無く、
その代わりをGitHub Actionsがしていた。1回18分かかるビルドを確認のたびに回していたため、
2026-09-23に無料枠を使い切った。

結論を先に書く。

- **手元に環境を置くのが土台。** CIの無料枠は有限で、アプリが増えるほど先に破綻する。
  ツールチェーン（JDK・Android SDK）は**どのアプリでも使い回せる**ので、入れるのは一度きり。
- **効くのは費用より速さ。** JSだけの変更（画面・計算・文言）は `npm run android` で
  入れた開発ビルドに**保存した瞬間に反映される**。18分待つ必要がなくなる。
- **CIは「家族へ配る正式なビルド」だけに残す。** 手動実行で配る
  （`.github/workflows/mobile-apk.yml`、docs/mobile-distribution.md）。

---

## 1. 要るもの

| | 中身 | 備考 |
| --- | --- | --- |
| JDK 17 | Temurin など | React Native 0.81 が要求する。Android Studioに同梱のものでもよい |
| Android SDK | Android Studio を入れるのが早い | Platform-Tools（`adb`）とビルドツールが入る |
| Node.js 22 | CIと同じ版 | |
| 端末またはエミュレータ | 家族の端末はarm64 | エミュレータはx86_64なので、手元ではアーキテクチャを絞らない |

**Macは要らない**（Androidだけなら）。WindowsでもmacOSでも同じ手順で通る。
ディスクは10〜15GBほど使う。

### 環境変数（初回だけ）

Android Studioを入れると SDK は次の場所に入る。`ANDROID_HOME` を通しておく。

| OS | SDKの場所 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\Android\Sdk` |
| macOS | `~/Library/Android/sdk` |

```bash
# macOS / Linux（~/.zshrc などに書く）
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

```powershell
# Windows（PowerShell、一度だけ）
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

## 2. 初回の用意

```bash
git clone https://github.com/daizooo/sukusuku.git
cd sukusuku/mobile
npm ci

cp .env.local.example .env.local
# .env.local に Supabase の URL と anon key を入れる
#（Actionsの Secrets、Web版の .env.local と同じ値）

# 通知(FCM)を使うビルドには google-services.json が要る。
# Firebaseコンソールから落として mobile/ に置く（docs/notifications.md §11）。
```

`.env.local` も `google-services.json` も**コミットしない**（`mobile/.gitignore` 済み）。

## 3. 日々の開発ループ

```bash
npm run android    # android/ を作り、端末かエミュレータへ開発ビルドを入れて起動する
```

- 初回は10〜20分（CIと同じくGradleが一式を作る）。**2回目以降は差分ビルドで数分**
- 起動したあとは**Metroが繋がったまま**なので、JSを保存すれば画面がすぐ入れ替わる。
  リストの錠前のような表示の変更は、ここで見るのがいちばん速い
- Kotlin側（`modules/nursing-alarm/`）を触ったときだけ再ビルドが要る
- エミュレータはAndroid Studioの Device Manager から作る。通知・前面サービスの確認も
  エミュレータでできる（音は鳴る。バイブは鳴らない）

**Expo Go（`npm start`）では前面サービスとFCMが動かない。** 授乳アラームと通知を
確かめるときは必ず `npm run android` で入れた開発ビルドを使う。

## 4. 配る用の `.apk` を手元で作る

CIが止まっているときや、すぐ端末へ入れたいときはこれで作れる。

```bash
cd mobile
ANDROID_VERSION_CODE=<直近のCIのrun_numberより大きい数> npx expo prebuild --platform android --no-install
cd android
./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → app/build/outputs/apk/release/app-release.apk
```

| 気をつけること | 中身 |
| --- | --- |
| **`ANDROID_VERSION_CODE` は必ず直近のCIより大きく** | CIは `github.run_number` を焼き込んでいる（実行ページの `#98` などの数）。小さい値だとAndroidが「ダウングレード」として拒否し、上書きインストールできない。手元で作るぶんは200番台など、CIと被らない帯を使うと混ざらない |
| 署名 | 既定ではExpoのdebug鍵。CIも同じ鍵なので**CI製と手元製が上書きできる**。自分たちの鍵へ移したあとは、その鍵で署名し直す必要がある（docs/store-release.md §3） |
| アーキテクチャ | 実機へ入れるなら `arm64-v8a` だけでよい。エミュレータへ入れるなら `-P...` を外す（4種すべて作るので37分ほどかかる） |
| `.env.local` | `assembleRelease` はここの値をJSへ焼き込む。空のまま作った `.apk` は起動した瞬間に落ちる |

端末への入れ方は mobile/README.md の「端末に入れる」と同じ。

## 5. つまずきどころ

| 症状 | 原因と直し方 |
| --- | --- |
| `SDK location not found` | `ANDROID_HOME` が通っていない。§1の環境変数を設定してターミナルを開き直す |
| `Unsupported class file major version` | JDKが17以外。`java -version` を確認する |
| インストールが `INSTALL_FAILED_VERSION_DOWNGRADE` | `ANDROID_VERSION_CODE` が端末に入っているものより小さい（§4） |
| インストールが `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 署名が違う。鍵を入れ替えたときは一度アンインストールしてから入れる |
| `android/` が壊れた | `rm -rf android && npx expo prebuild --platform android` で作り直す。`android/` はコミットしていないので捨ててよい |

## 6. これで何が変わるか

| | 前 | 後 |
| --- | --- | --- |
| 画面の変更を見るまで | 18分（CI） | 数秒〜数分（Metro／差分ビルド） |
| Actionsの消費 | マージのたびに18分 | 配るときだけ |
| エミュレータ | 使えない | 使える（実機を触らずに確かめられる） |
| 次のアプリを作るとき | 同じ問題が最初から起きる | 同じ環境がそのまま使える |
