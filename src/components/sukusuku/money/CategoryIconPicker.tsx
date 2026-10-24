'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { CATEGORY_ICON_COLORS, MONEY_ICONS } from '@/lib/moneyUtils';
import { ModalShell } from '../modals/TaskForm';
import { CategoryIcon, PrimaryButton } from './moneyVisual';

// 大分類のアイコン（絵と色）を選ぶ枠（年間予算の変動費の枠。docs/kakei.md §0.8）。mobile版の `mobile/src/components/money/CategoryIconPicker.tsx` と同じ並び・文言。
// アイコンをタップすると色を選べる（出金元のアイコンの色と同じ候補）。選んだものは「決める」で返す（保存は呼び出し側）。

export default function CategoryIconPicker({
  icon: initialIcon,
  iconColor: initialColor,
  onClose,
  onSubmit,
}: {
  /** アイコンの key（moneyUtils の MONEY_ICONS）。 */
  icon: string;
  /** 色（#rrggbb）。null は標準（アイコンごとの色）。 */
  iconColor: string | null;
  onClose: () => void;
  onSubmit: (icon: string, iconColor: string | null) => void;
}) {
  const [icon, setIcon] = useState(initialIcon);
  const [iconColor, setIconColor] = useState<string | null>(initialColor);
  const [pickingColor, setPickingColor] = useState(false);

  return (
    <ModalShell title="アイコンと色" onClose={onClose} footer={<PrimaryButton label="決める" onClick={() => onSubmit(icon, iconColor)} />}>
      <div>
        <button
          type="button"
          aria-label="アイコンの色を選ぶ"
          aria-expanded={pickingColor}
          onClick={() => setPickingColor((open) => !open)}
          className="flex items-center gap-3 py-1"
        >
          <CategoryIcon iconKey={iconColor ? `${icon}|${iconColor}` : icon} size={48} />
          <span className="text-[13px] font-semibold text-blue-600">タップして色を選ぶ</span>
        </button>
        {pickingColor && (
          <div className="flex flex-wrap gap-2.5 py-1">
            <button
              type="button"
              aria-label="標準の色"
              aria-pressed={iconColor === null}
              onClick={() => setIconColor(null)}
              className={`flex h-[34px] w-[34px] items-center justify-center rounded-full bg-gray-100 ${iconColor === null ? 'ring-[3px] ring-gray-900' : ''}`}
            >
              <CategoryIcon iconKey={icon} size={26} />
            </button>
            {CATEGORY_ICON_COLORS.map((entry) => (
              <button
                key={entry.color}
                type="button"
                aria-label={entry.label}
                aria-pressed={iconColor === entry.color}
                onClick={() => setIconColor(entry.color)}
                style={{ backgroundColor: entry.color }}
                className={`flex h-[34px] w-[34px] items-center justify-center rounded-full text-white ${iconColor === entry.color ? 'ring-[3px] ring-gray-900' : ''}`}
              >
                {iconColor === entry.color && <Check size={18} />}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          {MONEY_ICONS.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-label={entry.label}
              aria-pressed={icon === entry.key}
              onClick={() => setIcon(entry.key)}
              className={`flex h-[46px] w-[46px] items-center justify-center rounded-xl border-2 ${icon === entry.key ? 'border-blue-600' : 'border-transparent'}`}
            >
              <CategoryIcon iconKey={iconColor ? `${entry.key}|${iconColor}` : entry.key} size={34} />
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
