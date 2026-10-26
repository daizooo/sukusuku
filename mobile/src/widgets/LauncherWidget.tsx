import { appLink } from '@/lib/appLinks';
import type { TabId } from '@/types/app';
import { ActionButton, ButtonRow, DENSITY, WidgetFrame, type WidgetDensity } from './parts';
import type { WidgetIconName } from './icons';
import type { WidgetPalette } from './widgetPalette';

// A. 4タブのランチャー（docs/widgets.md §2.1）。押したタブでアプリを開く（最初のタブの設定に関係なく）。
// データは読まないので、ログインしていなくても圏外でも同じように出る。
// 白の地に、四角を持たない灰色のアイコンを並べる（下のタブバーと同じ「移動」の見た目。育児・家計の色の段と区別する）。
// 横長（4×1）なら横一列、正方形に近い（2×2）なら2段に並べる。
// 育児・家計と1つにまとめたもの（CombinedWidgets.tsx）では、上の1段（TabsRow）として使う。

const TABS: { tab: TabId; icon: WidgetIconName; label: string }[] = [
  { tab: 'schedule', icon: 'schedule', label: '予定' },
  { tab: 'list', icon: 'list', label: 'リスト' },
  { tab: 'care', icon: 'care', label: '育児' },
  { tab: 'money', icon: 'money', label: '家計' },
];

const button = (
  { tab, icon, label }: (typeof TABS)[number],
  palette: WidgetPalette,
  density: WidgetDensity = 'normal',
) => (
  <ActionButton
    key={tab}
    icon={icon}
    label={label}
    uri={appLink(tab)}
    color={palette.tabs.icon}
    palette={palette}
    variant="plain"
    density={density}
  />
);

/** 4タブを横一列に並べた1段。 */
export function TabsRow({ palette, density = 'normal' }: { palette: WidgetPalette; density?: WidgetDensity }) {
  return (
    <ButtonRow gap={density === 'normal' ? undefined : DENSITY[density].groupGap}>
      {TABS.map((tab) => button(tab, palette, density))}
    </ButtonRow>
  );
}

export function LauncherWidget({ width, height, palette }: { width: number; height: number; palette: WidgetPalette }) {
  const twoRows = width < height * 2;
  return (
    <WidgetFrame palette={palette} tone="tabs">
      {twoRows
        ? [
            <ButtonRow key="top">{TABS.slice(0, 2).map((tab) => button(tab, palette))}</ButtonRow>,
            <ButtonRow key="bottom">{TABS.slice(2).map((tab) => button(tab, palette))}</ButtonRow>,
          ]
        : <TabsRow palette={palette} />}
    </WidgetFrame>
  );
}
