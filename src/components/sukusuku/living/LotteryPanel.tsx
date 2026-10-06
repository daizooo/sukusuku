'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LotteryCoupon, SubsidyDraw } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import {
  insertSubsidyDraw,
  loadMyBirthMonth,
  loadMyCoupons,
  loadSubsidyDraws,
  openLotteryBox,
  markCouponUsed,
  applyRateUpCoupon,
} from '@/lib/api/subsidyDraws';
import {
  allowanceFor,
  isCouponUsable,
  luckyBallFor,
  monthKey,
  parsePrice,
  pickCandidate,
  planDraw,
  priceError,
  remainingDraws,
} from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import SegmentedTabs from '../ui/SegmentedTabs';
import LotteryCouponsView from './LotteryCouponsView';
import LotteryDrawView from './LotteryDrawView';
import LotteryHistoryView from './LotteryHistoryView';
import LotteryResultModal from './LotteryResultModal';

// 暮らしタブの「補助くじ」の面（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryPanel.tsx` と同じ項目・並び・文言。
//
// 家のルール: 趣味以外で必要なものを税込500〜3,000円で買うとき、1人あたり月2回（誕生月は3回）まで、
// 家族のお金から補助を出す。補助率はくじ（ガラポン）で決める（25%・50%・75%・100%）。
// 「くじ」「券」「履歴」の3面。結果はDBへ記録してから見せる（引き直しができない）。

type LotteryView = 'draw' | 'coupons' | 'history';

const VIEW_OPTIONS: { id: LotteryView; label: string }[] = [
  { id: 'draw', label: 'くじ' },
  { id: 'coupons', label: '券' },
  { id: 'history', label: '履歴' },
];

interface LotteryPanelProps {
  familyId: string;
  userId: string;
}

/** くじの結果の画面に渡すもの。 */
interface ResultState {
  draw: SubsidyDraw;
  luckyUp: boolean;
  earnedPush: boolean;
}

export default function LotteryPanel({ familyId, userId }: LotteryPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const [view, setView] = useState<LotteryView>('draw');
  const [draws, setDraws] = useState<SubsidyDraw[]>([]);
  const [coupons, setCoupons] = useState<LotteryCoupon[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [itemName, setItemName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [usePush, setUsePush] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const [loadedDraws, loadedCoupons, loadedMembers, month] = await Promise.all([
          loadSubsidyDraws(supabase, familyId),
          loadMyCoupons(supabase, userId),
          listFamilyMembers(supabase, familyId),
          loadMyBirthMonth(supabase, userId),
        ]);
        if (!isMounted) return;
        setDraws(loadedDraws);
        setCoupons(loadedCoupons);
        setMembers(loadedMembers.map((member) => ({ id: member.id, name: member.name })));
        setBirthMonth(month);
      } catch {
        // 読めなかったぶんは空のままにする。
      } finally {
        if (isMounted) setIsLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [supabase, familyId, userId]);

  const now = new Date();
  const allowance = allowanceFor(birthMonth, now);
  const remaining = remainingDraws(draws, userId, now, birthMonth);
  const pushCoupons = coupons.filter((coupon) => coupon.kind === 'push' && isCouponUsable(coupon, now));
  const rateUpCoupon = coupons.find((coupon) => coupon.kind === 'rate_up' && isCouponUsable(coupon, now)) ?? null;
  const luckyBall = luckyBallFor(`${familyId}:${monthKey(now)}`);
  const effectiveUsePush = usePush && pushCoupons.length > 0;
  const plan = planDraw({ draws, userId, now, birthMonth, luckyBall, usePush: effectiveUsePush });

  const reloadCoupons = useCallback(async () => {
    try {
      setCoupons(await loadMyCoupons(supabase, userId));
    } catch {
      // 読めなかったときは、今の表示のままにする。
    }
  }, [supabase, userId]);

  const spin = async (name: string, price: number) => {
    if (isDrawing) return;
    setIsDrawing(true);
    try {
      const candidate = pickCandidate(plan, Math.random);
      const created = await insertSubsidyDraw(supabase, familyId, userId, {
        itemName: name,
        price,
        ball: candidate.ball.id,
        rate: candidate.rate,
        pushCouponId: effectiveUsePush ? pushCoupons[0].id : null,
      });
      setDraws((prev) => [created, ...prev]);
      setItemName('');
      setPriceText('');
      setUsePush(false);
      setResult({ draw: created, luckyUp: candidate.luckyUp, earnedPush: created.rate === 25 });
      void reloadCoupons();
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

  const rateUp = async (draw: SubsidyDraw, coupon: LotteryCoupon): Promise<SubsidyDraw> => {
    const updated = await applyRateUpCoupon(supabase, draw.id, coupon.id);
    setDraws((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
    void reloadCoupons();
    return updated;
  };

  const openBox = async (draw: SubsidyDraw): Promise<LotteryCoupon[]> => {
    const created = await openLotteryBox(supabase, draw.id);
    setCoupons((prev) => [...created, ...prev]);
    return created;
  };

  const useCoupon = (coupon: LotteryCoupon) => {
    markCouponUsed(supabase, coupon.id)
      .then(() => reloadCoupons())
      .catch(() => window.alert('使えませんでした\nもう一度お試しください。'));
  };

  const canDraw = !isLoading && remaining > 0 && !isDrawing;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <SegmentedTabs ariaLabel="補助くじの表示" value={view} onChange={setView} options={VIEW_OPTIONS} className="shrink-0 mb-2" />

      {view === 'draw' && (
        <LotteryDrawView
          plan={plan}
          isLoading={isLoading}
          allowance={allowance}
          remaining={remaining}
          pushCount={pushCoupons.length}
          usePush={effectiveUsePush}
          onUsePush={setUsePush}
          itemName={itemName}
          priceText={priceText}
          onItemName={setItemName}
          onPriceText={setPriceText}
          error={error}
          canDraw={canDraw}
          onSubmit={confirmSpin}
        />
      )}
      {view === 'coupons' && <LotteryCouponsView coupons={coupons} isLoading={isLoading} now={now} onUse={useCoupon} />}
      {view === 'history' && (
        <LotteryHistoryView draws={draws} members={members} myId={userId} isLoading={isLoading} now={now} />
      )}

      {result !== null && (
        <LotteryResultModal
          draw={result.draw}
          luckyUp={result.luckyUp}
          earnedPush={result.earnedPush}
          rateUpCoupon={rateUpCoupon}
          coupons={coupons}
          onRateUp={rateUp}
          onOpenBox={openBox}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
