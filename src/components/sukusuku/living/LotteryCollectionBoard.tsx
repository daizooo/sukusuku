'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import {
  Coffee,
  Gift,
  IceCreamCone,
  Lock,
  Popcorn,
  Sandwich,
  Sparkles,
  TrendingUp,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import type { LotteryCouponKind } from '@/types/app';
import { COLLECTION_SLOTS, COUPON_INFO, collectionTeaser, treasureWhisper } from '@/lib/subsidyLotteryUtils';

// お買いもの福引の「金賞コレクション」の台紙（docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryCollectionBoard.tsx` と同じ項目・並び・文言・動き（動きは globals.css）。
//
// 金色の帯（何周目・いくつ集めたか・6つの目盛り）→ 6枚のメダル → 宝箱。
// - 集めたメダルは金色で、きらりと光る。押すと特典の説明が出る。まだのメダルは鍵がかかっていて、押すと震える
// - 宝箱は、集めた数が多いほど大きく・速く揺れる。押すと一言（中身＝ごほうびは言わない）

const KIND_ICON: Partial<Record<LotteryCouponKind, LucideIcon>> = {
  snack: IceCreamCone,
  movie: Popcorn,
  cafe: Coffee,
  picnic: Sandwich,
  rate_up: TrendingUp,
};

/** 押されたら左右に震える（shake を増やすと、要素を作り直して動きをもう一度流す）。 */
function Shake({ shake, children }: { shake: number; children: ReactNode }) {
  return (
    <span key={shake} className={`inline-block ${shake > 0 ? 'lottery-shake' : ''}`}>
      {children}
    </span>
  );
}

interface LotteryCollectionBoardProps {
  /** 何周目か。 */
  cycle: number;
  /** 今の周で集めた枠（1〜6）。 */
  collected: number[];
}

export default function LotteryCollectionBoard({ cycle, collected }: LotteryCollectionBoardProps) {
  /** 押したメダルの枠（説明を出す）。 */
  const [selected, setSelected] = useState<number | null>(null);
  /** 鍵のかかったメダルを押した回数（枠ごと。震わせるのに使う）。 */
  const [locked, setLocked] = useState<Record<number, number>>({});
  const [taps, setTaps] = useState(0);
  const count = collected.length;
  const selectedEntry = COLLECTION_SLOTS.find((entry) => entry.slot === selected) ?? null;
  // 宝箱は、集めた数が多いほど大きく・せわしなく揺れる（mobile版と同じ角度と間）。
  const treasureStyle = {
    '--angle': `${3 + count * 2}deg`,
    animationDuration: `${400 + Math.max(500, 2400 - count * 380)}ms`,
  } as CSSProperties;

  const pressSlot = (slot: number, got: boolean) => {
    if (got) {
      setSelected((prev) => (prev === slot ? null : slot));
      return;
    }
    setSelected(null);
    setLocked((prev) => ({ ...prev, [slot]: (prev[slot] ?? 0) + 1 }));
  };

  return (
    <div className="space-y-2.5">
      <div className="space-y-1.5 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-200 px-4 py-3 text-amber-900">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-0.5 text-xs font-extrabold tabular-nums">
            <Trophy size={14} />
            {cycle}周目
          </span>
          {cycle > 1 && <span className="text-[11px] font-extrabold tabular-nums">コンプリート {cycle - 1}回</span>}
        </div>
        <p className="text-center font-extrabold tabular-nums">
          <span className="text-4xl">{count}</span>
          <span className="text-lg"> / 6</span>
        </p>
        <div className="flex gap-1">
          {COLLECTION_SLOTS.map((entry) => (
            <span
              key={entry.slot}
              className={`h-2 flex-1 rounded-full ${collected.includes(entry.slot) ? 'bg-amber-900' : 'bg-amber-900/20'}`}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {COLLECTION_SLOTS.map((entry, index) => {
          const got = collected.includes(entry.slot);
          const Icon = KIND_ICON[entry.kind] ?? Gift;
          return (
            <button
              key={entry.slot}
              type="button"
              aria-label={got ? COUPON_INFO[entry.kind].name : `${entry.slot}番（まだ）`}
              onClick={() => pressSlot(entry.slot, got)}
              className={`flex flex-col items-center gap-[3px] rounded-[14px] bg-amber-50 px-1 py-2.5 ${
                selected === entry.slot ? 'border-2 border-amber-400' : 'border border-amber-100'
              }`}
            >
              <Shake shake={locked[entry.slot] ?? 0}>
                <span
                  className={`relative flex h-[52px] w-[52px] items-center justify-center rounded-full border-[3px] ${
                    got ? 'border-amber-200 bg-amber-400 text-amber-900' : 'border-dashed border-gray-200 bg-gray-100 text-gray-400'
                  }`}
                >
                  {got ? <Icon size={24} /> : <Lock size={20} />}
                  {got && (
                    <span
                      className="lottery-twinkle absolute -right-1 -top-1 text-white"
                      style={{ animationDelay: `${index * 400}ms` }}
                    >
                      <Sparkles size={16} fill="#fde68a" />
                    </span>
                  )}
                </span>
              </Shake>
              <span className="text-[10px] font-extrabold tabular-nums text-amber-700">No.{entry.slot}</span>
              <span className={`line-clamp-2 text-center text-[11px] font-bold ${got ? 'text-amber-900' : 'text-gray-400'}`}>
                {got ? COUPON_INFO[entry.kind].name : '？？？'}
              </span>
            </button>
          );
        })}
      </div>
      {selectedEntry && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-center text-xs text-amber-900">
          {COUPON_INFO[selectedEntry.kind].description}
        </p>
      )}

      <button
        type="button"
        aria-label="宝箱"
        onClick={() => setTaps((prev) => prev + 1)}
        className="flex w-full flex-col items-center gap-1.5 rounded-2xl bg-red-800 py-4"
      >
        <Shake shake={taps}>
          <span
            className="lottery-treasure relative flex h-[76px] w-[76px] items-center justify-center rounded-[18px] border-2 border-amber-400 bg-red-900 text-amber-400"
            style={treasureStyle}
          >
            <Gift size={40} />
            <span className="absolute right-2 top-0.5 text-base font-extrabold text-amber-200">？</span>
          </span>
        </Shake>
        <span className="text-center text-sm font-extrabold tabular-nums text-amber-200">{collectionTeaser(count)}</span>
        {taps > 0 && <span className="text-center text-xs font-bold text-white/85">{treasureWhisper(taps - 1)}</span>}
      </button>
    </div>
  );
}
