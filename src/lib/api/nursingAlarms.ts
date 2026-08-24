import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { BreastSide } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

// 授乳の経過時間お知らせを、端末が鳴らせなかったときにサーバーから鳴らすための予約。
// 計測そのものは端末内(localStorage)で完結しており、ここで預けるのは
// 「いつ・何分ごとに鳴らすか」だけ。
//
// 端末ごとに1行（キーは push_subscriptions.id）。通知をオフにしている端末は
// 購読が無いので、そもそも預けられない＝これまでどおり端末内でだけ鳴る。

export interface NursingAlarmRegistration {
  side: BreastSide;
  /** 計測中の側の合計時間が0だった時刻(epoch ms)。経過分数 = now - baselineAt。 */
  baselineAt: number;
  intervalMinutes: number;
  /** 何回目のお知らせまで済んでいるか。 */
  notifiedStep: number;
}

/** この端末の購読ID。通知をオンにしていなければ null。 */
export async function findPushSubscriptionId(
  supabase: SupabaseDb,
  endpoint: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

export async function upsertNursingAlarm(
  supabase: SupabaseDb,
  subscriptionId: string,
  userId: string,
  registration: NursingAlarmRegistration,
): Promise<void> {
  const { error } = await supabase.from('nursing_alarms').upsert(
    {
      subscription_id: subscriptionId,
      user_id: userId,
      side: registration.side,
      baseline_at: new Date(registration.baselineAt).toISOString(),
      interval_minutes: registration.intervalMinutes,
      notified_step: registration.notifiedStep,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'subscription_id' },
  );
  if (error) throw error;
}

/**
 * 端末が自分で鳴らせた分をサーバーへ知らせる。
 * サーバーは区切りを少し過ぎてから送るので、これが間に合えば二重に鳴らない。
 */
export async function updateNursingAlarmStep(
  supabase: SupabaseDb,
  subscriptionId: string,
  step: number,
): Promise<void> {
  const { error } = await supabase
    .from('nursing_alarms')
    .update({ notified_step: step, updated_at: new Date().toISOString() })
    // 先に進んでいる値を巻き戻さない
    .lt('notified_step', step)
    .eq('subscription_id', subscriptionId);
  if (error) throw error;
}

export async function deleteNursingAlarm(
  supabase: SupabaseDb,
  subscriptionId: string,
): Promise<void> {
  const { error } = await supabase
    .from('nursing_alarms')
    .delete()
    .eq('subscription_id', subscriptionId);
  if (error) throw error;
}
