// ウィジェットの名前。app.config.js の react-native-android-widget の widgets[].name と同じにする
// （Androidの部品のクラス名になるので、英数字だけ）。docs/widgets.md §2。
export const WIDGET_NAMES = {
  launcher: 'TabLauncher',
  care: 'CareQuick',
  money: 'MoneyQuick',
  list: 'ListItems',
} as const;

export type WidgetName = (typeof WIDGET_NAMES)[keyof typeof WIDGET_NAMES];
