'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  deletePushSubscription,
  hasPushSubscription,
  savePushSubscription,
} from '@/lib/api/pushSubscriptions';
import {
  extractSubscriptionKeys,
  getExistingSubscription,
  isIosStandaloneRequired,
  isPushSupported,
  subscribeToPush,
  VAPID_PUBLIC_KEY,
} from '@/lib/push';

interface NotificationSettingProps {
  familyId: string;
  userId: string;
  /** 同じ枠の中に続けて出す通知の設定（授乳の目安・検温のお知らせ）。 */
  children?: ReactNode;
}

// 予定のリマインダーをこの端末で受け取るかどうかの設定。
// 購読は端末ごとなので、スマホとPCそれぞれでオンにする必要がある。
export default function NotificationSetting({ familyId, userId, children }: NotificationSettingProps) {
  const supabase = useMemo(() => createClient(), []);
  const [isEnabled, setIsEnabled] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      if (!isPushSupported()) {
        if (!cancelled) {
          setUnavailableReason(
            isIosStandaloneRequired()
              ? 'iPhone・iPadでは、ホーム画面に追加したアプリから開いたときだけ通知を使えます。共有メニューの「ホーム画面に追加」から追加してください。'
              : 'このブラウザは通知に対応していません。',
          );
          setIsChecking(false);
        }
        return;
      }
      if (!VAPID_PUBLIC_KEY) {
        if (!cancelled) {
          setUnavailableReason('通知の設定が未完了です（NEXT_PUBLIC_VAPID_PUBLIC_KEY が未設定）。');
          setIsChecking(false);
        }
        return;
      }

      try {
        const subscription = await getExistingSubscription();
        // ブラウザ側に購読があってもDBから消えていることがある
        // (送信に失敗し続けた購読はEdge Functionが削除するため)。
        // 両方そろっているときだけ「オン」とみなす。
        const enabled =
          subscription !== null &&
          Notification.permission === 'granted' &&
          (await hasPushSubscription(supabase, subscription.endpoint));
        if (!cancelled) setIsEnabled(enabled);
      } catch (err) {
        console.error('Failed to check push subscription:', err);
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    };

    check();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const enable = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const subscription = await subscribeToPush();
      await savePushSubscription(supabase, familyId, userId, extractSubscriptionKeys(subscription));
      setIsEnabled(true);
    } catch (err) {
      console.error('Failed to enable notifications:', err);
      setError(err instanceof Error ? err.message : '通知をオンにできませんでした');
    } finally {
      setIsBusy(false);
    }
  }, [supabase, familyId, userId]);

  const disable = useCallback(async () => {
    setIsBusy(true);
    setError(null);
    try {
      const subscription = await getExistingSubscription();
      if (subscription) {
        await deletePushSubscription(supabase, subscription.endpoint);
        await subscription.unsubscribe();
      }
      setIsEnabled(false);
    } catch (err) {
      console.error('Failed to disable notifications:', err);
      setError(err instanceof Error ? err.message : '通知をオフにできませんでした');
    } finally {
      setIsBusy(false);
    }
  }, [supabase]);

  return (
    <section className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
      {/* この端末で受け取るかどうかのトグルが、授乳の目安・検温を含む通知すべての入り口。 */}
      <div className="flex items-center gap-2">
        <BellRing size={18} className="text-blue-500" />
        <h3 className="flex-1 font-bold text-gray-800">通知</h3>
        {!unavailableReason && (
          <button
            type="button"
            onClick={isEnabled ? disable : enable}
            disabled={isChecking || isBusy}
            aria-label="通知の切り替え"
            aria-pressed={isEnabled}
            className={`w-11 h-6 rounded-full relative flex-none transition-colors disabled:opacity-50 ${
              isEnabled ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            {isBusy ? (
              <Loader2 size={14} className="animate-spin text-white absolute inset-0 m-auto" />
            ) : (
              <div
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-all ${
                  isEnabled ? 'left-5.5' : 'left-0.5'
                }`}
              />
            )}
          </button>
        )}
      </div>

      {unavailableReason && <p className="text-xs text-red-600 mt-3">{unavailableReason}</p>}
      {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
      {children}
    </section>
  );
}
