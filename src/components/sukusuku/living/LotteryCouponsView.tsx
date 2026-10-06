'use client';

import type { LotteryCoupon } from '@/types/app';
import {
  COLLECTION_SLOTS,
  COUPON_INFO,
  collectionProgress,
  daysLeft,
  isCouponUsable,
  isLotteryCoupon,
} from '@/lib/subsidyLotteryUtils';

// 補助くじの「券」と「金コレ」（金賞コレクション）の枠（docs/home.md §9.5）。mobile版の
// `mobile/src/components/living/LotteryCouponsView.tsx` と同じ項目・並び・文言。
// - 券: 自分の使える券（アカウントごと）。持っているときだけホームにボタンが出る
// - 金コレ: 金玉の箱から出た特典の6枠と、使った券・期限切れの券。そろえたごほうびは書かない（出たときのお楽しみ）

interface LotteryCouponsViewProps {
  /** どちらを出すか（券＝使える券、金コレ＝6枠と使った・期限切れの券）。 */
  section: 'coupons' | 'collection';
  coupons: LotteryCoupon[];
  isLoading: boolean;
  now: Date;
  /** 「使った」にする（ひと押し券・補助率アップ券以外）。 */
  onUse: (coupon: LotteryCoupon) => void;
}

const limitText = (coupon: LotteryCoupon, now: Date) => {
  const days = daysLeft(coupon, now);
  if (days === null) return '期限なし';
  const date = new Date(coupon.expiresAt as string);
  return `${date.getMonth() + 1}/${date.getDate()}まで（あと${days}日）`;
};

export default function LotteryCouponsView({ section, coupons, isLoading, now, onUse }: LotteryCouponsViewProps) {
  const progress = collectionProgress(coupons);
  const usable = coupons.filter((coupon) => isCouponUsable(coupon, now));
  const past = coupons.filter((coupon) => !isCouponUsable(coupon, now)).slice(0, 10);

  const confirmUse = (coupon: LotteryCoupon) => {
    if (window.confirm(`「${COUPON_INFO[coupon.kind].name}」を使いましたか？\n使った券にします。元には戻せません。`)) {
      onUse(coupon);
    }
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pb-6">
      {section === 'collection' && (
        <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex-1 text-[11px] text-gray-400">金玉の箱から出た特典を集めよう。6つそろうと…？</p>
            <span className="shrink-0 text-[13px] font-bold tabular-nums text-amber-700">
              {progress.cycle}周目 {progress.collected.length} / 6
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {COLLECTION_SLOTS.map((entry) => {
              const got = progress.collected.includes(entry.slot);
              return (
                <div
                  key={entry.slot}
                  className={`min-h-16 space-y-0.5 rounded-lg p-2 ${
                    got ? 'border border-amber-200 bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <p className="text-[10px] font-bold">{entry.slot}</p>
                  <p className="text-xs font-bold">{got ? COUPON_INFO[entry.kind].name : '？'}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {section === 'coupons' && (isLoading ? (
        <p className="py-4 text-center text-[13px] text-gray-400">読み込み中...</p>
      ) : usable.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-gray-400">
          使える券はありません
        </p>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {usable.map((coupon) => (
            <li key={coupon.id} className="flex items-center gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-gray-900">{COUPON_INFO[coupon.kind].name}</p>
                <p className="mt-0.5 text-[11px] text-gray-500">{COUPON_INFO[coupon.kind].description}</p>
                <p className="mt-0.5 text-[11px] font-bold tabular-nums text-amber-700">{limitText(coupon, now)}</p>
              </div>
              {isLotteryCoupon(coupon.kind) ? (
                <span className="shrink-0 text-[11px] font-bold text-gray-400">くじで使う</span>
              ) : (
                <button
                  type="button"
                  onClick={() => confirmUse(coupon)}
                  className="shrink-0 rounded-full bg-blue-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-600 transition"
                >
                  使った
                </button>
              )}
            </li>
          ))}
        </ul>
      ))}

      {section === 'collection' && past.length > 0 && (
        <>
          <h3 className="px-1 pt-1 text-xs font-bold text-gray-500">使用済み・期限切れ</h3>
          <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {past.map((coupon) => (
              <li key={coupon.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="min-w-0 flex-1 text-sm font-bold text-gray-400">{COUPON_INFO[coupon.kind].name}</span>
                <span className="shrink-0 text-[11px] font-bold text-gray-400">{coupon.usedAt ? '使用済み' : '期限切れ'}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
