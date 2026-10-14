// アプリの入口。お知らせのボタンの裏の処理は、画面より先にここで定める
// （アプリが閉じている間は画面を読まずにこの入口だけが読まれる。src/lib/notificationActionTask.ts）。
import './src/lib/notificationActionTask';
import { widgetsAvailable } from './src/widgets/availability';
import 'expo-router/entry';

// ホーム画面のウィジェットの裏の処理も同じ理由でここで定める（src/widgets/taskHandler.tsx）。
// Expo Go では部品が無く読み込むだけで落ちるので、使えるときだけ読む。
if (widgetsAvailable) require('./src/widgets/taskHandler');
