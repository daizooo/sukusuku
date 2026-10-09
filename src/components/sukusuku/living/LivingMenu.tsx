'use client';

import { ShieldCheck, Ticket, type LucideIcon } from 'lucide-react';

/**
 * 暮らしタブのメニュー（docs/home.md §2）。防災備蓄・補助くじは
 * 持つデータも見方も別物で、頻繁に開くタブでもないため、切り替えではなく
 * アイコンを並べたメニューにして、押すとその画面へ入る。
 * mobile版の `mobile/src/components/living/LivingMenu.tsx` と同じ項目・並び・文言。
 *
 * Tailwind が拾えるよう、色のクラスは区分ごとに全文で書く。
 */

export type LivingSection = 'stock' | 'lottery';

export const LIVING_SECTIONS: {
  id: LivingSection;
  label: string;
  /** メニューのカードに出す、その画面で何をするかの一言。 */
  hint: string;
  /** アイコンの色と下地。 */
  icon: string;
  surface: string;
  Icon: LucideIcon;
}[] = [
  {
    id: 'stock',
    label: '防災備蓄',
    hint: '期限切れと不足に気づく',
    icon: 'text-orange-600',
    surface: 'bg-orange-50 group-hover:bg-orange-100',
    Icon: ShieldCheck,
  },
  {
    id: 'lottery',
    label: '福引チャンス',
    hint: '家族のお金で買ってもらえるかも・・・',
    icon: 'text-purple-600',
    surface: 'bg-purple-50 group-hover:bg-purple-100',
    Icon: Ticket,
  },
];

export default function LivingMenu({
  onOpen,
  attention,
}: {
  onOpen: (id: LivingSection) => void;
  /** 区分ごとの「要確認」の件数。0・無いときは出さない。 */
  attention: Partial<Record<LivingSection, number>>;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {LIVING_SECTIONS.map(({ id, label, hint, icon, surface, Icon }) => {
        const count = attention[id] ?? 0;
        return (
          <button
            key={id}
            type="button"
            aria-label={count > 0 ? `${label}（要確認 ${count}件）` : label}
            onClick={() => onOpen(id)}
            className="group relative min-h-36 p-3.5 rounded-2xl border border-gray-200 bg-white text-left hover:border-gray-300 transition"
          >
            <span className={`mb-2.5 flex h-14 w-14 items-center justify-center rounded-2xl transition ${surface}`}>
              <Icon size={30} className={icon} />
            </span>
            <span className="block text-base font-bold text-gray-900">{label}</span>
            <span className="mt-1 block text-xs font-medium text-gray-500">{hint}</span>
            {count > 0 && (
              <span className="absolute top-2.5 right-2.5 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                要確認 {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
