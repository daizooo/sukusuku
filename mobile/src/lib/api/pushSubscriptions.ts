import { Platform } from 'react-native';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { PUSH_KIND, toPushEndpoint } from '@/lib/push';

type SupabaseDb = SupabaseClient<Database>;

// 端末の宛先を保存する。PWA版（../../../src/lib/api/pushSubscriptions.ts）と同じ表を使い、
// 種類だけが違う（kind = 'fcm'、endpoint は 'fcm:' + 登録トークン。0037を参照）。
//
// endpoint は端末ごとに一意なので、同じ端末から2度オンにしても行は増えない。
// アプリを入れ直すとトークンが変わり、その場合は新しい行になる（古い行は送信に
// 失敗した時点でEdge Functionが片付ける）。

/** Web Pushの暗号化に使う鍵は持たないので、表示用の端末名だけを添える。 */
const deviceLabel = (): string =>
  `Android ${typeof Platform.Version === 'number' ? Platform.Version : ''}`.trim().slice(0, 300);

export async function savePushSubscription(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  token: string,
): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      family_id: familyId,
      user_id: userId,
      kind: PUSH_KIND,
      endpoint: toPushEndpoint(token),
      user_agent: deviceLabel(),
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
}

export async function deletePushSubscription(supabase: SupabaseDb, token: string): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('endpoint', toPushEndpoint(token));
  if (error) throw error;
}

/**
 * この端末の宛先がDBに残っているか。
 * 送信が失敗し続けた宛先はEdge Functionが削除するため、端末に許可があってもDBに無いことがある。
 * （PWA版と同じで、両方そろっているときだけ「オン」とみなす）
 */
export async function hasPushSubscription(
  supabase: SupabaseDb,
  token: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', toPushEndpoint(token))
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

/** この端末の宛先のID。オンにしていなければ null。 */
export async function findPushSubscriptionId(
  supabase: SupabaseDb,
  token: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', toPushEndpoint(token))
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? null;
}

/**
 * この端末で「次の授乳」の通知を止めるおやすみ時間を、宛先の行に写す（サーバーが見て送らない）。
 * null を渡すと止めない。時刻は日本時間の0:00からの分（supabase/migrations/0052）。
 * 宛先がまだ無い（通知をオンにしていない）ときは何も更新されない。
 */
export async function saveFeedingQuietHours(
  supabase: SupabaseDb,
  token: string,
  quiet: { startMinutes: number; endMinutes: number } | null,
): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({
      feeding_quiet_start: quiet?.startMinutes ?? null,
      feeding_quiet_end: quiet?.endMinutes ?? null,
    })
    .eq('endpoint', toPushEndpoint(token));
  if (error) throw error;
}

/**
 * 起床アラームの設定（オンか・おやすみ時間）を、この端末の宛先の行に写す。
 * サーバー（send-feeding-reminders）が、PWAなど別の端末での記録にも追従して
 * この端末の予約を入れ替えるのに使う（supabase/migrations/0053）。
 * 宛先がまだ無い（通知をオンにしていない）ときは何も更新されない。
 */
export async function saveWakeAlarmSubscription(
  supabase: SupabaseDb,
  token: string,
  settings: { enabled: boolean; quiet: { startMinutes: number; endMinutes: number } },
): Promise<void> {
  const { error } = await supabase
    .from('push_subscriptions')
    .update({
      wake_alarm_enabled: settings.enabled,
      wake_quiet_start: settings.quiet.startMinutes,
      wake_quiet_end: settings.quiet.endMinutes,
    })
    .eq('endpoint', toPushEndpoint(token));
  if (error) throw error;
}
