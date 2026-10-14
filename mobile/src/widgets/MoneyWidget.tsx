import { appLink, OPEN_MONEY_PARAM, type MoneyOpen } from '@/lib/appLinks';
import { colors } from '@/lib/theme';
import { ActionButton, ButtonRow, WidgetFrame } from './parts';
import type { WidgetIconName } from './icons';

// C. 家計（docs/widgets.md §2.3）。4×1 の1段に4つのボタンだけを並べる（見出し・金額は出さない）。
// 支出・収入・振替は記録の入力画面をその種類で開き、レシートは撮影から始める。
// 中身を読まないので、ログインしていなくても圏外でも同じように出る。色は家計タブの差し色（青）。

const BUTTONS: { open: MoneyOpen; icon: WidgetIconName; label: string }[] = [
  { open: 'expense', icon: 'expense', label: '支出' },
  { open: 'income', icon: 'income', label: '収入' },
  { open: 'transfer', icon: 'transfer', label: '振替' },
  { open: 'receipt', icon: 'receipt', label: 'レシート' },
];

export function MoneyWidget() {
  return (
    <WidgetFrame padding={8}>
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
