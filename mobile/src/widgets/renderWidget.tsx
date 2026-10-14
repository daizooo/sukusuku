import type { WidgetInfo } from 'react-native-android-widget';
import { CareWidget } from './CareWidget';
import { LauncherWidget } from './LauncherWidget';
import { ListItemsWidget } from './ListItemsWidget';
import { MoneyWidget } from './MoneyWidget';
import { WIDGET_NAMES } from './widgetNames';
import {
  loadCareWidgetData,
  loadListWidgetData,
  loadMoneyWidgetData,
  readWidgetHideAmounts,
} from './widgetData';

/**
 * ウィジェット1つぶんの絵を作る。中身を読んでから描く（読めなければボタンだけと一言）。
 * 知らない名前（古い版で置いたものなど）は null。
 */
export async function renderWidget({ widgetName, width, height }: Pick<WidgetInfo, 'widgetName' | 'width' | 'height'>) {
  switch (widgetName) {
    case WIDGET_NAMES.launcher:
      return <LauncherWidget width={width} height={height} />;
    case WIDGET_NAMES.care:
      return <CareWidget data={await loadCareWidgetData()} />;
    case WIDGET_NAMES.money: {
      const hideAmounts = await readWidgetHideAmounts();
      // 隠すなら金額は読まない（読んでも出さないため）。
      const data = hideAmounts ? ({ ok: false, error: 'offline' } as const) : await loadMoneyWidgetData();
      return <MoneyWidget data={data} hideAmounts={hideAmounts} />;
    }
    case WIDGET_NAMES.list:
      return <ListItemsWidget data={await loadListWidgetData()} height={height} />;
    default:
      return null;
  }
}
