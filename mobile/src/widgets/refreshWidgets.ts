import { widgetsAvailable } from './availability';

// アプリから、ホーム画面のウィジェットを描き直す（docs/widgets.md §3.3）。
// 30分ごとの描き直しだけだと、アプリで記録した直後のウィジェットが古いままに見えるため、
// アプリを開く・閉じる（前面へ戻す・背面へ回す）たびに呼ぶ。中身を出すウィジェット（育児の次の目安を出すもの）だけ。
// ウィジェットの部品は Expo Go に無いので、使えるときだけ読み込む（availability.ts）。

export async function refreshWidgets(): Promise<void> {
  await requestUpdates('content');
}

/**
 * 置いてあるウィジェットをすべて描き直す。配色（ライト・ダーク。docs/widgets.md §2.6）を切り替えたとき用で、
 * 中身を出さないウィジェット（タブ・家計）も新しい配色にする。
 */
export async function refreshAllWidgets(): Promise<void> {
  await requestUpdates('all');
}

async function requestUpdates(scope: 'content' | 'all'): Promise<void> {
  if (!widgetsAvailable) return;
  const { requestWidgetUpdate } = require('react-native-android-widget') as typeof import('react-native-android-widget');
  const { renderWidget } = require('./renderWidget') as typeof import('./renderWidget');
  const { WIDGET_NAMES } = require('./widgetNames') as typeof import('./widgetNames');
  const names =
    scope === 'all'
      ? Object.values(WIDGET_NAMES)
      : [
          WIDGET_NAMES.care,
          WIDGET_NAMES.tabsCareMoney,
          WIDGET_NAMES.tabsCare,
          WIDGET_NAMES.tabsCareMoneyTight,
          WIDGET_NAMES.tabsCareMoneyInline,
        ];
  await Promise.all(
    names.map((widgetName) =>
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
