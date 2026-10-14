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
      // どれも4×1の1段。previewImage はウィジェットの追加画面に出す見本（無いと全部アプリのアイコンになる）。
      // 中身を出す育児（次の目安）だけ30分ごと（Androidの最短）に描き直す。アプリを閉じたときにも描き直す。
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
              previewImage: './assets/widget-preview/tablauncher.png',
            },
            {
              name: 'CareQuick',
              label: '育児',
              description: '次の授乳の目安と、授乳・おむつ・体温の入力',
              minWidth: '250dp',
              minHeight: '40dp',
              targetCellWidth: 4,
              targetCellHeight: 1,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
              previewImage: './assets/widget-preview/carequick.png',
            },
            {
              name: 'MoneyQuick',
              label: '家計',
              description: '支出・収入・振替・レシートの入力',
              minWidth: '250dp',
              minHeight: '40dp',
              targetCellWidth: 4,
              targetCellHeight: 1,
              resizeMode: 'horizontal|vertical',
              previewImage: './assets/widget-preview/moneyquick.png',
            },
            // タブに育児・家計の段を重ねたもの。段の中身は上の3つと同じ。
            {
              name: 'TabsCareMoney',
              label: 'タブ＋育児＋家計',
              description: '4タブ・育児・家計の3段',
              minWidth: '250dp',
              minHeight: '180dp',
              targetCellWidth: 4,
              targetCellHeight: 3,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
              previewImage: './assets/widget-preview/tabscaremoney.png',
            },
            {
              name: 'TabsCare',
              label: 'タブ＋育児',
              description: '4タブ・育児の2段',
              minWidth: '250dp',
              minHeight: '110dp',
              targetCellWidth: 4,
              targetCellHeight: 2,
              resizeMode: 'horizontal|vertical',
              updatePeriodMillis: 1800000,
              previewImage: './assets/widget-preview/tabscare.png',
            },
            {
              name: 'TabsMoney',
              label: 'タブ＋家計',
              description: '4タブ・家計の2段',
              minWidth: '250dp',
              minHeight: '110dp',
              targetCellWidth: 4,
              targetCellHeight: 2,
              resizeMode: 'horizontal|vertical',
              previewImage: './assets/widget-preview/tabsmoney.png',
            },
          ],
        },
      ],
    ],
  },
};
