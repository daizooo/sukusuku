// 開発ビルド(debug)を正式版と別アプリとして並べて入れられるようにする。
//
// 正式版(CIの assembleRelease)は com.sukusuku.app のまま。debugビルドだけ
// パッケージ名に .dev を足す。こうしないと、家族へ配った正式版が入っている端末に
// npm run android で開発ビルドを入れようとしたときに、同じパッケージの
// 「ダウングレード」として拒否され、正式版を消すしかなくなる。
//
// ホーム画面で見分けられるように、名前とアイコンの背景色も変える。
// - 名前: ランチャーは4文字ほどで切る（「すくすく手帳」も「すくすく…」になる）ので、
//   「すくすく開発」では正式版と同じ「すくすく…」になり見分けられなかった。
//   先頭4文字で違いが分かる「すく開発」にする。
// - 色: 正式版の背景は白。開発版は濃いグレーの無地にする。足跡の
//   前景とモノクロ(テーマアイコン)はそのまま使う。
//
// 通知(FCM)は google-services.json に com.sukusuku.app.dev のクライアントが
// 無いとdebugビルドが通らない。Firebaseに同名のAndroidアプリを足してから
// 取り直した google-services.json を置く（取り方は docs/notifications.md §11）。
// CIの GOOGLE_SERVICES_JSON は正式版のクライアントさえ入っていればよく、変えなくてよい。
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const SUFFIX = '.dev';
const DEV_APP_NAME = 'すく開発';
const DEV_ICON_BACKGROUND = '#37474F';

// main の mipmap-anydpi-v26/ic_launcher(_round).xml と同じ形で、背景だけ色にしたもの。
const DEV_ADAPTIVE_ICON = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/devIconBackground"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`;

function addApplicationIdSuffix(gradle) {
  if (gradle.includes(`applicationIdSuffix "${SUFFIX}"`)) return gradle;
  const debugBuildType = /(buildTypes\s*\{\s*debug\s*\{)/;
  if (!debugBuildType.test(gradle)) {
    throw new Error('withDevVariant: build.gradle に buildTypes { debug { が見つからない');
  }
  return gradle.replace(debugBuildType, `$1\n            applicationIdSuffix "${SUFFIX}"`);
}

module.exports = function withDevVariant(config) {
  config = withAppBuildGradle(config, (c) => {
    c.modResults.contents = addApplicationIdSuffix(c.modResults.contents);
    return c;
  });
  // debugのソースセットに置いたリソースは、同名の main のリソースを上書きする。
  return withDangerousMod(config, [
    'android',
    (c) => {
      const res = path.join(c.modRequest.platformProjectRoot, 'app/src/debug/res');
      const write = (rel, content) => {
        fs.mkdirSync(path.dirname(path.join(res, rel)), { recursive: true });
        fs.writeFileSync(path.join(res, rel), content);
      };
      write(
        'values/strings.xml',
        `<resources>\n  <string name="app_name">${DEV_APP_NAME}</string>\n</resources>\n`,
      );
      write(
        'values/colors.xml',
        `<resources>\n  <color name="devIconBackground">${DEV_ICON_BACKGROUND}</color>\n</resources>\n`,
      );
      write('mipmap-anydpi-v26/ic_launcher.xml', DEV_ADAPTIVE_ICON);
      write('mipmap-anydpi-v26/ic_launcher_round.xml', DEV_ADAPTIVE_ICON);
      return c;
    },
  ]);
};
