'use client';

// 授乳の経過時間お知らせを、サーバー側(nursing_alarms)へ預ける橋渡し。
//
// 端末内の見張り(nursingTimer.ts)はブラウザが画面を消すと間引かれるため、
// 「いつ・何分ごとに鳴らすか」をサーバーにも預けておき、端末が鳴らせなかった分を
// Edge Function `send-nursing-alarms` が Web Push で鳴らす。
//
// 通知をオンにしていない端末には購読が無いので、預け先が無い＝これまでどおり
// 端末内でだけ鳴る（オンにするよう促したりはしない）。

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getExistingSubscription } from '@/lib/push';
import {
  deleteNursingAlarm,
  findPushSubscriptionId,
  updateNursingAlarmStep,
  upsertNursingAlarm,
} from '@/lib/api/nursingAlarms';
import {
  markNursingAlarmNotified,
  setNursingAlarmSink,
  type NursingAlarmTarget,
} from '@/lib/nursingTimer';

/** 同じ計測とみなす単位。ここが変わったら預け直す。 */
const sessionKey = (target: NursingAlarmTarget): string =>
  `${target.side}|${target.baselineAt}|${target.intervalMinutes}`;

export function useNursingAlarmSync(userId: string): void {
  useEffect(() => {
    const supabase = createClient();
    let disposed = false;
    let subscriptionId: string | null = null;
    let registeredKey: string | null = null;
    let registeredStep = 0;
    // 登録と削除が入れ替わらないよう、順番に処理する
    let queue: Promise<void> = Promise.resolve();

    const run = (task: () => Promise<void>) => {
      queue = queue.then(task).catch((err) => {
        // 預けられなくても端末内のお知らせは動くので、致命的ではない
        console.error('Failed to sync nursing alarm:', err);
      });
    };

    const sync = (target: NursingAlarmTarget | null) => {
      run(async () => {
        if (disposed) return;

        if (!target) {
          if (registeredKey === null) return;
          registeredKey = null;
          registeredStep = 0;
          if (subscriptionId) await deleteNursingAlarm(supabase, subscriptionId);
          return;
        }

        if (!subscriptionId) {
          const subscription = await getExistingSubscription();
          subscriptionId = subscription
            ? await findPushSubscriptionId(supabase, subscription.endpoint)
            : null;
        }
        if (!subscriptionId || disposed) return;

        const key = sessionKey(target);
        if (key !== registeredKey) {
          await upsertNursingAlarm(supabase, subscriptionId, userId, target);
          registeredKey = key;
          registeredStep = target.notifiedStep;
          return;
        }

        // 端末が自分で鳴らせた分を知らせる。これが間に合えばサーバーからは送られない。
        if (target.notifiedStep > registeredStep) {
          await updateNursingAlarmStep(supabase, subscriptionId, target.notifiedStep);
          registeredStep = target.notifiedStep;
        }
      });
    };

    setNursingAlarmSink(sync);

    // Service Worker が代わりに鳴らした分を端末側の数えに反映する
    const handleMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; step?: number; side?: string } | null;
      if (data?.type !== 'nursing-alarm-notified' || typeof data.step !== 'number') return;
      if (data.side !== 'left' && data.side !== 'right') return;
      markNursingAlarmNotified(data.side, data.step);
    };
    navigator.serviceWorker?.addEventListener('message', handleMessage);

    return () => {
      // 計測中にアプリを閉じた場合、サーバー側の予約はそのまま残す。
      // 閉じている間に鳴らしてもらうのがこの仕組みの目的なので、消してはいけない。
      disposed = true;
      setNursingAlarmSink(null);
      navigator.serviceWorker?.removeEventListener('message', handleMessage);
    };
  }, [userId]);
}
