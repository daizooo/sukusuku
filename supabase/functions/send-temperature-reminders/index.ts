// すくすく手帳: 検温のお知らせ
//
// pg_cron から5分おきに叩かれ、設定した朝・夕の時刻になった家族の端末へ
// 「体温を測って記録しましょう」を Web Push で送る。
//
// お知らせの時刻は temperature_reminder_schedule ビューが出す
// （temperature_reminder_settings の morning_time / evening_time を日本時間で解決したもの）。
// その時刻の1時間前以降に体温の記録がある家族は、ビューの時点で外れている
// （少し早めに測った直後に「測りましょう」と届くのを避けるため）。
//
// 認証: pg_cron から呼ぶため JWT は使わず、共有シークレットのヘッダーで認可する。
//       予定のリマインダーと同じ REMINDER_CRON_SECRET を使う。
//       supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import {
  createVapidContext,
  sendPushNotification,
  type VapidKeys,
} from '../_shared/webpush.ts';

// 取りこぼしを拾うため、時刻を過ぎたものも一定時間ぶんは対象にする。
// 送信済み記録(temperature_reminder_deliveries)があるものは除外されるので二重には飛ばない。
// 逆にこれを過ぎたら送らない（朝の検温のお知らせが昼に届いても意味がない）。
const LOOKBACK_MINUTES = 120;
// 次の実行までの間に来る通知を少しだけ先取りして送る
const LOOKAHEAD_MINUTES = 1;

type Slot = 'morning' | 'evening';

interface ScheduleRow {
  family_id: string;
  slot: Slot;
  scheduled_for: string;
}

interface SubscriptionRow {
  id: string;
  family_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

// 家族全員が日本にいる前提。時刻は日本時間で出す。
const JST_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
  if (!cronSecret) {
    return json({ error: 'REMINDER_CRON_SECRET が未設定です' }, 500);
  }
  if (request.headers.get('x-reminder-secret') !== cronSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  const vapidKeysRaw = Deno.env.get('VAPID_KEYS');
  const vapidSubject = Deno.env.get('VAPID_SUBJECT');
  if (!vapidKeysRaw || !vapidSubject) {
    return json({ error: 'VAPID_KEYS / VAPID_SUBJECT が未設定です' }, 500);
  }

  // service_role で動くため RLS は適用されない（家族をまたいで配信対象を集める必要がある）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  const now = Date.now();
  const from = new Date(now - LOOKBACK_MINUTES * 60_000).toISOString();
  const to = new Date(now + LOOKAHEAD_MINUTES * 60_000).toISOString();

  const { data: due, error: dueError } = await supabase
    .from('temperature_reminder_schedule')
    .select('*')
    .gte('scheduled_for', from)
    .lte('scheduled_for', to)
    .returns<ScheduleRow[]>();
  if (dueError) return json({ error: dueError.message }, 500);
  if (!due || due.length === 0) return json({ due: 0, sent: 0, failed: 0, skipped: 0 });

  const familyIds = [...new Set(due.map((row) => row.family_id))];
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('push_subscriptions')
    .select('id, family_id, endpoint, p256dh, auth')
    .in('family_id', familyIds)
    .returns<SubscriptionRow[]>();
  if (subscriptionError) return json({ error: subscriptionError.message }, 500);

  const subscriptionsByFamily = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptions ?? []) {
    const list = subscriptionsByFamily.get(subscription.family_id) ?? [];
    list.push(subscription);
    subscriptionsByFamily.set(subscription.family_id, list);
  }

  const vapid = await createVapidContext(JSON.parse(vapidKeysRaw) as VapidKeys, vapidSubject);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due) {
    // 測るのは手の空いているほうなので、家族の全端末へ送る
    // （予定のリマインダー・授乳の目安と同じ考え方）。
    for (const subscription of subscriptionsByFamily.get(row.family_id) ?? []) {
      // 先に記録を作って送信権を取る。(family_id, subscription_id, scheduled_for) の
      // 一意制約により、実行が重なっても送るのは片方だけになる。
      const { data: claim, error: claimError } = await supabase
        .from('temperature_reminder_deliveries')
        .insert({
          family_id: row.family_id,
          subscription_id: subscription.id,
          scheduled_for: row.scheduled_for,
          status: 'pending',
        })
        .select('id')
        .maybeSingle();

      if (claimError) {
        // 一意制約違反 = 送信済み(または送信中)。それ以外はログに残す。
        if (claimError.code !== '23505') {
          console.error('送信記録の作成に失敗しました', claimError);
        }
        skipped++;
        continue;
      }

      const result = await sendPushNotification(
        vapid,
        subscription,
        JSON.stringify({
          kind: 'temperature',
          title: row.slot === 'morning' ? '朝の検温' : '夕方の検温',
          body: `${JST_TIME.format(new Date(row.scheduled_for))} です。体温を測って記録しましょう`,
          url: '/',
        }),
        // 決まった時刻のお知らせなので、何時間も後に届いても意味がない
        30 * 60,
      );

      if (result.ok) {
        sent++;
        await supabase
          .from('temperature_reminder_deliveries')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', claim!.id);
        await supabase
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', subscription.id);
        continue;
      }

      failed++;
      console.error('検温のお知らせの送信に失敗しました', subscription.endpoint, result.error);
      await supabase
        .from('temperature_reminder_deliveries')
        .update({ status: 'failed', error: result.error })
        .eq('id', claim!.id);

      if (result.gone) {
        // 購読が失効している（通知を切った・アプリを消した等）。
        // 記録は外部キーの cascade で一緒に消える。
        await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      } else {
        await supabase.rpc('increment_push_failure', { p_subscription_id: subscription.id });
      }
    }
  }

  return json({ due: due.length, sent, failed, skipped });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
