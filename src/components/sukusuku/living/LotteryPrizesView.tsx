'use client';

import { BALLS, NOTE_TEXT, upRate, type DrawPlan } from '@/lib/subsidyLotteryUtils';
import LotteryBall, { BALL_COLOR } from './LotteryBall';

// お買いもの福引の「賞品一覧」（ホームのボタンから中央の枠で開く。docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryPrizesView.tsx` と同じ項目・並び・文言。
// 玉の絵・賞の名前・補助率だけを出す（玉の色の名前は文字にしない。確率は出さない。％が確率に見えないよう「補助率」と添える）。今月のラッキーカラーの玉には印を付け、
// いま効いている救済があれば下に並べる。

export default function LotteryPrizesView({ plan }: { plan: DrawPlan }) {
  return (
    <div className="space-y-2 p-4">
      {BALLS.map((ball) => {
        const lucky = ball.id === plan.luckyBall;
        return (
          <div
            key={ball.id}
            className={`flex items-center gap-3 rounded-[14px] px-3 py-2.5 ${
              lucky ? 'border border-amber-200 bg-amber-50' : 'bg-gray-100'
            }`}
          >
            <LotteryBall ball={ball.id} size={32} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold" style={{ color: BALL_COLOR[ball.id].text }}>
                {ball.name}
              </p>
              {lucky && <p className="text-[11px] font-bold text-amber-700">ラッキー！今月は補助率{upRate(ball.rate)}%</p>}
            </div>
            <div className="text-right">
              <p className="text-[10px] font-bold text-gray-500">補助率</p>
              <p className="text-xl font-extrabold tabular-nums text-gray-900">{ball.rate}%</p>
            </div>
          </div>
        );
      })}
      {plan.notes.length > 0 && (
        <div className="space-y-1 pt-2">
          <p className="text-xs font-bold text-gray-500">今回のおまけ</p>
          {plan.notes.map((note) => (
            <p key={note} className="text-xs text-gray-700">
              {NOTE_TEXT[note]}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
