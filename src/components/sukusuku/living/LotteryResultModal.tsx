'use client';

import { useEffect, useState } from 'react';
import type { SubsidyDraw } from '@/types/app';
import { prizeOf } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import { ModalShell } from '../modals/TaskForm';
import LotteryBall, { PRIZE_COLOR } from './LotteryBall';

// 補助くじの結果（docs/home.md §9）。mobile版の `mobile/src/components/living/LotteryResultSheet.tsx` と
// 同じ流れ・同じ文言。結果はこの枠を出す前にDBへ記録してある（見てから引き直せない）。
//
// 「ガラガラガラ…」と玉が揺れてから、出た玉が弾むように出る。

/** 玉が揺れている時間（ミリ秒）。 */
const SPIN_MS = 1400;

interface LotteryResultModalProps {
  draw: SubsidyDraw;
  onClose: () => void;
}

export default function LotteryResultModal({ draw, onClose }: LotteryResultModalProps) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), SPIN_MS);
    return () => clearTimeout(timer);
  }, []);

  const prize = prizeOf(draw.prize);
  const own = draw.price - draw.subsidy;

  return (
    <ModalShell
      title="補助くじの結果"
      onClose={onClose}
      footer={
        <button
          type="button"
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-blue-500 text-white font-bold hover:bg-blue-600 transition"
        >
          {revealed ? 'とじる' : 'スキップ'}
        </button>
      }
    >
      <div className="text-center space-y-1">
        <p className="text-[15px] font-bold text-gray-900 break-words">{draw.itemName || '（名前なし）'}</p>
        <p className="text-sm font-bold text-gray-500 tabular-nums">税込 {formatPrice(draw.price)}</p>
      </div>

      <div className="flex items-center justify-center h-36">
        {revealed ? (
          <span className="lottery-pop">
            <LotteryBall prize={draw.prize} size={120} />
          </span>
        ) : (
          <span className="lottery-shake">
            <LotteryBall prize={null} size={120} />
          </span>
        )}
      </div>

      {revealed ? (
        <div className="space-y-2 text-center">
          <p className="text-xl font-bold" style={{ color: PRIZE_COLOR[draw.prize].text }}>
            {prize.ball}！ {prize.name}
          </p>
          <p className="text-[13px] text-gray-700">{prize.message}</p>
          <div className="mt-1 space-y-1.5 rounded-xl bg-gray-100 p-3 text-left">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-gray-700">家族のお金から</span>
              <span className={`text-base font-bold tabular-nums ${draw.subsidy > 0 ? 'text-blue-600' : 'text-gray-900'}`}>
                {formatPrice(draw.subsidy)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-gray-700">あなたのお小遣いから</span>
              <span className="text-base font-bold tabular-nums text-gray-900">{formatPrice(own)}</span>
            </div>
          </div>
          {prize.amount !== null && prize.amount > draw.price && (
            <p className="text-[11px] text-gray-400">商品代が{formatPrice(prize.amount)}より安いので、全額になりました</p>
          )}
        </div>
      ) : (
        <p className="text-center text-[15px] font-bold text-gray-500 pb-4">ガラガラガラ…</p>
      )}
    </ModalShell>
  );
}
