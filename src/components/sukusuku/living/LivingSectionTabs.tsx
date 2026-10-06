'use client';

import { ShieldCheck, ShoppingBasket, type LucideIcon } from 'lucide-react';

/**
 * 暮らしタブの区分の切り替え（docs/home.md §2）。防災備蓄・日用品（・のちに特別費）は
 * 持つデータも見方も別物なので、面の切り替え（期限順/必要数）とは別の段にし、
 * 区分ごとの色とアイコンで見分けられるようにする。
 * mobile版の `mobile/src/components/living/LivingSectionTabs.tsx` と同じ項目・並び・文言。
 *
 * Tailwind が拾えるよう、色のクラスは区分ごとに全文で書く。
 */

export type LivingSection = 'stock' | 'products';

export const LIVING_SECTIONS: {
  id: LivingSection;
  label: string;
  /** 見出し行に出す、その区分で何をするかの一言。 */
  hint: string;
  /** 選んでいるときのボタン。 */
  selected: string;
  /** 選んでいないときのアイコン。 */
  icon: string;
  /** 追加ボタン・絞り込みチップなど、その区分の中の操作の色。 */
  accent: string;
  Icon: LucideIcon;
}[] = [
  {
    id: 'stock',
    label: '防災備蓄',
    hint: '期限切れと不足に気づく',
    selected: 'bg-orange-600 border-orange-600 text-white',
    icon: 'text-orange-600',
    accent: 'bg-orange-600 hover:bg-orange-700',
    Icon: ShieldCheck,
  },
  {
    id: 'products',
    label: '日用品',
    hint: 'よく買うものを買い出しリストへ',
    selected: 'bg-emerald-600 border-emerald-600 text-white',
    icon: 'text-emerald-600',
    accent: 'bg-emerald-600 hover:bg-emerald-700',
    Icon: ShoppingBasket,
  },
];

export default function LivingSectionTabs({
  value,
  onChange,
}: {
  value: LivingSection;
  onChange: (id: LivingSection) => void;
}) {
  return (
    <div role="tablist" aria-label="暮らしの区分" className="shrink-0 flex gap-2 pb-2">
      {LIVING_SECTIONS.map(({ id, label, selected, icon, Icon }) => {
        const isSelected = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={isSelected}
            onClick={() => onChange(id)}
            className={`flex-1 min-w-0 min-h-11 px-2 rounded-xl border-[1.5px] text-[15px] font-bold flex items-center justify-center gap-1.5 transition ${
              isSelected ? selected : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            <Icon size={18} className={isSelected ? '' : icon} />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
