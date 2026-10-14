import { FlexWidget } from 'react-native-android-widget';
import { appLink } from '@/lib/appLinks';
import { colors } from '@/lib/theme';
import type { TabId } from '@/types/app';
import { ActionButton, hex } from './parts';
import type { WidgetIconName } from './icons';

// A. 4タブのランチャー（docs/widgets.md §2.1）。押したタブでアプリを開く（最初のタブの設定に関係なく）。
// データは読まないので、ログインしていなくても圏外でも同じように出る。
// 横長（4×1）なら横一列、正方形に近い（2×2）なら2段に並べる。

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

const row = (children: React.ReactNode) => (
  <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>{children}</FlexWidget>
);

export function LauncherWidget({ width, height }: { width: number; height: number }) {
  const twoRows = width < height * 2;
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: hex(colors.surface),
        borderRadius: 20,
        borderWidth: 1,
        borderColor: hex(colors.border),
        padding: 8,
        flexGap: 6,
      }}
    >
      {twoRows ? [row(TABS.slice(0, 2).map(button)), row(TABS.slice(2).map(button))] : row(TABS.map(button))}
    </FlexWidget>
  );
}
