import { useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { getPushTokenIfAllowed } from '@/lib/push';
import { findPushSubscriptionId } from '@/lib/api/pushSubscriptions';
import { deleteNursingState, upsertNursingState } from '@/lib/api/nursingAlarms';
import { setNursingStateSink, type NursingStateTarget } from '@/lib/nursingTimer';

// 「いま授乳中（または飲ませ終えて記録待ち）」であることをサーバーへ預ける橋渡し。
//
// PWA版の src/lib/nursingAlarmSync.ts と同じ形だが、目的は1つだけ
// ——「そろそろ次の授乳」(send-feeding-reminders)を止めること。
// お知らせそのものは前面サービスが鳴らすので、肩代わりは頼まない
// （詳しくは src/lib/api/nursingAlarms.ts）。
//
// 通知をオンにしていない端末には宛先が無いので、預け先も無い。そのときは何もしない
// （オンにするよう促したりはしない。PWA版と同じ）。

/** 同じ計測とみなす単位。ここが変わったら預け直す。 */
const sessionKey = (target: NursingStateTarget): string =>
  `${target.side}|${target.baselineAt}|${target.intervalMinutes}|${target.stoppedAt ?? ''}`;

export function useNursingStateSync(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    let disposed = false;
    let subscriptionId: string | null = null;
    let registeredKey: string | null = null;
    // 登録と削除が入れ替わらないよう、順番に処理する
    let queue: Promise<void> = Promise.resolve();

    const run = (task: () => Promise<void>) => {
      queue = queue.then(task).catch(() => {
        // 預けられなくても授乳の計測とお知らせは端末内で動くので、致命的ではない
        // （圏外で授乳を始めたときは、ふつうにここへ来る）。
        //
        // 覚えている宛先のIDは捨てて、次の機会に引き直す。通知をオフ→オンし直すと
        // 登録トークンが変わって別の行になるので、覚えたままだと預け先を失ったことに
        // 気づけない（アプリを開き直すまで「そろそろ次の授乳」が止まらなくなる）。
        subscriptionId = null;
        registeredKey = null;
      });
    };

    const sync = (target: NursingStateTarget | null) => {
      run(async () => {
        if (disposed) return;

        if (!target) {
          if (registeredKey === null) return;
          registeredKey = null;
          if (subscriptionId) await deleteNursingState(supabase, subscriptionId);
          return;
        }

        if (!subscriptionId) {
          const token = await getPushTokenIfAllowed();
          subscriptionId = token ? await findPushSubscriptionId(supabase, token) : null;
        }
        if (!subscriptionId || disposed) return;

        const key = sessionKey(target);
        if (key === registeredKey) return;
        await upsertNursingState(supabase, subscriptionId, userId, target);
        registeredKey = key;
      });
    };

    setNursingStateSink(sync);

    return () => {
      // 計測中にアプリを閉じた場合、サーバー側の印はそのまま残す。
      // 閉じている間も「そろそろ次の授乳」を止めるのがこの仕組みの目的なので、消してはいけない。
      // (記録されないまま置き去りになった分は send-nursing-alarms が片付ける)
      disposed = true;
      setNursingStateSink(null);
    };
  }, [userId]);
}
