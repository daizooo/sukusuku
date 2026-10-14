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
      // ホーム画面のウィジェット（docs/widgets.md）。name は src/widgets/widgetNames.ts と同じにする。
      // 中身を出すものは30分ごと（Androidの最短）に描き直す。アプリを閉じたときにも描き直す。
      [
        'react-native-android-widget',
        {
          widgets: [
            {
              name: 'TabLauncher',
              label: 'タブ',
              description: '予定・ToDo・育児・家計をワンタップで開く',
              minWidth: '250dp',
              minHeight: '40dp',
              targetCellWidth: 4,
              targetCellHeight: 1,
              resizeMode: 'horizontal|vertical',
            },
            {
              name: 'CareQuick',
              label: '育児',
              description: '前回の授乳・次の目安と、授乳・おむつ・搾乳・体温の入力',
              minWidth: '250dp',
              minHeight: '110dp',
              targetCellWidth: 4,
              targetCellHeight: 2,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
            },
            {
              name: 'MoneyQuick',
              label: '家計',
              description: '今月・今日の支出と、支出・収入・振替・レシートの入力',
              minWidth: '250dp',
              minHeight: '110dp',
              targetCellWidth: 4,
              targetCellHeight: 2,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
            },
            {
              name: 'ListItems',
              label: 'ToDo・買い物',
              description: 'リストのまだ済んでいない項目',
              minWidth: '110dp',
              minHeight: '110dp',
              targetCellWidth: 2,
              targetCellHeight: 2,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
            },
          ],
        },
      ],
    ],
  },
};
