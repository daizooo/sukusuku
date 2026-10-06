import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import type { LotteryCoupon, SubsidyBallId, SubsidyDraw } from '@/types/app';
import { supabase } from '@/lib/supabase';
import { listFamilyMembers } from '@/lib/api/familyMembers';
import {
  insertSubsidyDraw,
  loadMyBirthMonth,
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
import LotteryCouponsView from '@/components/living/LotteryCouponsView';
import LotteryDialog from '@/components/living/LotteryDialog';
import LotteryDrawView, { type LotteryDialogKind } from '@/components/living/LotteryDrawView';
import LotteryHelpSheet from '@/components/living/LotteryHelpSheet';
import LotteryHistoryView from '@/components/living/LotteryHistoryView';
import LotteryPrizesView from '@/components/living/LotteryPrizesView';
import LotteryResultSheet from '@/components/living/LotteryResultSheet';

// 暮らしタブの「補助くじ」の面（docs/home.md §9）。PWA版の
// `src/components/sukusuku/living/LotteryPanel.tsx` と同じ項目・並び・文言。
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
  familyId: string | null;
  userId: string;
}

/** くじの結果の画面に渡すもの。 */
interface ResultState {
  draw: SubsidyDraw;
  luckyUp: boolean;
  earnedPush: boolean;
}

export default function LotteryPanel({ familyId, userId }: LotteryPanelProps) {
  const [dialog, setDialog] = useState<LotteryDialogKind | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [dropBall, setDropBall] = useState<SubsidyBallId | null>(null);
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
  const [testMode, setTestMode] = useState(false);
  const [isDeletingTest, setIsDeletingTest] = useState(false);

  useEffect(() => {
    if (!familyId) return;
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
  }, [familyId, userId]);

  // テストモードでは、本物と別のくじ・券だけを見せて数える（月の回数は減らない）。
  const shownDraws = useMemo(() => draws.filter((draw) => draw.isTest === testMode), [draws, testMode]);
  const shownCoupons = useMemo(() => coupons.filter((coupon) => coupon.isTest === testMode), [coupons, testMode]);
  const testCount = draws.filter((draw) => draw.isTest).length + coupons.filter((coupon) => coupon.isTest).length;

  const now = new Date();
  const allowance = allowanceFor(birthMonth, now);
  const remaining = testMode ? allowance : remainingDraws(shownDraws, userId, now, birthMonth);
  const pushCoupons = useMemo(
    () => shownCoupons.filter((coupon) => coupon.kind === 'push' && isCouponUsable(coupon, new Date())),
    [shownCoupons],
  );
  const usableCoupons = shownCoupons.filter((coupon) => isCouponUsable(coupon, now));
  const rateUpCoupon = shownCoupons.find((coupon) => coupon.kind === 'rate_up' && isCouponUsable(coupon, now)) ?? null;
  const luckyBall = luckyBallFor(`${familyId ?? ''}:${monthKey(now)}`);
  const effectiveUsePush = usePush && pushCoupons.length > 0;
  const plan = planDraw({ draws: shownDraws, userId, now, birthMonth, luckyBall, usePush: effectiveUsePush });

  const reloadCoupons = useCallback(async () => {
    try {
      setCoupons(await loadMyCoupons(supabase, userId));
    } catch {
      // 読めなかったときは、今の表示のままにする。
    }
  }, [userId]);

  const spin = async (name: string, price: number) => {
    if (!familyId || isDrawing) return;
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
      Alert.alert(
        'くじを引けませんでした',
        '電波のあるところでもう一度お試しください。今月の回数を使い切っているときも引けません。',
      );
    } finally {
      setSpinning(false);
      setDropBall(null);
      setIsDrawing(false);
    }
  };

  const confirmSpin = () => {
    const price = parsePrice(priceText);
    const problem = itemName.trim() === '' ? '買うものを入れてください' : priceError(price);
    setError(problem);
    if (problem !== null || price === null) return;
    const name = itemName.trim();
    Alert.alert(
      'ガラポンを回しますか？',
      testMode
        ? `${name}（税込 ${formatPrice(price)}）\nテストです。今月の福引券は減りません。あとで消せます。`
        : `${name}（税込 ${formatPrice(price)}）\n回すと今月の福引券を1回使います。引き直しはできません。`,
      [
        { text: 'やめる', style: 'cancel' },
        { text: '回す', onPress: () => void spin(name, price) },
      ],
    );
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
      .catch(() => Alert.alert('使えませんでした', 'もう一度お試しください。'));
  };

  const toggleTestMode = (value: boolean) => {
    setTestMode(value);
    setUsePush(false);
    setError(null);
  };

  const deleteTestData = () => {
    Alert.alert(
      'テストデータを削除しますか？',
      `テストで引いたくじ・券（${testCount}件）を消します。本物の履歴・券は消えません。`,
      [
        { text: 'やめる', style: 'cancel' },
        {
          text: '削除する',
          style: 'destructive',
          onPress: () => {
            setIsDeletingTest(true);
            deleteMyTestLotteryData(supabase)
              .then(() => {
                setDraws((prev) => prev.filter((draw) => !draw.isTest));
                setCoupons((prev) => prev.filter((coupon) => !coupon.isTest));
              })
              .catch(() => Alert.alert('削除できませんでした', '電波のあるところでもう一度お試しください。'))
              .finally(() => setIsDeletingTest(false));
          },
        },
      ],
    );
  };

  const canDraw = !isLoading && remaining > 0 && !isDrawing && familyId !== null;

  return (
    <View style={styles.flex}>
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
        <LotteryDialog title="金コレ" onClose={() => setDialog(null)} fill>
          <LotteryCouponsView section="collection" coupons={shownCoupons} isLoading={isLoading} now={now} onUse={useCoupon} />
        </LotteryDialog>
      )}
      {dialog === 'history' && (
        <LotteryDialog title="履歴" onClose={() => setDialog(null)} fill>
          <LotteryHistoryView draws={shownDraws} members={members} myId={userId} isLoading={isLoading} now={now} />
        </LotteryDialog>
      )}
      {dialog === 'help' && (
        <LotteryHelpSheet
          onClose={() => setDialog(null)}
          testMode={testMode}
          onToggleTest={toggleTestMode}
          testCount={testCount}
          onDeleteTest={deleteTestData}
          isDeletingTest={isDeletingTest}
        />
      )}

      {result !== null && (
        <LotteryResultSheet
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
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
});
