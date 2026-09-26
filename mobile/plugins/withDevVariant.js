// 開発ビルド(debug)を正式版と別アプリとして並べて入れられるようにする。
//
// 正式版(CIの assembleRelease)は com.sukusuku.app のまま。debugビルドだけ
// パッケージ名に .dev を足し、ホーム画面の名前も変える。こうしないと、家族へ
// 配った正式版が入っている端末に npm run android で開発ビルドを入れようとした
// ときに、同じパッケージの「ダウングレード」として拒否され、正式版を消すしかなくなる。
//
// 通知(FCM)は google-services.json に com.sukusuku.app.dev のクライアントが
// 無いとdebugビルドが通らない。Firebaseに同名のAndroidアプリを足してから
// 取り直した google-services.json を置く（取り方は docs/notifications.md §11）。
// CIの GOOGLE_SERVICES_JSON は正式版のクライアントさえ入っていればよく、変えなくてよい。
const fs = require('fs');
const path = require('path');
const { withAppBuildGradle, withDangerousMod } = require('expo/config-plugins');

const SUFFIX = '.dev';
const DEV_APP_NAME = 'すくすく開発';

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
  // debugのソースセットに置いた文字列リソースは main の app_name を上書きする。
  return withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/debug/res/values');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'strings.xml'),
        `<resources>\n  <string name="app_name">${DEV_APP_NAME}</string>\n</resources>\n`,
      );
      return c;
    },
  ]);
};
