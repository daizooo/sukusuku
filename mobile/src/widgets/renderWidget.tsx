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
import { widgetPalette } from './widgetPalette';
import { loadWidgetThemeMode } from '@/lib/widgetThemeSetting';
import { WIDGET_NAMES } from './widgetNames';
import { loadCareWidgetData, type CareWidgetData, type WidgetData } from './widgetData';

/**
 * ウィジェット1つぶんの絵を作る。中身を読むのは育児だけ（読めなければ目安の代わりに一言）。
 * 知らない名前（古い版で置いたもの。ToDo・買い物は2026-10-14にやめた）は null。
 * 配色はこの端末の設定（ライト・ダーク。docs/widgets.md §2.6）を描くたびに読む。
 * care を渡すと読まずにそれを出す（押して更新したときの「更新中…」）。
 */
export async function renderWidget(
  { widgetName, width, height }: Pick<WidgetInfo, 'widgetName' | 'width' | 'height'>,
  care?: WidgetData<CareWidgetData>,
) {
  const palette = widgetPalette(await loadWidgetThemeMode());
  const loadCare = () => (care ? Promise.resolve(care) : loadCareWidgetData());
  switch (widgetName) {
    case WIDGET_NAMES.launcher:
      return <LauncherWidget width={width} height={height} palette={palette} />;
    case WIDGET_NAMES.care:
      return <CareWidget data={await loadCare()} palette={palette} />;
    case WIDGET_NAMES.money:
      return <MoneyWidget palette={palette} />;
    case WIDGET_NAMES.tabsCareMoney:
      return <TabsCareMoneyWidget care={await loadCare()} palette={palette} />;
    case WIDGET_NAMES.tabsCare:
      return <TabsCareWidget care={await loadCare()} palette={palette} />;
    case WIDGET_NAMES.tabsMoney:
      return <TabsMoneyWidget palette={palette} />;
    case WIDGET_NAMES.tabsCareMoneyTight:
      return <TabsCareMoneyTightWidget care={await loadCare()} palette={palette} />;
    case WIDGET_NAMES.tabsCareMoneyInline:
      return <TabsCareMoneyInlineWidget care={await loadCare()} palette={palette} />;
    default:
      return null;
  }
}
