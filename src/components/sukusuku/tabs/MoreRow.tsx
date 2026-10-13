'use client';

import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

// その他タブの1行（docs/family-app.md §4.5）。色つきの丸いアイコン・名前・ひとこと・
// 必要なら件数や期限のバッジ・右の矢印。押すとその画面へ。
// mobile版は `mobile/src/components/more/MoreRow.tsx`。

export type MoreBadgeTone = 'alert' | 'warn' | 'ok' | 'plain';

// バッジの色はどの種類もグレーにそろえる（2026-10-13。行ごとの色が多く見づらかったため。意味は文言で伝える）。
// tone は呼び出し側の分類として残してある。色を戻すときはここを変える。
const NEUTRAL_BADGE = 'bg-gray-100 text-gray-600';
const BADGE: Record<MoreBadgeTone, string> = {
  alert: NEUTRAL_BADGE,
  warn: NEUTRAL_BADGE,
  ok: NEUTRAL_BADGE,
  plain: NEUTRAL_BADGE,
};

interface MoreRowProps {
  icon: ReactNode;
  /** アイコンを載せる丸の地の色（Tailwindの bg-*）。アイコン自身の色は icon 側で付ける。 */
  tintClass: string;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: MoreBadgeTone;
  ariaLabel?: string;
  onClick: () => void;
}

export default function MoreRow({
  icon,
  tintClass,
  title,
  description,
  badge,
  badgeTone = 'plain',
  ariaLabel,
  onClick,
}: MoreRowProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel ?? (badge ? `${title}（${badge}）` : title)}
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-[13px] text-left hover:bg-gray-50 transition"
    >
      <span className={`flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] ${tintClass}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-500">{description}</span>
        {badge && (
          <span
            className={`mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-px text-[11px] font-bold ${BADGE[badgeTone]}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {badge}
          </span>
        )}
      </span>
      <ChevronRight size={18} className="flex-none text-gray-400" />
    </button>
  );
}
