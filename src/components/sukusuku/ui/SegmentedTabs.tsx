'use client';

import type { ReactNode } from 'react';
import { useSwipeTabs } from './useSwipeTabs';

export interface SegmentedTabOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
}

/**
 * 表示の切り替え(タイムライン/成長曲線、月/週/日 など)に使う共通の切り替えボタン。
 *
 * スマホで押し間違えないよう、どのタブでも高さ44px・14pxの太字で揃える。
 * fill=false にすると各ボタンをラベルの幅に合わせるため、絞り込みなど他の操作と
 * 同じ段に並べても、長いラベルだけが省略されることがない。
 * 帯の上で左右にスワイプしても切り替わる（中身の面ごとスワイプさせたいときは、
 * 呼び出し側で面に useSwipeTabs を足す）。横スクロールの中に置くときは swipeable=false。
 */
export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  fill = true,
  swipeable = true,
  className = '',
}: {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (id: T) => void;
  ariaLabel?: string;
  fill?: boolean;
  swipeable?: boolean;
  className?: string;
}) {
  const swipeHandlers = useSwipeTabs(
    options.map((option) => option.id),
    value,
    onChange,
    swipeable,
  );
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`flex bg-gray-200/80 p-1 rounded-xl ${className}`}
      {...swipeHandlers}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.id)}
            className={`min-w-0 min-h-9 rounded-lg text-sm font-bold flex items-center justify-center gap-1 transition ${
              fill ? 'flex-1 px-2' : 'flex-none px-3'
            } ${selected ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'}`}
          >
            {option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
