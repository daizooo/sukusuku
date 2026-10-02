// versionCodeはCIがビルドごとに渡す（.github/workflows/mobile-apk.yml のANDROID_VERSION_CODE）。
// 手元のnpm start / npm run androidでは未設定なので1のまま。
// 固定していたときはFirebase App Distributionの表示が毎回「0.1.0 (1)」のまま
// 変わらず、更新されたビルドかどうか見分けられなかった。
const versionCode = process.env.ANDROID_VERSION_CODE
  ? parseInt(process.env.ANDROID_VERSION_CODE, 10)
  : 1;

module.exports = {
  expo: {
    name: 'かぞく手帳',
    slug: 'sukusuku',
    scheme: 'sukusuku',
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    newArchEnabled: true,
    android: {
      package: 'com.sukusuku.app',
      versionCode,
      adaptiveIcon: {
        backgroundColor: '#ffffff',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      predictiveBackGestureEnabled: false,
      googleServicesFile: './google-services.json',
    },
    plugins: [
      'expo-router',
      [
        'expo-notifications',
        {
          color: '#CE6B74',
          icon: './assets/notification-icon.png',
          defaultChannel: 'task-reminder',
        },
      ],
      './plugins/withDevVariant',
    ],
  },
};
