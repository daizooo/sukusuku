import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { NursingPhase } from '@/types/app';

type SupabaseDb = SupabaseClient<Database>;

// 授乳の経過時間お知らせを、端末が鳴らせなかったときにサーバーから鳴らすための予約。
// 計測そのものは端末内(localStorage)で完結しており、ここで預けるのは
// 「いつ・何分ごとに鳴らすか」だけ。
//
// 端末ごとに1行（キーは push_subscriptions.id）。通知をオフにしている端末は
// 購読が無いので、そもそも預けられない＝これまでどおり端末内でだけ鳴る。
//
// 計測を止めたあとも、記録を保存するまでは stopped_at を立てた行を残す。
// 授乳は済んでいるのに記録がまだ入っていない間に「そろそろ次の授乳」が
// 飛んでしまうのを防ぐため（この間はお知らせ自体は鳴らさない）。

export interface NursingAlarmRegistration {
  /** 計測中の区切り。左右のほか、ゲップの時間もここに入る。 */
  side: NursingPhase;
  /** 計測中の区切りの合計時間が0だった時刻(epoch ms)。経過分数 = now - baselineAt。 */
  baselineAt: number;
  intervalMinutes: number;
  /** 何回目のお知らせまで済んでいるか。 */
  notifiedStep: number;
  /**
   * 計測を止めた時刻(epoch ms)。まだ記録していない間だけ入る（計測中は null）。
   * この間はお知らせを鳴らさず、「授乳中(＝そろそろ次の授乳は送らない)」の印として残す。
   */
  stoppedAt: number | null;
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
      stopped_at: registration.stoppedAt ? new Date(registration.stoppedAt).toISOString() : null,
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

/**
 * いま家族の誰かが預けている「授乳中・記録待ち」の印。
 *
 * 授乳の記録(care_logs)が入るのは入力画面で保存したあとなので、母乳を測り終えて
 * から保存するまでの間、前回の授乳は1つ前のままに見える。その隙間を画面にも
 * 出すために読む（ホームの「次の授乳の目安」・記録タブの「次はどちらから」）。
 *
 * 行を持つのは授乳中・記録待ちの端末だけなので、ふだんは空で返る。
 * 置き去りになった行は send-nursing-alarms が片付けるが、片付くまでの間も
 * 古い印を信じないよう、読んだ側でも古さを見て落とす（feedingSchedule.ts）。
 * 家族の行が読めるのは 0043_nursing_alarms_family_select.sql のポリシーによる。
 */
export interface FamilyNursingState {
  /** 測っている（測り終えた）人。 */
  userId: string;
  /**
   * 計測中なら、いま測っている区切り（ゲップも入る）。
   * 記録待ちなら、最後に飲ませた側（左右のみ）。「次はどちらから」に使える。
   */
  side: NursingPhase;
  /** その区切りの合計時間が0だった時刻。飲ませ始めた時刻の目安として扱う。 */
  startedAt: Date;
  /** 計測を止めた時刻。記録待ちの間だけ入る（計測中は null）。 */
  stoppedAt: Date | null;
}

export async function listFamilyNursingState(supabase: SupabaseDb): Promise<FamilyNursingState[]> {
  const { data, error } = await supabase
    .from('nursing_alarms')
    .select('user_id, side, baseline_at, stopped_at');
  if (error) throw error;
  return (data ?? []).map((row) => ({
    userId: row.user_id,
    side: row.side as NursingPhase,
    startedAt: new Date(row.baseline_at),
    stoppedAt: row.stopped_at ? new Date(row.stopped_at) : null,
  }));
}
