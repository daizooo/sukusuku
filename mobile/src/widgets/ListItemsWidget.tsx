import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { appLink, OPEN_LIST_PARAM } from '@/lib/appLinks';
import { colors } from '@/lib/theme';
import { errorText, hex, NoteText, WidgetFrame, WidgetHeader } from './parts';
import type { ListWidgetData, WidgetData } from './widgetData';

// D. ToDo・買い物リスト（docs/widgets.md §2.4）。
// 1つのリストの、まだ済んでいない項目を上から出す。押すとそのリストをToDoタブで開く（＋も同じ。
// 項目はリストの中の「追加」から入れる）。済みにする操作はアプリで行う（ウィジェットからは書き込まない）。
// 出す件数はウィジェットの高さで決める。入りきらないぶんは「ほか n件」にまとめる。

const HEADER_HEIGHT = 22;
const ROW_HEIGHT = 22;
const PADDING = 12 * 2;

function ItemRow({ title, uri }: { title: string; uri: string }) {
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri }}
      style={{ width: 'match_parent', height: ROW_HEIGHT - 4, flexDirection: 'row', alignItems: 'center', flexGap: 8 }}
    >
      <FlexWidget
        style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 2, borderColor: hex(colors.borderStrong) }}
      />
      <TextWidget
        text={title}
        maxLines={1}
        truncate="END"
        style={{ fontSize: 13, fontWeight: '500', color: hex(colors.text) }}
      />
    </FlexWidget>
  );
}

export function ListItemsWidget({ data, height }: { data: WidgetData<ListWidgetData | null>; height: number }) {
  const listTabUri = appLink('list');
  if (!data.ok || data.value === null) {
    return (
      <WidgetFrame>
        <WidgetHeader title="ToDo" note="＋" uri={listTabUri} />
        <NoteText text={data.ok ? 'リストはまだありません' : errorText(data.error)} uri={listTabUri} />
      </WidgetFrame>
    );
  }
  const { listId, name, items } = data.value;
  const uri = appLink('list', { [OPEN_LIST_PARAM]: listId });
  const capacity = Math.max(1, Math.floor((height - PADDING - HEADER_HEIGHT) / ROW_HEIGHT));
  // 入りきらないときは最後の1行を「ほか n件」に使う。
  const shown = items.length > capacity ? items.slice(0, capacity - 1) : items;
  const rest = items.length - shown.length;
  return (
    <WidgetFrame gap={4}>
      <WidgetHeader title={name} note="＋" uri={uri} />
      {items.length === 0 ? (
        <NoteText text="すべて済みました" uri={uri} />
      ) : (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'column', flexGap: 4 }}>
          {[
            ...shown.map((item) => <ItemRow key={item.id} title={item.title} uri={uri} />),
            ...(rest > 0 ? [<NoteText key="rest" text={`ほか ${rest}件`} uri={uri} />] : []),
          ]}
        </FlexWidget>
      )}
    </WidgetFrame>
  );
}
