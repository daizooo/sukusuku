'use client';

import type { ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useBackLayer } from '@/lib/browserHistory';
import { formatMonthKey, shiftMonth } from '@/lib/moneyUtils';

// 家計タブで共通に使う小さな部品（月の送り・使った割合の輪・種類の頭文字・全画面の枠と見出し）。
// mobile版の `mobile/src/components/money/moneyVisual.tsx` と同じ見た目。

/** 月の送り（‹ 2026年9月 ›）。 */
export function MonthBar({
  monthKey,
  onChange,
  right,
}: {
  monthKey: string;
  onChange: (monthKey: string) => void;
  right?: ReactNode;
}) {
  return (
    <div className="shrink-0 flex items-center gap-2 py-2">
      <button
        type="button"
        aria-label="前の月"
        onClick={() => onChange(shiftMonth(monthKey, -1))}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
      >
        <ChevronLeft size={18} />
      </button>
      <span className="text-[17px] font-bold text-gray-900 tabular-nums">{formatMonthKey(monthKey)}</span>
      <button
        type="button"
        aria-label="次の月"
        onClick={() => onChange(shiftMonth(monthKey, 1))}
        className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
      >
        <ChevronRight size={18} />
      </button>
      <span className="flex-1" />
      {right}
    </div>
  );
}

/** 使った割合の輪。100%を超えたら淡い赤で一周。 */
export function UsageRing({ percent, size = 52 }: { percent: number | null; size?: number }) {
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const over = percent !== null && percent > 100;
  const filled = percent === null ? 0 : Math.min(percent, 100) / 100;
  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke="#f3f4f6" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={over ? '#fca5a5' : '#93c5fd'}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={`${circumference * filled} ${circumference}`}
          strokeLinecap="round"
        />
      </svg>
      <span className={`relative text-[11px] font-bold tabular-nums ${over ? 'text-red-600' : 'text-blue-600'}`}>
        {percent === null ? '−' : `${percent}%`}
      </span>
    </div>
  );
}

/** 種類の頭文字の丸（「食」）。 */
export function CategoryBadge({ label }: { label: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[13px] font-bold text-blue-600">
      {label.slice(0, 1) || '・'}
    </span>
  );
}

/** 全画面の入力の枠。戻る操作（ブラウザ・スマホ）で onBack を呼ぶ。 */
export function FullScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  useBackLayer(onBack);
  return (
    <div className="fixed inset-0 z-50 flex justify-center bg-black/30">
      <div className="relative flex h-full w-full max-w-md flex-col bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  );
}

/**
 * 全画面の中で重ねる画面（品目・種類の選択など）。開いている間だけ戻る操作で閉じる層を積む。
 * 記録の詳細の上に重ねて出し、戻る操作では一番上の画面だけを閉じる。
 */
export function StackedScreen({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  useBackLayer(onBack);
  return <div className="flex min-h-0 flex-1 flex-col bg-white">{children}</div>;
}

/** 全画面の入力の見出し。close は × 、back は ← 。 */
export function ScreenHeader({
  title,
  onClose,
  icon = 'close',
  right,
}: {
  title: string;
  onClose: () => void;
  icon?: 'close' | 'back';
  right?: ReactNode;
}) {
  const Icon = icon === 'back' ? ArrowLeft : X;
  return (
    <div className="shrink-0 flex items-center gap-3.5 border-b border-gray-200 px-4 py-3.5">
      <button type="button" aria-label={icon === 'back' ? '戻る' : '閉じる'} onClick={onClose} className="text-gray-700">
        <Icon size={22} />
      </button>
      <h3 className="text-lg font-bold text-gray-900">{title}</h3>
      <span className="flex-1" />
      {right}
    </div>
  );
}

/** 下に固定の大きなボタン（淡い青）。 */
export function PrimaryButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-blue-100 py-3.5 text-[15px] font-bold text-blue-800 hover:bg-blue-200 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
