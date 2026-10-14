import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { appLink, OPEN_LOG_PARAM } from '@/lib/appLinks';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import type { LogType } from '@/types/app';
import { ActionButton, ButtonRow, hex, WidgetFrame } from './parts';
import type { CareWidgetData, WidgetData, WidgetDataError } from './widgetData';
import type { WidgetIconName } from './icons';

// B. 育児（docs/widgets.md §2.2）。4×1 の1段に、次の授乳の目安と3つのボタンを並べる。
// 見出しは出さない。搾乳は授乳の入力画面にまとめてある（頻度も少ない）ので、ボタンを置かない。
// ボタンはお知らせのタップと同じ飛び先（`/care?open=milk`。src/lib/appLinks.ts）。
// ウィジェットから直接は保存しない（押し間違いで記録が増えないように）。

const BUTTONS: { type: LogType; icon: WidgetIconName; label: string; color: string; surface: string }[] = [
  { type: 'milk', icon: 'milk', label: '授乳', color: colors.milk, surface: colors.milkSurface },
  { type: 'diaper', icon: 'diaper', label: 'おむつ', color: colors.diaper, surface: colors.diaperSurface },
  { type: 'temperature', icon: 'temperature', label: '体温', color: colors.temperature, surface: colors.temperatureSurface },
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

/** 次の目安と3つのボタンを並べた1段。タブと1つにまとめたもの（CombinedWidgets.tsx）でも使う。 */
export function CareRow({ data }: { data: WidgetData<CareWidgetData> }) {
  const { label, value } = dueLines(data);
  return (
    <ButtonRow>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: careUri }}
        accessibilityLabel={`${label} ${value}`}
        style={{
          flex: 1,
          height: 'match_parent',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: hex(colors.milkSurface),
          borderRadius: 14,
        }}
      >
        <TextWidget text={label} maxLines={1} style={{ fontSize: 11, fontWeight: '500', color: hex(colors.textMuted) }} />
        <TextWidget text={value} maxLines={1} style={{ fontSize: 18, fontWeight: '700', color: hex(colors.milkText) }} />
      </FlexWidget>
      {BUTTONS.map(({ type, icon, label: buttonLabel, color, surface }) => (
        <ActionButton
          key={type}
          icon={icon}
          label={buttonLabel}
          uri={appLink('care', { [OPEN_LOG_PARAM]: type })}
          color={color}
          surface={surface}
        />
      ))}
    </ButtonRow>
  );
}

export function CareWidget({ data }: { data: WidgetData<CareWidgetData> }) {
  return (
    <WidgetFrame padding={8}>
      <CareRow data={data} />
    </WidgetFrame>
  );
}
