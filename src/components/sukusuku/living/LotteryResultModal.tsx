'use client';

import { useEffect, useState } from 'react';
import { Gift, Loader2 } from 'lucide-react';
import type { LotteryCoupon, SubsidyDraw } from '@/types/app';
import { COUPON_INFO, ballOf, collectionProgress } from '@/lib/subsidyLotteryUtils';
import { formatPrice } from '@/lib/shoppingUtils';
import { ModalShell } from '../modals/TaskForm';
import LotteryBall, { BALL_COLOR } from './LotteryBall';

// 補助くじの結果（docs/home.md §9）。mobile版の `mobile/src/components/living/LotteryResultSheet.tsx` と
// 同じ流れ・同じ文言。結果はこの枠を出す前にDBへ記録してある（見てから引き直せない）。
//
// 「ガラガラガラ…」と玉が揺れてから、出た玉が弾むように出る。
// 25%か50%なら、補助率アップ券があれば「使う」で1段上げられる。
// 100%なら、3つの箱から1つ選んで開ける（中身は図鑑でまだ集めていない特典）。

/** 玉が揺れている時間（ミリ秒）。 */
const SPIN_MS = 1400;

const BOX_TONES = ['#f59e0b', '#3b82f6', '#f43f5e'];

const formatLimit = (iso: string | null) => {
  if (!iso) return '期限なし';
  const date = new Date(iso);
  return `${date.getMonth() + 1}月${date.getDate()}日まで`;
};

interface LotteryResultModalProps {
  draw: SubsidyDraw;
  /** ラッキーカラーで1段上がったか。 */
  luckyUp: boolean;
  /** 25%でひと押し券を1枚もらったか。 */
  earnedPush: boolean;
  /** 使える補助率アップ券（なければ null）。 */
  rateUpCoupon: LotteryCoupon | null;
  /** 今までの券（図鑑の進み具合を出すのに使う）。 */
  coupons: LotteryCoupon[];
  onRateUp: (draw: SubsidyDraw, coupon: LotteryCoupon) => Promise<SubsidyDraw>;
  onOpenBox: (draw: SubsidyDraw) => Promise<LotteryCoupon[]>;
  onClose: () => void;
}

export default function LotteryResultModal({
  draw: initialDraw,
  luckyUp,
  earnedPush,
  rateUpCoupon,
  coupons,
  onRateUp,
  onOpenBox,
  onClose,
}: LotteryResultModalProps) {
  const [draw, setDraw] = useState(initialDraw);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rateUpDone, setRateUpDone] = useState(false);
  const [opened, setOpened] = useState<LotteryCoupon[] | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setRevealed(true), SPIN_MS);
    return () => clearTimeout(timer);
  }, []);

  const ball = ballOf(draw.ball);
  const full = draw.rate === 100;
  const canRateUp = revealed && !rateUpDone && !draw.rateUpUsed && rateUpCoupon !== null && draw.rate <= 50;

  const rateUp = () => {
    if (!rateUpCoupon || busy) return;
    if (!window.confirm(`補助率アップ券を使いますか？\n${draw.rate}%の結果が1段上がります。`)) return;
    setBusy(true);
    onRateUp(draw, rateUpCoupon)
      .then((updated) => {
        setDraw(updated);
        setRateUpDone(true);
      })
      .catch(() => window.alert('使えませんでした\nもう一度お試しください。'))
      .finally(() => setBusy(false));
  };

  const openBox = () => {
    if (busy) return;
    setBusy(true);
    onOpenBox(draw)
      .then((created) => setOpened(created))
      .catch(() => window.alert('箱を開けられませんでした\nもう一度お試しください。'))
      .finally(() => setBusy(false));
  };

  const perk = opened?.find((coupon) => coupon.slot !== null) ?? null;
  const trip = opened?.find((coupon) => coupon.kind === 'trip') ?? null;
  const progress = collectionProgress([...(opened ?? []), ...coupons.filter((coupon) => !opened?.some((o) => o.id === coupon.id))]);

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
            <LotteryBall ball={draw.ball} size={120} />
          </span>
        ) : (
          <span className="lottery-shake">
            <LotteryBall ball={null} size={120} />
          </span>
        )}
      </div>

      {revealed ? (
        <div className="space-y-2 text-center">
          <p className="text-xl font-bold" style={{ color: BALL_COLOR[draw.ball].text }}>
            {ball.ball}！ {ball.name}
          </p>
          <p className="text-[15px] font-bold text-gray-900 tabular-nums">補助率 {draw.rate}%</p>
          {luckyUp && !draw.rateUpUsed && (
            <p className="text-xs font-bold text-amber-700">
              ラッキーカラー！ {ball.ball}が1段アップ（{ball.rate}% → {draw.rate}%）
            </p>
          )}
          {draw.rateUpUsed && <p className="text-xs font-bold text-amber-700">補助率アップ券を使いました</p>}
          <p className="text-[13px] text-gray-700">{ball.message}</p>
          <div className="mt-1 space-y-1.5 rounded-xl bg-gray-100 p-3 text-left">
            {full ? (
              <p className="text-center text-[15px] font-bold text-amber-700">全額、家族のお金で買えます</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-gray-700">家族のお金から</span>
                  <span className="text-base font-bold tabular-nums text-blue-600">{formatPrice(draw.subsidy)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-gray-700">あなたのお小遣いから</span>
                  <span className="text-base font-bold tabular-nums text-gray-900">
                    {formatPrice(draw.price - draw.subsidy)}
                  </span>
                </div>
              </>
            )}
          </div>
          {earnedPush && (
            <p className="text-[11px] text-gray-400">ひと押し券を1枚もらいました（次のガラポンで25%が出なくなります）</p>
          )}

          {canRateUp && (
            <button
              type="button"
              onClick={rateUp}
              disabled={busy}
              className="w-full rounded-xl border border-amber-200 bg-amber-50 py-3 text-sm font-bold text-amber-700 hover:bg-amber-100 transition disabled:opacity-60"
            >
              補助率アップ券を使う（{draw.rate}% → {draw.rate + 25}%）
            </button>
          )}

          {full && opened === null && (
            <div className="space-y-2 pt-1">
              <p className="text-sm font-bold text-gray-900">福の神の箱を1つ選んでください</p>
              <div className="flex justify-center gap-3">
                {BOX_TONES.map((tint, index) => (
                  <button
                    key={tint}
                    type="button"
                    aria-label={`箱${index + 1}を開ける`}
                    onClick={openBox}
                    disabled={busy}
                    className="flex h-20 w-20 items-center justify-center rounded-2xl border-2 bg-white transition hover:bg-gray-50 disabled:opacity-60"
                    style={{ borderColor: tint, color: tint }}
                  >
                    {busy ? <Loader2 size={28} className="animate-spin" /> : <Gift size={30} />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {perk && (
            <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-[11px] font-bold text-amber-700">箱の中身</p>
              <p className="text-[17px] font-bold text-gray-900">{COUPON_INFO[perk.kind].name}</p>
              <p className="text-xs text-gray-500">{formatLimit(perk.expiresAt)}</p>
              <p className="text-xs font-bold tabular-nums text-gray-700">図鑑 {trip ? 6 : progress.collected.length} / 6</p>
              {trip && (
                <p className="text-[13px] font-bold text-green-700">
                  6つそろいました！ {COUPON_INFO.trip.name}をゲット（券の画面にあります）
                </p>
              )}
            </div>
          )}
        </div>
      ) : (
        <p className="text-center text-[15px] font-bold text-gray-500 pb-4">ガラガラガラ…</p>
      )}
    </ModalShell>
  );
}
