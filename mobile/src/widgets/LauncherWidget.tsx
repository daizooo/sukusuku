import { appLink } from '@/lib/appLinks';
import { colors } from '@/lib/theme';
import type { TabId } from '@/types/app';
import { ActionButton, ButtonRow, WidgetFrame } from './parts';
import type { WidgetIconName } from './icons';

// A. 4タブのランチャー（docs/widgets.md §2.1）。押したタブでアプリを開く（最初のタブの設定に関係なく）。
// データは読まないので、ログインしていなくても圏外でも同じように出る。
// 横長（4×1）なら横一列、正方形に近い（2×2）なら2段に並べる。
// 育児・家計と1つにまとめたもの（CombinedWidgets.tsx）では、上の1段（TabsRow）として使う。

const TABS: { tab: TabId; icon: WidgetIconName; label: string }[] = [
  { tab: 'schedule', icon: 'schedule', label: '予定' },
  { tab: 'list', icon: 'list', label: 'ToDo' },
  { tab: 'care', icon: 'care', label: '育児' },
  { tab: 'money', icon: 'money', label: '家計' },
];

const button = ({ tab, icon, label }: (typeof TABS)[number]) => (
  <ActionButton
    key={tab}
    icon={icon}
    label={label}
    uri={appLink(tab)}
    color={colors.navActive}
    surface={colors.neutralSurface}
  />
);

/** 4タブを横一列に並べた1段。 */
export function TabsRow() {
  return <ButtonRow>{TABS.map(button)}</ButtonRow>;
}

export function LauncherWidget({ width, height }: { width: number; height: number }) {
  const twoRows = width < height * 2;
  return (
    <WidgetFrame padding={8} gap={6}>
      {twoRows
        ? [
            <ButtonRow key="top">{TABS.slice(0, 2).map(button)}</ButtonRow>,
            <ButtonRow key="bottom">{TABS.slice(2).map(button)}</ButtonRow>,
          ]
        : <TabsRow />}
    </WidgetFrame>
  );
}
