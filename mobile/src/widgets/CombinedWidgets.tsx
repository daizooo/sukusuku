import { CareRow } from './CareWidget';
import { TabsRow } from './LauncherWidget';
import { MoneyRow } from './MoneyWidget';
import { WidgetFrame } from './parts';
import type { CareWidgetData, WidgetData } from './widgetData';

// タブ（4×1）に育児・家計の段を重ねた、1つにまとめたウィジェット（docs/widgets.md §2.4）。
// 段の中身は単体のウィジェット（TabLauncher・CareQuick・MoneyQuick）とまったく同じで、
// 1段ぶんずつ縦に積むだけ（タブ＋育児＋家計は4×3、タブ＋育児・タブ＋家計は4×2）。

/** タブ＋育児＋家計（4×3）。 */
export function TabsCareMoneyWidget({ care }: { care: WidgetData<CareWidgetData> }) {
  return (
    <WidgetFrame padding={8} gap={6}>
      <TabsRow />
      <CareRow data={care} />
      <MoneyRow />
    </WidgetFrame>
  );
}

/** タブ＋育児（4×2）。 */
export function TabsCareWidget({ care }: { care: WidgetData<CareWidgetData> }) {
  return (
    <WidgetFrame padding={8} gap={6}>
      <TabsRow />
      <CareRow data={care} />
    </WidgetFrame>
  );
}

/** タブ＋家計（4×2）。 */
export function TabsMoneyWidget() {
  return (
    <WidgetFrame padding={8} gap={6}>
      <TabsRow />
      <MoneyRow />
    </WidgetFrame>
  );
}
