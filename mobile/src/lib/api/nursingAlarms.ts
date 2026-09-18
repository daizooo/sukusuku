import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { NursingPhase } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

// 「いま授乳中（または飲ませ終えて記録待ち）」であることをサーバーへ預ける。
//
// PWA版（../../../src/lib/api/nursingAlarms.ts）と同じ表・同じ列を使うが、**目的が1つだけ違う**。
//
//   PWA版 … 端末が鳴らせなかったお知らせを send-nursing-alarms が肩代わりするための予約
//   ネイティブ版 … 鳴らすのは前面サービスなので肩代わりは要らない。預けるのは
//                  「そろそろ次の授乳」(send-feeding-reminders)を止めるためだけ
//
// 止める必要があるのは、記録が授乳のあとで保存されるため。飲ませている最中や
// 「飲ませ終えたが記録はまだ」の間は、前回の授乳が1つ前のままに見えるので、
// 何もしないと家族全員へ「そろそろ次の授乳」が飛ぶ（0027 で直した形）。
// PWA版だけがこれを預けている状態では、ネイティブ版で授乳したときに同じことが起きる。
//
// 送られてこないよう notified_step は1で入れる。send-nursing-alarms 側も
// kind = 'fcm' の行は鳴らさないようにしてあり、そちらが本筋の歯止めになる。
//
// 通知をオンにしていない端末には宛先が無いので、そもそも預けられない
// （＝PWA版と同じで、そのときは止まらない）。

/** お知らせは前面サービスが済ませているので、サーバーからは送らせない。 */
const NOTIFIED_STEP = 1;

export interface NursingStateRegistration {
  /** 計測中の区切り。左右のほか、ゲップの時間もここに入る。 */
  side: NursingPhase;
  /** 計測中の区切りの合計時間が0だった時刻(epoch ms)。 */
  baselineAt: number;
  intervalMinutes: number;
  /**
   * 計測を止めた時刻(epoch ms)。まだ記録していない間だけ入る（計測中は null）。
   * この間も「授乳中」として「そろそろ次の授乳」を止める。
   */
  stoppedAt: number | null;
}

export async function upsertNursingState(
  supabase: SupabaseDb,
  subscriptionId: string,
  userId: string,
  registration: NursingStateRegistration,
): Promise<void> {
  const { error } = await supabase.from('nursing_alarms').upsert(
    {
      subscription_id: subscriptionId,
      user_id: userId,
      side: registration.side,
      baseline_at: new Date(registration.baselineAt).toISOString(),
      interval_minutes: registration.intervalMinutes,
      notified_step: NOTIFIED_STEP,
      stopped_at: registration.stoppedAt ? new Date(registration.stoppedAt).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subscription_id' },
  );
  if (error) throw error;
}

export async function deleteNursingState(
  supabase: SupabaseDb,
  subscriptionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('nursing_alarms')
    .delete()
    .eq('subscription_id', subscriptionId);
  if (error) throw error;
}
