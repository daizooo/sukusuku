import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { appLink, OPEN_LOG_PARAM } from '@/lib/appLinks';
import { formatTimeString } from '@/lib/dateUtils';
import { colors } from '@/lib/theme';
import type { LogType } from '@/types/app';
import { ActionButton, ButtonRow, errorText, hex, NoteText, WidgetFrame, WidgetHeader } from './parts';
import type { CareWidgetData, WidgetData } from './widgetData';
import type { WidgetIconName } from './icons';

// B. 育児のクイック記録（docs/widgets.md §2.2）。
// 前回の授乳と次の目安を時刻で出し、4つのボタンで各入力画面を開く。
// ボタンはお知らせのタップと同じ飛び先（`/care?open=milk`。src/lib/appLinks.ts）。
// ウィジェットから直接は保存しない（押し間違いで記録が増えないように）。

const BUTTONS: { type: LogType; icon: WidgetIconName; label: string; color: string; surface: string }[] = [
  { type: 'milk', icon: 'milk', label: '授乳', color: colors.milk, surface: colors.milkSurface },
  { type: 'diaper', icon: 'diaper', label: 'おむつ', color: colors.diaper, surface: colors.diaperSurface },
  { type: 'pumping', icon: 'pumping', label: '搾乳', color: colors.pumping, surface: colors.pumpingSurface },
  { type: 'temperature', icon: 'temperature', label: '体温', color: colors.temperature, surface: colors.temperatureSurface },
];

const careUri = appLink('care');
const openUri = (type: LogType) => appLink('care', { [OPEN_LOG_PARAM]: type });

/** 「前回 9:40」「次の目安 12:40」の1つ。 */
function TimeCell({ label, time }: { label: string; time: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: careUri }}
      style={{ flex: 1, flexDirection: 'column' }}
    >
      <TextWidget text={label} style={{ fontSize: 11, fontWeight: '500', color: hex(colors.textMuted) }} />
      <TextWidget text={time} style={{ fontSize: 20, fontWeight: '700', color: hex(colors.milkText) }} />
    </FlexWidget>
  );
}

function Status({ data }: { data: WidgetData<CareWidgetData> }) {
  if (!data.ok) return <NoteText text={errorText(data.error)} uri={careUri} />;
  const { isNursing, lastFedAt, dueAt } = data.value;
  if (isNursing) {
    return (
      <TextWidget
        text="いま授乳中"
        clickAction="OPEN_URI"
        clickActionData={{ uri: careUri }}
        style={{ fontSize: 18, fontWeight: '700', color: hex(colors.milkText) }}
      />
    );
  }
  if (!lastFedAt) return <NoteText text="授乳の記録はまだありません" uri={careUri} />;
  return (
    <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
      <TimeCell label="前回の授乳" time={formatTimeString(lastFedAt)} />
      <TimeCell label="次の目安" time={dueAt ? formatTimeString(dueAt) : '—'} />
    </FlexWidget>
  );
}

export function CareWidget({ data }: { data: WidgetData<CareWidgetData> }) {
  return (
    <WidgetFrame>
      <WidgetHeader title="育児" uri={careUri} />
      <Status data={data} />
      <ButtonRow>
        {BUTTONS.map(({ type, icon, label, color, surface }) => (
          <ActionButton key={type} icon={icon} label={label} uri={openUri(type)} color={color} surface={surface} />
        ))}
      </ButtonRow>
    </WidgetFrame>
  );
}
