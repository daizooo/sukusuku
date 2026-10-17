import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { renderWidget } from './renderWidget';
import { REFRESH_WIDGET_ACTION } from './parts';

// ホーム画面のウィジェットの裏の処理（docs/widgets.md §3）。アプリを開かずに動くので、
// 画面より先にアプリの入口（index.ts）で登録する。
//
// 置いたとき・30分ごと（app.config.js の updatePeriodMillis）・大きさを変えたとき・
// 次の目安の欄を押したとき（REFRESH_WIDGET_ACTION）に描き直す。
// ほかのボタンの押したときの動きはリンク（OPEN_URI）で、この処理には来ない。
async function widgetTaskHandler({ widgetInfo, widgetAction, clickAction, renderWidget: draw }: WidgetTaskHandlerProps) {
  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const widget = await renderWidget(widgetInfo);
      if (widget) draw(widget);
      break;
    }
    case 'WIDGET_CLICK': {
      if (clickAction !== REFRESH_WIDGET_ACTION) break;
      const widget = await renderWidget(widgetInfo);
      if (widget) draw(widget);
      break;
    }
    default:
      break;
  }
}

registerWidgetTaskHandler(widgetTaskHandler);
