import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import { colors } from '@/lib/theme';
import { widgetIcon, type WidgetIconName } from './icons';

// ウィジェットの共通の部品（docs/widgets.md §2）。
//
// 色はアプリの配色（src/lib/theme.ts）をそのまま使う。アプリはライトだけ（app.config.js の
// userInterfaceStyle: 'light'）なので、ウィジェットも端末がダークモードでもライトのまま描く
// （ダーク用の絵は渡さない。ルートの CLAUDE.md の「配色」）。
//
// まとまり（タブ・育児・家計）ごとに地の色を決め、単体でも重ねても、どこからどこまでが
// どのまとまりかが分かるようにする（2026-10-14。全部が淡い色の四角で見分けられなかった）。
// - タブ: 白の地に、四角を持たない灰色のアイコン（下のタブバーと同じ「移動」の見た目）
// - 育児: 琥珀の地（記録の授乳の色）に、白い四角のボタン
// - 家計: 青の地（家計タブの差し色）に、白い四角のボタン

const hex = (value: string) => value as ColorProp;

export type WidgetTone = 'tabs' | 'care' | 'money';

/**
 * 寸法の段階（docs/widgets.md §2.4）。normal はふだんの大きさ（4×1の1段が基準）。
 * tight・inline は3段（タブ＋育児＋家計）を4×2（高さ110dp）に収めるため、余白と大きさを詰めたもの。
 * - tight: アイコンの下に名前のまま、外側の余白と隙間を詰める（アイコン14・名前10sp）
 * - inline: アイコンと名前を横に並べて、同じ高さのまま文字とアイコンを大きく保つ（アイコン16・名前11sp）
 */
export type WidgetDensity = 'normal' | 'tight' | 'inline';

export const DENSITY: Record<
  WidgetDensity,
  {
    framePadding: number;
    frameGap: number;
    groupPadding: number;
    groupGap: number;
    groupRadius: number;
    buttonRadius: number;
    /** ボタンの中で、アイコンと名前を縦に並べるか横に並べるか。 */
    direction: 'column' | 'row';
    buttonGap: number;
    buttonPaddingVertical: number;
    icon: number;
    label: number;
  }
> = {
  normal: {
    framePadding: 6, frameGap: 6, groupPadding: 4, groupGap: 4, groupRadius: 16, buttonRadius: 12,
    direction: 'column', buttonGap: 2, buttonPaddingVertical: 4, icon: 22, label: 11,
  },
  tight: {
    framePadding: 4, frameGap: 3, groupPadding: 2, groupGap: 3, groupRadius: 13, buttonRadius: 9,
    direction: 'column', buttonGap: 1, buttonPaddingVertical: 0, icon: 14, label: 10,
  },
  inline: {
    framePadding: 4, frameGap: 3, groupPadding: 2, groupGap: 3, groupRadius: 13, buttonRadius: 9,
    direction: 'row', buttonGap: 3, buttonPaddingVertical: 0, icon: 16, label: 11,
  },
};

/** まとまりの地と枠の色。 */
export const TONES: Record<WidgetTone, { surface: string; border: string }> = {
  tabs: { surface: colors.surface, border: colors.border },
  // 白いボタンが浮いて見え、隣の段と見分けがつく濃さ（100番台）にする。
  care: { surface: colors.milkBadge, border: colors.milkBorder },
  money: { surface: colors.moneySoft, border: colors.diaperBorder },
};

/**
 * ウィジェットの外枠。単体のときはそのまとまりの地の色で塗る。
 * 重ねたもの（CombinedWidgets.tsx）は白の地で、育児・家計の段がそれぞれ自分の地（GroupBox）を持つ。
 */
export function WidgetFrame({
  children,
  tone = 'tabs',
  density = 'normal',
}: {
  children: React.ReactNode;
  tone?: WidgetTone;
  density?: WidgetDensity;
}) {
  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: hex(TONES[tone].surface),
        borderRadius: 20,
        borderWidth: 1,
        borderColor: hex(TONES[tone].border),
        padding: DENSITY[density].framePadding,
        flexGap: DENSITY[density].frameGap,
      }}
    >
      {children}
    </FlexWidget>
  );
}

/** 重ねたものの中の1段ぶんの地（育児・家計）。 */
export function GroupBox({
  children,
  tone,
  density = 'normal',
}: {
  children: React.ReactNode;
  tone: WidgetTone;
  density?: WidgetDensity;
}) {
  return (
    <FlexWidget
      style={{
        flex: 1,
        width: 'match_parent',
        flexDirection: 'row',
        backgroundColor: hex(TONES[tone].surface),
        borderRadius: DENSITY[density].groupRadius,
        borderWidth: 1,
        borderColor: hex(TONES[tone].border),
        padding: DENSITY[density].groupPadding,
        flexGap: DENSITY[density].groupGap,
      }}
    >
      {children}
    </FlexWidget>
  );
}

/**
 * 押すと入力画面などを開くボタン（アイコン＋短い名前）。
 * tile は白い四角（育児・家計の地の上に置く）、plain は四角を持たない（タブ）。
 */
export function ActionButton({
  icon,
  label,
  uri,
  color,
  labelColor = color,
  variant = 'tile',
  density = 'normal',
}: {
  icon: WidgetIconName;
  label: string;
  uri: string;
  color: string;
  labelColor?: string;
  variant?: 'tile' | 'plain';
  density?: WidgetDensity;
}) {
  const d = DENSITY[density];
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      accessibilityLabel={label}
      style={{
        flex: 1,
        height: 'match_parent',
        flexDirection: d.direction,
        alignItems: 'center',
        justifyContent: 'center',
        ...(variant === 'tile' && { backgroundColor: hex(colors.surface), borderRadius: d.buttonRadius }),
        paddingVertical: d.buttonPaddingVertical,
        flexGap: d.buttonGap,
      }}
    >
      <SvgWidget svg={widgetIcon(icon, color)} style={{ width: d.icon, height: d.icon }} />
      <TextWidget text={label} maxLines={1} style={{ fontSize: d.label, fontWeight: '700', color: hex(labelColor) }} />
    </FlexWidget>
  );
}

/** ボタンを横に並べる行（地を持たない）。残りの高さをすべて使う。 */
export function ButtonRow({ children, gap = 4 }: { children: React.ReactNode; gap?: number }) {
  return (
    <FlexWidget style={{ flex: 1, width: 'match_parent', flexDirection: 'row', flexGap: gap }}>{children}</FlexWidget>
  );
}

export { hex };
