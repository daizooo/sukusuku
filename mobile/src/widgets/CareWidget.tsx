import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { appLink, OPEN_LOG_PARAM } from '@/lib/appLinks';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import type { LogType } from '@/types/app';
import { ActionButton, ButtonRow, GroupBox, hex, WidgetFrame } from './parts';
import type { CareWidgetData, WidgetData, WidgetDataError } from './widgetData';
import type { WidgetIconName } from './icons';

// B. 育児（docs/widgets.md §2.2）。4×1 の1段に、次の授乳の目安と3つのボタンを並べる。琥珀の地に白いボタン。
// 見出しは出さない。搾乳は授乳の入力画面にまとめてある（頻度も少ない）ので、ボタンを置かない。
// ボタンはお知らせのタップと同じ飛び先（`/care?open=milk`。src/lib/appLinks.ts）。
// ウィジェットから直接は保存しない（押し間違いで記録が増えないように）。

// アイコンは記録の種類の色（育児タブと同じ）、名前は灰色でそろえる（地の琥珀と競わないように）。
const BUTTONS: { type: LogType; icon: WidgetIconName; label: string; color: string }[] = [
  { type: 'milk', icon: 'milk', label: '授乳', color: colors.milk },
  { type: 'diaper', icon: 'diaper', label: 'おむつ', color: colors.diaper },
  { type: 'temperature', icon: 'temperature', label: '体温', color: colors.temperature },
];

const careUri = appLink('care');

const ERROR_LABEL: Record<WidgetDataError, string> = {
  'signed-out': '要ログイン',
  'no-family': '家族を設定',
  offline: '読めません',
};

/** 目安の欄に出す2行（小さい見出しと、大きい値）。 */
const dueLines = (data: WidgetData<CareWidgetData>): { label: string; value: string } => {
  if (!data.ok) return { label: '次の目安', value: ERROR_LABEL[data.error] };
  if (data.value.isNursing) return { label: '次の目安', value: '授乳中' };
  return { label: '次の目安', value: data.value.dueAt ? formatTimeString(data.value.dueAt) : '—' };
};

/** 目安の欄と3つのボタン（地は持たない。単体は外枠、重ねたものは GroupBox が育児の地になる）。 */
function careCells(data: WidgetData<CareWidgetData>) {
  const { label, value } = dueLines(data);
  return [
    <FlexWidget
      key="due"
      clickAction="OPEN_URI"
      clickActionData={{ uri: careUri }}
      accessibilityLabel={`${label} ${value}`}
      style={{ flex: 1, height: 'match_parent', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
    >
      <TextWidget text={label} maxLines={1} style={{ fontSize: 10, fontWeight: '700', color: hex(colors.milkText) }} />
      <TextWidget text={value} maxLines={1} style={{ fontSize: 19, fontWeight: '700', color: hex(colors.milkText) }} />
    </FlexWidget>,
    ...BUTTONS.map(({ type, icon, label: buttonLabel, color }) => (
      <ActionButton
        key={type}
        icon={icon}
        label={buttonLabel}
        uri={appLink('care', { [OPEN_LOG_PARAM]: type })}
        color={color}
        labelColor={colors.textSubtle}
      />
    )),
  ];
}

/** 育児の地の1段。タブと1つにまとめたもの（CombinedWidgets.tsx）で使う。 */
export function CareRow({ data }: { data: WidgetData<CareWidgetData> }) {
  return <GroupBox tone="care">{careCells(data)}</GroupBox>;
}

export function CareWidget({ data }: { data: WidgetData<CareWidgetData> }) {
  return (
    <WidgetFrame tone="care">
      <ButtonRow>{careCells(data)}</ButtonRow>
    </WidgetFrame>
  );
}
