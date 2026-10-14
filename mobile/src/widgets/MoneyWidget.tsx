import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { appLink, OPEN_MONEY_PARAM, type MoneyOpen } from '@/lib/appLinks';
import { formatYen } from '@/lib/moneyUtils';
import { colors } from '@/lib/theme';
import { ActionButton, ButtonRow, errorText, hex, NoteText, WidgetFrame, WidgetHeader } from './parts';
import type { MoneyWidgetData, WidgetData } from './widgetData';
import type { WidgetIconName } from './icons';

// C. 家計のクイック入力（docs/widgets.md §2.3）。
// 今月の支出と今日の支出を出し、支出・収入・振替は記録の入力画面、レシートは撮影から始める。
// 金額は設定で隠せる（ホーム画面は人に見られやすいため。隠すと見出しとボタンだけ）。
// 色は家計タブの差し色（青）。

const BUTTONS: { open: MoneyOpen; icon: WidgetIconName; label: string }[] = [
  { open: 'expense', icon: 'expense', label: '支出' },
  { open: 'income', icon: 'income', label: '収入' },
  { open: 'transfer', icon: 'transfer', label: '振替' },
  { open: 'receipt', icon: 'receipt', label: 'レシート' },
];

const moneyUri = appLink('money');

function Amounts({ data }: { data: WidgetData<MoneyWidgetData> }) {
  if (!data.ok) return <NoteText text={errorText(data.error)} uri={moneyUri} />;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: moneyUri }}
      style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}
    >
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget
          text={`${data.value.month}月の支出`}
          style={{ fontSize: 11, fontWeight: '500', color: hex(colors.textMuted) }}
        />
        <TextWidget
          text={formatYen(data.value.monthSpent)}
          style={{ fontSize: 20, fontWeight: '700', color: hex(colors.moneyText) }}
        />
      </FlexWidget>
      <TextWidget
        text={`今日 ${formatYen(data.value.todaySpent)}`}
        style={{ fontSize: 12, fontWeight: '700', color: hex(colors.textSubtle) }}
      />
    </FlexWidget>
  );
}

export function MoneyWidget({ data, hideAmounts }: { data: WidgetData<MoneyWidgetData>; hideAmounts: boolean }) {
  return (
    <WidgetFrame>
      <WidgetHeader title="家計" uri={moneyUri} />
      {hideAmounts ? null : <Amounts data={data} />}
      <ButtonRow>
        {BUTTONS.map(({ open, icon, label }) => (
          <ActionButton
            key={open}
            icon={icon}
            label={label}
            uri={appLink('money', { [OPEN_MONEY_PARAM]: open })}
            color={colors.money}
            surface={colors.moneySurface}
          />
        ))}
      </ButtonRow>
    </WidgetFrame>
  );
}
