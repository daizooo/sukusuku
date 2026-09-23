# 手元（Windows）で `.apk` を作る・動かす

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

この文書は**Windows**向けに書く（Macの場合はパスと環境変数の書き方だけ読み替える。§7）。

---

## 1. 入れるもの

PowerShellを開いて winget で入れるのがいちばん速い。

```powershell
winget install EclipseAdoptium.Temurin.17.JDK   # JDK 17（CIと同じ版）
winget install Google.AndroidStudio             # Android SDK 一式が入る
winget install OpenJS.NodeJS.LTS                # Node.js（CIは22。22以上ならよい）
winget install Git.Git                          # gitを入れていなければ
```

| | なぜ要るか |
| --- | --- |
| JDK 17 | React Native 0.81 のGradleビルドが要求する。**Android Studio同梱のJDKは21**なので、CIと揃えるなら17を別に入れる |
| Android Studio | SDK・ビルドツール・`adb`・エミュレータが一式入る。初回起動時のウィザードは既定のまま進めてよい |
| Node.js | `node -v` が22以上であることを確認する |

ディスクは10〜15GBほど使う。

### 環境変数（初回だけ）

```powershell
setx ANDROID_HOME "$env:LOCALAPPDATA\Android\Sdk"
setx JAVA_HOME "C:\Program Files\Eclipse Adoptium\jdk-17.0.x-hotspot"
# ↑ 実際に入ったフォルダ名に合わせる（エクスプローラで確認する）
setx PATH "$env:PATH;$env:LOCALAPPDATA\Android\Sdk\platform-tools"
```

**`setx` は今開いているウィンドウには効かない。** 設定したらPowerShellを開き直し、
`adb version` と `java -version` が通ることを確かめる。

### Windowsでだけ要る下ごしらえ

| | 何をするか | しないとどうなるか |
| --- | --- | --- |
| **長いパスを許可** | 管理者PowerShellで<br>`New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name LongPathsEnabled -Value 1 -PropertyType DWORD -Force` | `node_modules` と Gradle のパスが260文字を超えてビルドが落ちる |
| **浅い場所に置く** | `C:\dev\sukusuku` のような短いパスにクローンする | 同上。`C:\Users\<名前>\Documents\...` は深くなりがち |
| **Defenderの除外** | Windowsセキュリティ > ウイルスと脅威の防止 > 除外 に `C:\dev` と `%USERPROFILE%\.gradle` を追加 | 毎回のビルドが2〜3倍遅くなる |
| **Metroの通信を許可** | 初回に出るファイアウォールのダイアログで Node.js を許可する | 端末がMetroに繋がらず、JSの更新が反映されない |

## 2. 初回の用意

```powershell
cd C:\dev
git clone https://github.com/daizooo/sukusuku.git
cd sukusuku\mobile
npm ci

copy .env.local.example .env.local
notepad .env.local   # Supabase の URL と anon key を入れる
```

`.env.local` に入れる値は、Actionsの Secrets（`EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY`）およびWeb版の `.env.local` と同じ。

通知(FCM)を使うビルドには `google-services.json` が要る。Firebaseコンソールから
落として `C:\dev\sukusuku\mobile\` に置く（docs/notifications.md §11）。

`.env.local` も `google-services.json` も**コミットしない**（`mobile/.gitignore` 済み）。

## 3. 端末をつなぐ

| 手順 | |
| --- | --- |
| 1 | 端末の 設定 > デバイス情報 の **ビルド番号を7回タップ**して開発者向けオプションを出す |
| 2 | 設定 > システム > 開発者向けオプション > **USBデバッグ** をオンにする |
| 3 | USBでPCへつなぐ。端末に出る「このPCを許可しますか」で**許可**する |
| 4 | PowerShellで `adb devices`。`device` と出れば繋がっている |

`unauthorized` のままなら端末側の許可ダイアログを見落としている。`adb kill-server`
してからつなぎ直す。機種によってはメーカーのUSBドライバが要る。

エミュレータでもよい（Android Studio > Device Manager から作る）。その場合は
Windowsの機能で **Windows ハイパーバイザー プラットフォーム** を有効にしておく。

## 4. 日々の開発ループ

```powershell
cd C:\dev\sukusuku\mobile
npm run android
```

- 初回は10〜20分（CIと同じくGradleが一式を作る）。**2回目以降は差分ビルドで数分**
- 起動したあとは**Metroが繋がったまま**なので、JSを保存すれば画面がすぐ入れ替わる。
  リストの錠前のような表示の変更は、ここで見るのがいちばん速い
- Kotlin側（`modules/nursing-alarm/`）を触ったときだけ `npm run android` をやり直す
- 変更を取り込むときは `git pull` のあと `npm ci`（依存が変わっていることがある）

**Expo Go（`npm start`）では前面サービスとFCMが動かない。** 授乳アラームと通知を
確かめるときは必ず `npm run android` で入れた開発ビルドを使う。

## 5. 配る用の `.apk` を手元で作る

CIが止まっているとき（課金・無料枠）や、すぐ端末へ入れたいときはこれで作れる。
**PowerShellでは環境変数の付け方がbashと違う**ので、次のとおりに打つ。

```powershell
cd C:\dev\sukusuku\mobile
$env:ANDROID_VERSION_CODE = "200"      # ← 下の表を読むこと
npx expo prebuild --platform android --no-install

cd android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
# → app\build\outputs\apk\release\app-release.apk
```

| 気をつけること | 中身 |
| --- | --- |
| **`ANDROID_VERSION_CODE` は必ず直近のCIより大きく** | CIは `github.run_number` を焼き込んでいる（Actionsの実行ページの `#98` などの数）。小さい値だとAndroidが「ダウングレード」として拒否し、上書きインストールできない。**手元で作るぶんは200番台**など、CIと被らない帯を使うと混ざらない |
| 署名 | 既定ではExpoのdebug鍵。CIも同じ鍵なので**CI製と手元製が上書きできる**。自分たちの鍵へ移したあとは、その鍵で署名し直す必要がある（docs/store-release.md §3） |
| アーキテクチャ | 実機へ入れるなら `arm64-v8a` だけでよい。エミュレータへ入れるなら `-P...` を外す（4種すべて作るので37分ほどかかる） |
| `.env.local` | `assembleRelease` はここの値をJSへ焼き込む。空のまま作った `.apk` は起動した瞬間に落ちる |

できた `.apk` をUSBでつないだ端末へ入れるなら、そのまま次で入る。

```powershell
adb install -r app\build\outputs\apk\release\app-release.apk
```

家族の端末へ渡すときは、Googleドライブなどに置いて端末側で開く
（mobile/README.md の「端末に入れる」と同じ）。

## 6. つまずきどころ

| 症状 | 原因と直し方 |
| --- | --- |
| `SDK location not found` | `ANDROID_HOME` が通っていない。§1を設定してPowerShellを開き直す |
| `Unsupported class file major version` | JDKが17以外を見ている。`java -version` と `JAVA_HOME` を確認する |
| パス関連で謎のビルド失敗 | 長いパス。§1の「長いパスを許可」と、浅い場所へのクローン |
| `adb devices` に出ない | USBデバッグが未許可、またはケーブルが充電専用。`adb kill-server` してつなぎ直す |
| `INSTALL_FAILED_VERSION_DOWNGRADE` | `ANDROID_VERSION_CODE` が端末に入っているものより小さい（§5） |
| `INSTALL_FAILED_UPDATE_INCOMPATIBLE` | 署名が違う。鍵を入れ替えたときは一度アンインストールしてから入れる |
| 端末で画面が更新されない | Metroに繋がっていない。ファイアウォールでNode.jsを許可し、`npm run android` をやり直す |
| `android\` が壊れた | `rmdir /s /q android` してから `npm run prebuild`。`android\` はコミットしていないので捨ててよい |

## 7. Macの場合

手順は同じで、書き方だけ違う。

| | Windows | Mac |
| --- | --- | --- |
| SDKの場所 | `%LOCALAPPDATA%\Android\Sdk` | `~/Library/Android/sdk` |
| 環境変数 | `setx ANDROID_HOME "..."` | `~/.zshrc` に `export ANDROID_HOME=...` |
| 一時的な環境変数 | `$env:ANDROID_VERSION_CODE = "200"` | `ANDROID_VERSION_CODE=200 npx ...` |
| Gradle | `.\gradlew.bat` | `./gradlew` |

長いパスとDefenderの話はMacには無い。

## 8. これで何が変わるか

| | 前 | 後 |
| --- | --- | --- |
| 画面の変更を見るまで | 18分（CI） | 数秒〜数分（Metro／差分ビルド） |
| Actionsの消費 | マージのたびに18分 | 配るときだけ |
| CIが止まったとき | `.apk` を作れない | 手元で作れる |
| エミュレータ | 使えない | 使える（実機を触らずに確かめられる） |
| 次のアプリを作るとき | 同じ問題が最初から起きる | 同じ環境がそのまま使える |
