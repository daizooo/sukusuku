import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import { colors } from '@/lib/theme';
import { widgetIcon, type WidgetIconName } from './icons';

// ウィジェットの共通の部品（docs/widgets.md §2）。
//
// 色はアプリの配色（src/lib/theme.ts）をそのまま使う。アプリはライトだけ（app.config.js の
// userInterfaceStyle: 'light'）なので、ウィジェットも端末がダークモードでもライトのまま描く
// （ダーク用の絵は渡さない。ルートの CLAUDE.md の「配色」）。

const hex = (value: string) => value as ColorProp;

/** ウィジェットの外枠。白の地に薄い枠線（アプリのカードと同じ）。中はボタンを横に並べた1段（4×1）。 */
export function WidgetFrame({ children, gap = 8, padding = 12 }: { children: React.ReactNode; gap?: number; padding?: number }) {
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
        padding,
        flexGap: gap,
      }}
    >
      {children}
    </FlexWidget>
  );
}

/** 押すと入力画面などを開く四角いボタン（アイコン＋短い名前）。 */
export function ActionButton({
  icon,
  label,
  uri,
  color,
  surface,
}: {
  icon: WidgetIconName;
  label: string;
  uri: string;
  color: string;
  surface: string;
}) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        height: 'match_parent',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: hex(surface),
        borderRadius: 14,
        paddingVertical: 6,
        flexGap: 2,
      }}
    >
      <SvgWidget svg={widgetIcon(icon, color)} style={{ width: 22, height: 22 }} />
      <TextWidget text={label} maxLines={1} style={{ fontSize: 11, fontWeight: '700', color: hex(color) }} />
    </FlexWidget>
  );
}

/** ボタンを横に並べる行。残りの高さをすべて使う。 */
export function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'row', flexGap: 6 }}>{children}</FlexWidget>
  );
}

export { hex };
