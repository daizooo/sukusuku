import { FlexWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import { appLink, OPEN_LOG_PARAM } from '@/lib/appLinks';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import type { LogType } from '@/types/app';
import { ActionButton, ButtonRow, DENSITY, GroupBox, hex, REFRESH_WIDGET_ACTION, WidgetFrame, type WidgetDensity } from './parts';
import type { CareWidgetData, WidgetData, WidgetDataError } from './widgetData';
import { widgetIcon, type WidgetIconName } from './icons';

// B. 育児（docs/widgets.md §2.2）。4×1 の1段に、次の授乳の目安と3つのボタンを並べる。琥珀の地に白いボタン。
// 見出しは出さない。搾乳は授乳の入力画面にまとめてある（頻度も少ない）ので、ボタンを置かない。
// ボタンはお知らせのタップと同じ飛び先（`/care?open=milk`。src/lib/appLinks.ts）。
// 目安のすぐ右に更新のボタン（↻。四角は付けない）を置き、押すとその場で次の目安を読み直して描き直す。目安の欄そのものを押すと育児タブを開く。
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
  loading: '更新中…',
};

/** 目安の欄に出す2行（小さい見出しと、大きい値）。読めなかったときは、見出しに理由を出す。 */
const dueLines = (data: WidgetData<CareWidgetData>): { label: string; value: string; isTime: boolean } => {
  if (!data.ok) {
    const label = data.error === 'offline' && data.detail ? data.detail : '次の目安';
    return { label, value: ERROR_LABEL[data.error], isTime: false };
  }
  if (data.value.isNursing) return { label: '次の目安', value: '授乳中', isTime: false };
  if (!data.value.dueAt) return { label: '次の目安', value: '—', isTime: false };
  return { label: '次の目安', value: formatTimeString(data.value.dueAt), isTime: true };
};

/** 目安の欄の中身。普通と tight は見出しの下に値、inline は横1行（時刻のときだけ「目安 12:30」）。 */
function dueText(data: WidgetData<CareWidgetData>, density: WidgetDensity) {
  const { label, value, isTime } = dueLines(data);
  const color = hex(colors.milkText);
  if (density === 'inline') {
    // 一言（要ログインなど）は時刻より長いので、見出しを省いて小さめに出す。
    return isTime ? (
      <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 4 }}>
        <TextWidget text="目安" maxLines={1} style={{ fontSize: 11, fontWeight: '700', color }} />
        <TextWidget text={value} maxLines={1} style={{ fontSize: 15, fontWeight: '700', color }} />
      </FlexWidget>
    ) : (
      <TextWidget text={value} maxLines={1} style={{ fontSize: 12, fontWeight: '700', color }} />
    );
  }
  const tight = density === 'tight';
  return [
    <TextWidget key="label" text={label} maxLines={data.ok ? 1 : 2} style={{ fontSize: tight ? 9 : 10, fontWeight: '700', color }} />,
    <TextWidget key="value" text={value} maxLines={1} style={{ fontSize: tight ? 13 : 19, fontWeight: '700', color }} />,
  ];
}

/** 目安の欄と3つのボタン（地は持たない。単体は外枠、重ねたものは GroupBox が育児の地になる）。 */
function careCells(data: WidgetData<CareWidgetData>, density: WidgetDensity = 'normal') {
  const { label, value } = dueLines(data);
  const d = DENSITY[density];
  return [
    // 目安と ↻ をくっつけて真ん中に置く。両脇の余白も押すと育児タブを開く（入れ子にせず、横に並べて分ける）。
    <FlexWidget key="due" style={{ flex: 1, height: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: careUri }} style={{ flex: 1, height: 'match_parent' }} />
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: careUri }}
        accessibilityLabel={`${label} ${value}`}
        style={{ height: 'match_parent', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      >
        {dueText(data, density)}
      </FlexWidget>
      <FlexWidget
        clickAction={REFRESH_WIDGET_ACTION}
        accessibilityLabel="次の目安を更新"
        style={{ height: 'match_parent', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}
      >
        <SvgWidget svg={widgetIcon('refresh', colors.milkText)} style={{ width: d.icon + 2, height: d.icon + 2 }} />
      </FlexWidget>
      <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: careUri }} style={{ flex: 1, height: 'match_parent' }} />
    </FlexWidget>,
    ...BUTTONS.map(({ type, icon, label: buttonLabel, color }) => (
      <ActionButton
        key={type}
        icon={icon}
        label={buttonLabel}
        uri={appLink('care', { [OPEN_LOG_PARAM]: type })}
        color={color}
        labelColor={colors.textSubtle}
        density={density}
      />
    )),
  ];
}

/** 育児の地の1段。タブと1つにまとめたもの（CombinedWidgets.tsx）で使う。 */
export function CareRow({ data, density = 'normal' }: { data: WidgetData<CareWidgetData>; density?: WidgetDensity }) {
  return (
    <GroupBox tone="care" density={density}>
      {careCells(data, density)}
    </GroupBox>
  );
}

export function CareWidget({ data }: { data: WidgetData<CareWidgetData> }) {
  return (
    <WidgetFrame tone="care">
      <ButtonRow>{careCells(data)}</ButtonRow>
    </WidgetFrame>
  );
}
