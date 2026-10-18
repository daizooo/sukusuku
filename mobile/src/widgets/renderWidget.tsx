import type { WidgetInfo } from 'react-native-android-widget';
import { CareWidget } from './CareWidget';
import {
  TabsCareMoneyInlineWidget,
  TabsCareMoneyTightWidget,
  TabsCareMoneyWidget,
  TabsCareWidget,
  TabsMoneyWidget,
} from './CombinedWidgets';
import { LauncherWidget } from './LauncherWidget';
import { MoneyWidget } from './MoneyWidget';
import { WIDGET_NAMES } from './widgetNames';
import { loadCareWidgetData, type CareWidgetData, type WidgetData } from './widgetData';

/**
 * ウィジェット1つぶんの絵を作る。中身を読むのは育児だけ（読めなければ目安の代わりに一言）。
 * 知らない名前（古い版で置いたもの。ToDo・買い物は2026-10-14にやめた）は null。
 * care を渡すと読まずにそれを出す（押して更新したときの「更新中…」）。
 */
export async function renderWidget(
  { widgetName, width, height }: Pick<WidgetInfo, 'widgetName' | 'width' | 'height'>,
  care?: WidgetData<CareWidgetData>,
) {
  const loadCare = () => (care ? Promise.resolve(care) : loadCareWidgetData());
  switch (widgetName) {
    case WIDGET_NAMES.launcher:
      return <LauncherWidget width={width} height={height} />;
    case WIDGET_NAMES.care:
      return <CareWidget data={await loadCare()} />;
    case WIDGET_NAMES.money:
      return <MoneyWidget />;
    case WIDGET_NAMES.tabsCareMoney:
      return <TabsCareMoneyWidget care={await loadCare()} />;
    case WIDGET_NAMES.tabsCare:
      return <TabsCareWidget care={await loadCare()} />;
    case WIDGET_NAMES.tabsMoney:
      return <TabsMoneyWidget />;
    case WIDGET_NAMES.tabsCareMoneyTight:
      return <TabsCareMoneyTightWidget care={await loadCare()} />;
    case WIDGET_NAMES.tabsCareMoneyInline:
      return <TabsCareMoneyInlineWidget care={await loadCare()} />;
    default:
      return null;
  }
}
