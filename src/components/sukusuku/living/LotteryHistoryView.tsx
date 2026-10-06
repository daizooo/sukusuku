'use client';

import { useState } from 'react';
import type { SubsidyDraw } from '@/types/app';
import { ballOf, formatMonth, groupByMonth } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LotteryBall from './LotteryBall';

// 補助くじの「履歴」の面（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryHistoryView.tsx` と同じ項目・並び・文言。
// アカウント（家族）ごとに、過去のくじを月ごとに見る。家計の合計は出さない。

interface LotteryHistoryViewProps {
  draws: SubsidyDraw[];
  /** アカウントを持つ家族。 */
  members: { id: string; name: string }[];
  myId: string;
  isLoading: boolean;
  now: Date;
}

export default function LotteryHistoryView({ draws, members, myId, isLoading, now }: LotteryHistoryViewProps) {
  const [selected, setSelected] = useState(myId);
  const shown = draws.filter((draw) => draw.drawnBy === selected);
  const groups = groupByMonth(shown);

  return (
    <>
      <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-2">
        {members.map((member) => {
          const isSelected = member.id === selected;
          return (
            <button
              key={member.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelected(member.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold transition ${
                isSelected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {member.id === myId ? `${member.name}（自分）` : member.name}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <p className="py-8 text-center text-sm text-gray-400">読み込み中...</p>
      ) : shown.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-center text-sm text-gray-400">まだ引いていません</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-6">
          {groups.map((group) => (
            <section key={group.month} className="space-y-1">
              <div className="flex items-baseline justify-between px-1">
                <h3 className="text-[13px] font-bold text-gray-700">{formatMonth(group.month, now)}</h3>
                <span className="text-[11px] font-bold tabular-nums text-gray-500">{group.draws.length}回</span>
              </div>
              <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {group.draws.map((draw) => {
                  const date = new Date(draw.drawnAt);
                  return (
                    <li key={draw.id} className="flex items-center gap-2.5 px-3 py-2.5">
                      <LotteryBall ball={draw.ball} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-gray-900">{draw.itemName || '（名前なし）'}</p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
                          {date.getMonth() + 1}/{date.getDate()}・税込 {formatPrice(draw.price)}・{ballOf(draw.ball).name}
                          {draw.rateUpUsed ? '・アップ券' : ''}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold tabular-nums text-gray-900">{draw.rate}%</p>
                        <p className="text-[11px] font-bold tabular-nums text-gray-500">
                          {draw.rate === 100 ? '全額' : formatPrice(draw.subsidy)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
