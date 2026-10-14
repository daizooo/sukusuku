import { widgetsAvailable } from './availability';

// アプリから、ホーム画面のウィジェットを描き直す（docs/widgets.md §3.3）。
// 30分ごとの描き直しだけだと、アプリで記録した直後のウィジェットが古いままに見えるため、
// アプリを閉じる（背面へ回す）たびに呼ぶ。中身を出すウィジェット（育児・家計・リスト）だけ。
// ウィジェットの部品は Expo Go に無いので、使えるときだけ読み込む（availability.ts）。

export async function refreshWidgets(): Promise<void> {
  if (!widgetsAvailable) return;
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { renderWidget } = require('./renderWidget') as typeof import('./renderWidget');
  const { WIDGET_NAMES } = require('./widgetNames') as typeof import('./widgetNames');
  await Promise.all(
    [WIDGET_NAMES.care, WIDGET_NAMES.money, WIDGET_NAMES.list].map((widgetName) =>
      requestWidgetUpdate({
        widgetName,
        renderWidget: async (info) => {
          const widget = await renderWidget(info);
          if (!widget) throw new Error(`Unknown widget: ${info.widgetName}`);
          return widget;
        },
      }).catch(() => {
        // 描き直せなくても、30分ごとの描き直しで追いつく。
      }),
    ),
  );
}
