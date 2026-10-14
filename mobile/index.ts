// アプリの入口。お知らせのボタンの裏の処理は、画面より先にここで定める
// （アプリが閉じている間は画面を読まずにこの入口だけが読まれる。src/lib/notificationActionTask.ts）。
import './src/lib/notificationActionTask';
import 'expo-router/entry';
