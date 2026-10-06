'use client';

import { useState } from 'react';
import { CircleQuestionMark, Ticket } from 'lucide-react';
import {
  BALLS,
  MONTHLY_LIMIT,
  NOTE_TEXT,
  PRICE_MAX,
  PRICE_MIN,
  ballOf,
  type DrawPlan,
} from '@/lib/subsidyLotteryUtils';
import LotteryBall from './LotteryBall';
import LotteryHelpModal from './LotteryHelpModal';

// 補助くじの「くじ」の面（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryDrawView.tsx` と同じ項目・並び・文言。
// ルール・今月の福引券・今回の救済・入力・補助率ごとの確率。

interface LotteryDrawViewProps {
  plan: DrawPlan;
  isLoading: boolean;
  /** 今月引ける回数（誕生月は3回）と、あと何回か。 */
  allowance: number;
  remaining: number;
  /** 使えるひと押し券の枚数と、使うか。 */
  pushCount: number;
  usePush: boolean;
  onUsePush: (value: boolean) => void;
  itemName: string;
  priceText: string;
  onItemName: (value: string) => void;
  onPriceText: (value: string) => void;
  error: string | null;
  canDraw: boolean;
  onSubmit: () => void;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-[15px] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100';
const cardClass = 'space-y-2 rounded-xl border border-gray-200 bg-white p-3';

export default function LotteryDrawView({
  plan,
  isLoading,
  allowance,
  remaining,
  pushCount,
  usePush,
  onUsePush,
  itemName,
  priceText,
  onItemName,
  onPriceText,
  error,
  canDraw,
  onSubmit,
}: LotteryDrawViewProps) {
  const lucky = ballOf(plan.luckyBall);
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-6">
      <div className={cardClass}>
        <div className="flex items-start gap-2">
          <p className="flex-1 text-xs text-gray-700">
            趣味以外で必要なもの・税込{PRICE_MIN.toLocaleString('ja-JP')}〜{PRICE_MAX.toLocaleString('ja-JP')}円なら、
            月{MONTHLY_LIMIT}回（誕生月は{MONTHLY_LIMIT + 1}回）まで、家族のお金から補助が出ます
          </p>
          <button
            type="button"
            aria-label="補助くじのルールを見る"
            onClick={() => setHelpOpen(true)}
            className="shrink-0 rounded-full text-blue-500 hover:text-blue-600 transition"
          >
            <CircleQuestionMark size={22} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">今月の福引券</span>
          <span className="flex gap-1">
            {Array.from({ length: allowance }, (_, index) => (
              <Ticket
                key={index}
                size={22}
                className={index < remaining ? 'text-amber-500' : 'text-gray-300'}
                fill={index < remaining ? '#fef3c7' : 'none'}
              />
            ))}
          </span>
          <span className="text-sm font-bold tabular-nums text-gray-900">
            {isLoading ? '…' : remaining > 0 ? `あと${remaining}回` : '使い切りました'}
          </span>
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex items-center gap-2">
          <LotteryBall ball={plan.luckyBall} size={18} />
          <p className="text-xs font-bold text-amber-700">今月のラッキーカラーは{lucky.ball}。出たら補助率が1段アップ</p>
        </div>
        {plan.notes.map((note) => (
          <p key={note} className="text-xs text-gray-700">
            {NOTE_TEXT[note]}
          </p>
        ))}
        {plan.floor > 25 && (
          <p className="text-sm font-bold text-green-700">
            今回は{plan.floor === 100 ? '100%が確定！' : `${plan.floor}%以上が確定！`}
          </p>
        )}
        {pushCount > 0 && (
          <label className="flex items-center justify-between">
            <span className="text-[13px] font-bold text-gray-900">ひと押し券を使う（{pushCount}枚）</span>
            <input
              type="checkbox"
              checked={usePush}
              onChange={(event) => onUsePush(event.target.checked)}
              disabled={remaining <= 0}
              className="h-5 w-5 accent-blue-500"
            />
          </label>
        )}
      </div>

      <div className={cardClass}>
        <input
          className={inputClass}
          value={itemName}
          onChange={(event) => onItemName(event.target.value)}
          placeholder="買うもの（例: 洗濯ネット）"
          disabled={remaining <= 0}
        />
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={priceText}
            onChange={(event) => onPriceText(event.target.value)}
            inputMode="numeric"
            placeholder="税込の価格（円）"
            disabled={remaining <= 0}
          />
          <button
            type="button"
            disabled={!canDraw}
            onClick={onSubmit}
            className="shrink-0 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-600 transition disabled:bg-gray-300 disabled:hover:bg-gray-300"
          >
            ガラポン！
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {plan.odds.map((entry) => {
            const ball = BALLS.find((item) => item.rate === entry.rate) ?? BALLS[0];
            return (
              <span key={entry.rate} className="flex items-center gap-1 text-[11px] font-bold tabular-nums text-gray-500">
                <LotteryBall ball={ball.id} size={14} />
                {entry.rate}% {entry.percent}%
              </span>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-400">左が補助率、右が今回の出る確率（救済を含む）</p>
      </div>
      {helpOpen && <LotteryHelpModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
