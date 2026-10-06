'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LotteryCoupon, SubsidyBallId, SubsidyDraw } from '@/types/app';
import { createClient } from '@/lib/supabase/client';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import {
  insertSubsidyDraw,
  loadMyLotteryProfile,
  loadMyCoupons,
  loadSubsidyDraws,
  openLotteryBox,
  markCouponUsed,
  applyRateUpCoupon,
  deleteMyTestLotteryData,
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
import LotteryCouponsView from './LotteryCouponsView';
import LotteryDialog from './LotteryDialog';
import LotteryDrawView, { type LotteryDialogKind } from './LotteryDrawView';
import LotteryHelpModal from './LotteryHelpModal';
import LotteryHistoryView from './LotteryHistoryView';
import LotteryPrizesView from './LotteryPrizesView';
import LotteryResultModal from './LotteryResultModal';

// 暮らしタブの「お買いもの福引」（旧称「補助くじ」）の面（docs/home.md §9）。mobile版の
// `mobile/src/components/living/LotteryPanel.tsx` と同じ項目・並び・文言。
//
// 家のルール: 趣味以外で必要なものを税込500〜3,000円で買うとき、1人あたり月2回（誕生月は3回）まで、
// 家族のお金から補助を出す。補助率はくじ（ガラポン）で決める（25%・50%・75%・100%）。
// 面はくじのホーム1枚。賞品一覧・券・履歴・ヘルプはホームのボタンから中央の枠で開く。
// 「ガラポン！」→ ホームのガラポンが回る（そのあいだにDBへ記録する）→ 受け皿に玉が出る → 結果の枠。
// 結果はDBへ記録してから見せる（引き直しができない）。

/** ガラポンを回す最短の時間と、玉が受け皿へ転がり出る時間（ミリ秒）。 */
const SPIN_MS = 1600;
const DROP_MS = 900;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
  const [dialog, setDialog] = useState<LotteryDialogKind | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [dropBall, setDropBall] = useState<SubsidyBallId | null>(null);
  const [draws, setDraws] = useState<SubsidyDraw[]>([]);
  const [coupons, setCoupons] = useState<LotteryCoupon[]>([]);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [birthMonth, setBirthMonth] = useState<number | null>(null);
  /** テストモードを出すか（夫だけ）。 */
  const [canTest, setCanTest] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [itemName, setItemName] = useState('');
  const [priceText, setPriceText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [usePush, setUsePush] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [testModeOn, setTestMode] = useState(false);
  const [isDeletingTest, setIsDeletingTest] = useState(false);

  useEffect(() => {
    let isMounted = true;
    void (async () => {
      try {
        const [loadedDraws, loadedCoupons, loadedMembers, profile] = await Promise.all([
          loadSubsidyDraws(supabase, familyId),
          loadMyCoupons(supabase, userId),
          listFamilyMembers(supabase, familyId),
          loadMyLotteryProfile(supabase, userId),
        ]);
        if (!isMounted) return;
        setDraws(loadedDraws);
        setCoupons(loadedCoupons);
        setMembers(loadedMembers.map((member) => ({ id: member.id, name: member.name })));
        setBirthMonth(profile.birthMonth);
        setCanTest(profile.canTest);
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

  // テストモードでは、本物と別のくじ・券だけを見せて数える（月の回数は減らない）。夫のほかは使えない。
  const testMode = canTest && testModeOn;
  const shownDraws = draws.filter((draw) => draw.isTest === testMode);
  const shownCoupons = coupons.filter((coupon) => coupon.isTest === testMode);
  const testCount = draws.filter((draw) => draw.isTest).length + coupons.filter((coupon) => coupon.isTest).length;

  const now = new Date();
  const allowance = allowanceFor(birthMonth, now);
  const remaining = testMode ? allowance : remainingDraws(shownDraws, userId, now, birthMonth);
  const pushCoupons = shownCoupons.filter((coupon) => coupon.kind === 'push' && isCouponUsable(coupon, now));
  const usableCoupons = shownCoupons.filter((coupon) => isCouponUsable(coupon, now));
  const rateUpCoupon = shownCoupons.find((coupon) => coupon.kind === 'rate_up' && isCouponUsable(coupon, now)) ?? null;
  const luckyBall = luckyBallFor(`${familyId}:${monthKey(now)}`);
  const effectiveUsePush = usePush && pushCoupons.length > 0;
  const plan = planDraw({ draws: shownDraws, userId, now, birthMonth, luckyBall, usePush: effectiveUsePush });

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
    setSpinning(true);
    const startedAt = Date.now();
    try {
      const candidate = pickCandidate(plan, Math.random);
      const created = await insertSubsidyDraw(supabase, familyId, userId, {
        itemName: name,
        price,
        ball: candidate.ball.id,
        rate: candidate.rate,
        pushCouponId: effectiveUsePush ? pushCoupons[0].id : null,
        isTest: testMode,
      });
      setDraws((prev) => [created, ...prev]);
      setItemName('');
      setPriceText('');
      setUsePush(false);
      void reloadCoupons();
      // 記録できてから、回し足りない分だけ回し、玉を受け皿へ出してから結果を開く。
      await wait(Math.max(0, SPIN_MS - (Date.now() - startedAt)));
      setDropBall(created.ball);
      await wait(DROP_MS);
      setResult({ draw: created, luckyUp: candidate.luckyUp, earnedPush: created.rate === 25 });
    } catch {
      window.alert(
        'くじを引けませんでした\n電波のあるところでもう一度お試しください。今月の回数を使い切っているときも引けません。',
      );
    } finally {
      setSpinning(false);
      setDropBall(null);
      setIsDrawing(false);
    }
  };

  const confirmSpin = () => {
    const price = parsePrice(priceText);
    const problem = itemName.trim() === '' ? '買いたいものを入れてください' : priceError(price);
    setError(problem);
    if (problem !== null || price === null) return;
    const name = itemName.trim();
    if (
      window.confirm(
        testMode
          ? `ガラポンを回しますか？\n${name}（税込 ${formatPrice(price)}）\nテストです。今月の福引券は減りません。あとで消せます。`
          : `ガラポンを回しますか？\n${name}（税込 ${formatPrice(price)}）\n回すと今月の福引券を1回使います。引き直しはできません。`,
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

  const toggleTestMode = (value: boolean) => {
    setTestMode(value);
    setUsePush(false);
    setError(null);
  };

  const deleteTestData = () => {
    if (
      !window.confirm(
        `テストデータを削除しますか？\nテストで引いたくじ・券（${testCount}件）を消します。本物の履歴・券は消えません。`,
      )
    ) {
      return;
    }
    setIsDeletingTest(true);
    deleteMyTestLotteryData(supabase)
      .then(() => {
        setDraws((prev) => prev.filter((draw) => !draw.isTest));
        setCoupons((prev) => prev.filter((coupon) => !coupon.isTest));
      })
      .catch(() => window.alert('削除できませんでした\n電波のあるところでもう一度お試しください。'))
      .finally(() => setIsDeletingTest(false));
  };

  const canDraw = !isLoading && remaining > 0 && !isDrawing;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <LotteryDrawView
        plan={plan}
        isLoading={isLoading}
        remaining={remaining}
        testMode={testMode}
        pushCount={pushCoupons.length}
        usePush={effectiveUsePush}
        onUsePush={setUsePush}
        couponCount={usableCoupons.length}
        itemName={itemName}
        priceText={priceText}
        onItemName={setItemName}
        onPriceText={setPriceText}
        error={error}
        canDraw={canDraw}
        onSubmit={confirmSpin}
        spinning={spinning}
        dropBall={dropBall}
        onOpen={setDialog}
      />

      {dialog === 'prizes' && (
        <LotteryDialog title="賞品一覧" onClose={() => setDialog(null)}>
          <LotteryPrizesView plan={plan} />
        </LotteryDialog>
      )}
      {dialog === 'coupons' && (
        <LotteryDialog title="持っている券" onClose={() => setDialog(null)} fill>
          <LotteryCouponsView section="coupons" coupons={shownCoupons} isLoading={isLoading} now={now} onUse={useCoupon} />
        </LotteryDialog>
      )}
      {dialog === 'collection' && (
        <LotteryDialog title="金賞コレクション" onClose={() => setDialog(null)} fill>
          <LotteryCouponsView section="collection" coupons={shownCoupons} isLoading={isLoading} now={now} onUse={useCoupon} />
        </LotteryDialog>
      )}
      {dialog === 'history' && (
        <LotteryDialog title="履歴" onClose={() => setDialog(null)} fill>
          <LotteryHistoryView draws={shownDraws} members={members} myId={userId} isLoading={isLoading} now={now} />
        </LotteryDialog>
      )}
      {dialog === 'help' && (
        <LotteryHelpModal
          onClose={() => setDialog(null)}
          canTest={canTest}
          testMode={testMode}
          onToggleTest={toggleTestMode}
          testCount={testCount}
          onDeleteTest={deleteTestData}
          isDeletingTest={isDeletingTest}
        />
      )}

      {result !== null && (
        <LotteryResultModal
          draw={result.draw}
          luckyUp={result.luckyUp}
          earnedPush={result.earnedPush}
          rateUpCoupon={rateUpCoupon}
          coupons={shownCoupons}
          onRateUp={rateUp}
          onOpenBox={openBox}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
