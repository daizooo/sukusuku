'use client';

import type { ReactNode } from 'react';
import {
  Backpack,
  BatteryCharging,
  Baby,
  Bandage,
  Beef,
  Cookie,
  Droplets,
  Flame,
  Flashlight,
  GlassWater,
  Package,
  Radio,
  Soup,
  Toilet,
  Trash2,
  Wheat,
  type LucideIcon,
} from 'lucide-react';
import { stockIconKey, type StockIconKey } from '@/lib/stockUtils';

// 防災備蓄の画面の見た目の部品（docs/home.md §10.2）。mobile版の
// `mobile/src/components/living/stockVisual.tsx` と同じ絵柄・色にしてある。

const ICONS: Record<StockIconKey, LucideIcon> = {
  water: Droplets,
  drink: GlassWater,
  rice: Wheat,
  meat: Beef,
  soup: Soup,
  snack: Cookie,
  toilet: Toilet,
  trash: Trash2,
  radio: Radio,
  light: Flashlight,
  battery: BatteryCharging,
  baby: Baby,
  care: Bandage,
  warm: Flame,
  bag: Backpack,
  other: Package,
};

/** 状態の色。リングの線・数字に使う。 */
export const TONE = {
  // 色は淡い橙（防災備蓄の色）と、いま対応が要るものの赤だけ。濃い色は文字以外に使わない。
  ok: '#fb923c',
  warn: '#fb923c',
  alert: '#f87171',
  accent: '#fb923c',
  track: '#e5e7eb',
  mute: '#9ca3af',
} as const;

/** 品名・カテゴリに合った絵柄。 */
export function StockIcon({
  name,
  category,
  size = 20,
  color,
}: {
  name: string;
  category?: string;
  size?: number;
  color?: string;
}) {
  const Icon = ICONS[stockIconKey(name, category)];
  return <Icon size={size} color={color} strokeWidth={2.2} />;
}

/** 達成率のリング。真ん中に children を置く。ratio は0〜1。 */
export function Ring({
  size,
  stroke,
  ratio,
  color,
  children,
}: {
  size: number;
  stroke: number;
  ratio: number;
  color: string;
  children?: ReactNode;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = Math.max(0, Math.min(1, ratio));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={TONE.track} strokeWidth={stroke} />
        {filled > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}

/** 備え度の色。 */
export const readinessColor = (percent: number) => (percent >= 60 ? TONE.ok : TONE.alert);
