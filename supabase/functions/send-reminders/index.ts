// すくすく手帳: リマインダーの配信
//
// pg_cron から数分おきに叩かれ、通知時刻を過ぎたリマインダーを
// 家族の端末(push_subscriptions)へ送る。ブラウザへは Web Push、
// ネイティブ版(Android)へは FCM で送る（振り分けは _shared/deliver.ts）。
//
// 通知時刻の計算は task_reminder_schedule ビューが行う（出生日基準の予定の
// 日付解決と Asia/Tokyo でのタイムゾーン補正を含む）。
//
// 認証: pg_cron から呼ぶため JWT は使わず、共有シークレットのヘッダーで認可する。
//       supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import { DeliveryContext, preferNative, type DeliveryTarget } from '../_shared/deliver.ts';

// 取りこぼしを拾うため、通知時刻を過ぎたものも一定時間ぶんは対象にする。
// 送信済み記録(reminder_deliveries)があるものは除外されるので二重には飛ばない。
const LOOKBACK_MINUTES = 120;
// 次の実行までの間に来る通知を少しだけ先取りして送る
const LOOKAHEAD_MINUTES = 1;

interface ScheduleRow {
  task_id: string;
  family_id: string;
  title: string;
  category: string;
  place: string | null;
  start_time: string | null;
  remind_minutes_before: number;
  target_date: string;
  starts_at: string;
  remind_at: string;
}

interface SubscriptionRow extends DeliveryTarget {
  family_id: string;
  user_id: string;
}

// 通知本文。「8月20日(水) 10:00 ・ 城南まちづくりセンター」のように出す。
const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

function formatWhen(row: ScheduleRow): string {
  const [year, month, day] = row.target_date.split('-').map(Number);
  // 曜日はカレンダー上の日付から求める（UTC基準で作れば時差の影響を受けない）
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const date = `${month}月${day}日(${weekday})`;
  const time = row.start_time ? row.start_time.slice(0, 5) : '終日';
  const parts = [`${date} ${time}`];
  if (row.place) parts.push(row.place);
  return parts.join(' ・ ');
}

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
  if (!cronSecret) {
    return json({ error: 'REMINDER_CRON_SECRET が未設定です' }, 500);
  }
  if (request.headers.get('x-reminder-secret') !== cronSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  // 鍵は送る宛先の種類が分かってから用意する（_shared/deliver.ts）。
  const delivery = new DeliveryContext();

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
    .from('task_reminder_schedule')
    .select('*')
    .gte('remind_at', from)
    .lte('remind_at', to)
    .returns<ScheduleRow[]>();
  if (dueError) return json({ error: dueError.message }, 500);
  if (!due || due.length === 0) return json({ due: 0, sent: 0, failed: 0, skipped: 0 });

  const familyIds = [...new Set(due.map((row) => row.family_id))];
  const { data: allSubscriptions, error: subscriptionError } = await supabase
    .from('push_subscriptions')
    .select('id, kind, family_id, user_id, endpoint, p256dh, auth')
    .in('family_id', familyIds)
    .returns<SubscriptionRow[]>();
  if (subscriptionError) return json({ error: subscriptionError.message }, 500);
  // 同じ人がネイティブ版とPWA版の両方を登録していたら、ネイティブ版だけに送る。
  // 移行の途中は1人が宛先を複数持つので、絞らないと同じお知らせが何通も出る。
  const subscriptions = preferNative(allSubscriptions ?? []);

  // 送り始める前に、宛先の種類に必要な鍵がそろっているかを確かめる。
  // ここで止めないと、鍵が無いまま失敗の記録だけが残り、設定を直しても
  // その通知は二度と送られない（_shared/deliver.ts の ensureReady）。
  const notReady = await delivery.ensureReady(subscriptions);
  if (notReady) return json({ error: notReady }, 500);

  const subscriptionsByFamily = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptions) {
    const list = subscriptionsByFamily.get(subscription.family_id) ?? [];
    list.push(subscription);
    subscriptionsByFamily.set(subscription.family_id, list);
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of due) {
    // 予定は家族で共有しているものなので、ラベル(パパ/ママ/家族)に関わらず
    // その家族の全端末へ送る。
    for (const subscription of subscriptionsByFamily.get(row.family_id) ?? []) {
      // 先に記録を作って送信権を取る。(task_id, subscription_id, scheduled_for) の
      // 一意制約により、実行が重なっても送るのは片方だけになる。
      const { data: claim, error: claimError } = await supabase
        .from('reminder_deliveries')
        .insert({
          task_id: row.task_id,
          subscription_id: subscription.id,
          scheduled_for: row.remind_at,
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

      const result = await delivery.deliver(subscription, {
        taskId: row.task_id,
        title: row.title,
        body: formatWhen(row),
        url: '/',
      });

      if (result.ok) {
        sent++;
        await supabase
          .from('reminder_deliveries')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', claim!.id);
        await supabase
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', subscription.id);
        continue;
      }

      failed++;
      console.error('プッシュ送信に失敗しました', subscription.kind, subscription.endpoint, result.error);
      await supabase
        .from('reminder_deliveries')
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
