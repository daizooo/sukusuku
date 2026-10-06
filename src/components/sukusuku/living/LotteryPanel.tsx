'use client';

import { useEffect, useMemo, useState } from 'react';
import { Ticket } from 'lucide-react';
import type { SubsidyDraw } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import { insertSubsidyDraw, loadSubsidyDraws } from '@/lib/api/subsidyDraws';
import {
  MONTHLY_LIMIT,
  PITY_STREAK,
  PRICE_LIMIT,
  PRIZES,
  formatMonth,
  groupByMonth,
  isPity,
  missStreak,
  oddsPercent,
  parsePrice,
  pickPrize,
  priceError,
  prizeOf,
  remainingDraws,
  subsidyFor,
} from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import LotteryBall, { PRIZE_COLOR } from './LotteryBall';
import LotteryResultModal from './LotteryResultModal';

// 暮らしタブの「補助くじ」の面（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryPanel.tsx` と同じ項目・並び・文言。
//
// 家のルール: 趣味以外で必要なものを税込3,000円未満で買うとき、1人あたり月2回まで、
// 家族のお金から補助を出す。補助の額はくじ（ガラポン）で決める。
// 上（固定）にルール・今月の残り・入力、下（スクロール）に月ごとの履歴。
// 結果はDBへ記録してから見せる（引き直しができない）。

interface LotteryPanelProps {
  familyId: string;
  userId: string;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-[15px] tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100';

export default function LotteryPanel({ familyId, userId }: LotteryPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [draws, setDraws] = useState<SubsidyDraw[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [itemName, setItemName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [result, setResult] = useState<SubsidyDraw | null>(null);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const [loaded, members] = await Promise.all([
          loadSubsidyDraws(supabase, familyId),
          listFamilyMembers(supabase, familyId),
        ]);
        if (!isMounted) return;
        setDraws(loaded);
        setNames(Object.fromEntries(members.map((member) => [member.id, member.name])));
      } catch {
        // 読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId]);

  const now = new Date();
  const remaining = remainingDraws(draws, userId, now);
  const streak = missStreak(draws, userId);
  const odds = oddsPercent(streak);
  const groups = useMemo(() => groupByMonth(draws), [draws]);

  const spin = async (name: string, price: number) => {
    if (isDrawing) return;
    setIsDrawing(true);
    try {
      const prize = pickPrize(Math.random, streak);
      const created = await insertSubsidyDraw(supabase, familyId, userId, {
        itemName: name,
        price,
        prize: prize.id,
        subsidy: subsidyFor(prize.id, price),
      });
      setDraws((prev) => [created, ...prev]);
      setItemName('');
      setPriceText('');
      setResult(created);
    } catch {
      window.alert(
        'くじを引けませんでした\n電波のあるところでもう一度お試しください。今月の回数を使い切っているときも引けません。',
      );
    } finally {
      setIsDrawing(false);
    }
  };

  const confirmSpin = () => {
    const price = parsePrice(priceText);
    const problem = itemName.trim() === '' ? '買うものを入れてください' : priceError(price);
    setError(problem);
    if (problem !== null || price === null) return;
    const name = itemName.trim();
    if (
      window.confirm(
        `ガラポンを回しますか？\n${name}（税込 ${formatPrice(price)}）\n回すと今月の福引券を1回使います。引き直しはできません。`,
      )
    ) {
      void spin(name, price);
    }
  };

  const canDraw = !isLoading && remaining > 0 && !isDrawing;

  return (
    <>
      <div className="shrink-0 mb-2 space-y-2 rounded-xl border border-gray-200 bg-white p-3">
        <p className="text-xs text-gray-700">
          趣味以外で必要なもの・税込{PRICE_LIMIT.toLocaleString('ja-JP')}円未満なら、月{MONTHLY_LIMIT}回まで
          家族のお金から補助が出ます
        </p>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500">今月の福引券</span>
          <span className="flex gap-1">
            {Array.from({ length: MONTHLY_LIMIT }, (_, index) => (
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
        {streak > 0 && (
          <p className={`text-xs font-bold ${isPity(streak) ? 'text-green-700' : 'text-gray-500'}`}>
            {isPity(streak)
              ? `ティッシュ${streak}連続。次は白玉が抜けます`
              : `ティッシュ${streak}連続。あと${PITY_STREAK - streak}回続くと、次は白玉が抜けます`}
          </p>
        )}
      </div>

      <div className="shrink-0 mb-2 space-y-2 rounded-xl border border-gray-200 bg-white p-3">
        <input
          className={inputClass}
          value={itemName}
          onChange={(event) => setItemName(event.target.value)}
          placeholder="買うもの（例: 洗濯ネット）"
          disabled={remaining <= 0}
        />
        <div className="flex items-center gap-2">
          <input
            className={inputClass}
            value={priceText}
            onChange={(event) => setPriceText(event.target.value)}
            inputMode="numeric"
            placeholder="税込の価格（円）"
            disabled={remaining <= 0}
          />
          <button
            type="button"
            disabled={!canDraw}
            onClick={confirmSpin}
            className="shrink-0 rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-600 transition disabled:bg-gray-300 disabled:hover:bg-gray-300"
          >
            ガラポン！
          </button>
        </div>
        {error && <p className="text-xs text-red-500">{error}</p>}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {PRIZES.map((prize) => {
            const percent = odds.find((entry) => entry.prize.id === prize.id)?.percent ?? 0;
            return (
              <span key={prize.id} className="flex items-center gap-1 text-[11px] font-bold tabular-nums text-gray-500">
                <LotteryBall prize={prize.id} size={14} />
                {prize.amount === null ? '全額' : prize.amount === 0 ? '自腹' : formatPrice(prize.amount)} {percent}%
              </span>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
      ) : draws.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-gray-400 text-center">まだ引いていません。買うものと価格を入れて、ガラポン！</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pb-6">
          {groups.map((group) => (
            <section key={group.month} className="space-y-1">
              <div className="flex items-baseline justify-between px-1">
                <h3 className="text-[13px] font-bold text-gray-700">{formatMonth(group.month, now)}</h3>
                <span className="text-[11px] font-bold tabular-nums text-gray-500">
                  家族のお金から {formatPrice(group.subsidyTotal)}（{group.draws.length}回）
                </span>
              </div>
              <ul className="rounded-xl border border-gray-200 bg-white overflow-hidden divide-y divide-gray-200">
                {group.draws.map((draw) => {
                  const date = new Date(draw.drawnAt);
                  const who = draw.drawnBy ? (names[draw.drawnBy] ?? '家族') : '家族';
                  return (
                    <li key={draw.id} className="flex items-center gap-2.5 px-3 py-2.5">
                      <LotteryBall prize={draw.prize} size={28} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-gray-900">{draw.itemName || '（名前なし）'}</p>
                        <p className="mt-0.5 text-[11px] tabular-nums text-gray-400">
                          {who}・{date.getMonth() + 1}/{date.getDate()}・税込 {formatPrice(draw.price)}・
                          {prizeOf(draw.prize).name}
                        </p>
                      </div>
                      <span
                        className="text-sm font-bold tabular-nums"
                        style={{ color: draw.subsidy === 0 ? '#9ca3af' : PRIZE_COLOR[draw.prize].text }}
                      >
                        {draw.subsidy === 0 ? '自腹' : formatPrice(draw.subsidy)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      {result !== null && <LotteryResultModal draw={result} onClose={() => setResult(null)} />}
    </>
  );
}
