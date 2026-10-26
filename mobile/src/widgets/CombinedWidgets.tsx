import { CareRow } from './CareWidget';
import { TabsRow } from './LauncherWidget';
import { MoneyRow } from './MoneyWidget';
import { WidgetFrame } from './parts';
import type { CareWidgetData, WidgetData } from './widgetData';
import type { WidgetPalette } from './widgetPalette';

// タブ（4×1）に育児・家計の段を重ねた、1つにまとめたウィジェット（docs/widgets.md §2.4）。
// 段の中身は単体のウィジェット（TabLauncher・CareQuick・MoneyQuick）とまったく同じで、
// 1段ぶんずつ縦に積むだけ（タブ＋育児＋家計は4×3、タブ＋育児・タブ＋家計は4×2）。
// 外枠は白で、育児・家計の段はそれぞれ自分の地の色を持つ（どこからどこまでがどのまとまりか分かるように）。

/** タブ＋育児＋家計（4×3）。 */
export function TabsCareMoneyWidget({ care, palette }: { care: WidgetData<CareWidgetData>; palette: WidgetPalette }) {
  return (
    <WidgetFrame palette={palette}>
      <TabsRow palette={palette} />
      <CareRow data={care} palette={palette} />
      <MoneyRow palette={palette} />
    </WidgetFrame>
  );
}

/** タブ＋育児（4×2）。 */
export function TabsCareWidget({ care, palette }: { care: WidgetData<CareWidgetData>; palette: WidgetPalette }) {
  return (
    <WidgetFrame palette={palette}>
      <TabsRow palette={palette} />
      <CareRow data={care} palette={palette} />
    </WidgetFrame>
  );
}

/** タブ＋家計（4×2）。 */
export function TabsMoneyWidget({ palette }: { palette: WidgetPalette }) {
  return (
    <WidgetFrame palette={palette}>
      <TabsRow palette={palette} />
      <MoneyRow palette={palette} />
    </WidgetFrame>
  );
}

// 3段を4×2（高さ110dp）に収める、余白と大きさを詰めた2つ（docs/widgets.md §2.4）。4×3のものはそのまま残してある。
// 段の中身（ボタンと飛び先）は4×3と同じで、寸法だけが違う（parts.tsx の DENSITY）。

/** タブ＋育児＋家計（4×2・縦詰め）。アイコンの下に名前のまま、余白と隙間を詰める。 */
export function TabsCareMoneyTightWidget({ care, palette }: { care: WidgetData<CareWidgetData>; palette: WidgetPalette }) {
  return (
    <WidgetFrame palette={palette} density="tight">
      <TabsRow palette={palette} density="tight" />
      <CareRow data={care} palette={palette} density="tight" />
      <MoneyRow palette={palette} density="tight" />
    </WidgetFrame>
  );
}

/** タブ＋育児＋家計（4×2・横並び）。アイコンと名前を横に並べて、同じ高さのまま文字とアイコンを大きく保つ。 */
export function TabsCareMoneyInlineWidget({ care, palette }: { care: WidgetData<CareWidgetData>; palette: WidgetPalette }) {
  return (
    <WidgetFrame palette={palette} density="inline">
      <TabsRow palette={palette} density="inline" />
      <CareRow data={care} palette={palette} density="inline" />
      <MoneyRow palette={palette} density="inline" />
    </WidgetFrame>
  );
}
