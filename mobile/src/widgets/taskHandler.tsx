import { registerWidgetTaskHandler, type WidgetTaskHandlerProps } from 'react-native-android-widget';
import { renderWidget } from './renderWidget';

// ホーム画面のウィジェットの裏の処理（docs/widgets.md §3）。アプリを開かずに動くので、
// 画面より先にアプリの入口（index.ts）で登録する。
//
// 置いたとき・30分ごと（app.config.js の updatePeriodMillis）・大きさを変えたときに描き直す。
// 押したときの動きはすべてリンク（OPEN_URI）で、この処理には来ない。
async function widgetTaskHandler({ widgetInfo, widgetAction, renderWidget: draw }: WidgetTaskHandlerProps) {
  switch (widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED': {
      const widget = await renderWidget(widgetInfo);
      if (widget) draw(widget);
      break;
    }
    default:
      break;
  }
}

registerWidgetTaskHandler(widgetTaskHandler);
