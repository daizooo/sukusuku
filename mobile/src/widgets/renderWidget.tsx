import type { WidgetInfo } from 'react-native-android-widget';
import { CareWidget } from './CareWidget';
import { LauncherWidget } from './LauncherWidget';
import { MoneyWidget } from './MoneyWidget';
import { WIDGET_NAMES } from './widgetNames';
import { loadCareWidgetData } from './widgetData';

/**
 * ウィジェット1つぶんの絵を作る。中身を読むのは育児だけ（読めなければ目安の代わりに一言）。
 * 知らない名前（古い版で置いたもの。ToDo・買い物は2026-10-14にやめた）は null。
 */
export async function renderWidget({ widgetName, width, height }: Pick<WidgetInfo, 'widgetName' | 'width' | 'height'>) {
  switch (widgetName) {
    case WIDGET_NAMES.launcher:
      return <LauncherWidget width={width} height={height} />;
    case WIDGET_NAMES.care:
      return <CareWidget data={await loadCareWidgetData()} />;
    case WIDGET_NAMES.money:
      return <MoneyWidget />;
    default:
      return null;
  }
}
