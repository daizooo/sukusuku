import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import type { PushSubscriptionKeys } from '@/lib/push';

type SupabaseDb = SupabaseClient<Database>;

// 端末の購読情報を保存する。
// endpoint は端末ごとに一意なので、同じ端末から2度オンにしても行は増えない。
// 通知をオフ→オンし直すと endpoint が変わることがあり、その場合は新しい行になる。
export async function savePushSubscription(
  supabase: SupabaseDb,
  familyId: string,
  userId: string,
  keys: PushSubscriptionKeys,
): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      family_id: familyId,
      user_id: userId,
      endpoint: keys.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      user_agent: typeof navigator === 'undefined' ? '' : navigator.userAgent.slice(0, 300),
      failure_count: 0,
    },
    { onConflict: 'endpoint' },
  );
  if (error) throw error;
}

export async function deletePushSubscription(supabase: SupabaseDb, endpoint: string): Promise<void> {
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  if (error) throw error;
}

// この端末の購読がDBに残っているか。
// 送信が失敗し続けた購読はEdge Functionが削除するため、
// ブラウザ側に購読があってもDBに無いことがある。
export async function hasPushSubscription(
  supabase: SupabaseDb,
  endpoint: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('id')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}
