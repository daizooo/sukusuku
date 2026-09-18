// すくすく手帳: 次の授乳の目安の通知
//
// pg_cron から5分おきに叩かれ、前回の授乳から設定した間隔が経った家族の端末へ
// 「そろそろ次の授乳」を送る。ブラウザへは Web Push、ネイティブ版(Android)へは
// FCM で送る（振り分けは _shared/deliver.ts）。
//
// 目安の時刻は next_feeding_schedule ビューが出す
// （家族ごとのいちばん新しい授乳の記録 + feeding_settings.interval_minutes）。
//
// 授乳中の経過時間お知らせ(send-nursing-alarms)とは別物。あちらは
// 「いま飲ませている最中」の経過時間を鳴らすもので、こちらは「次はいつか」を知らせる。
//
// 認証: pg_cron から呼ぶため JWT は使わず、共有シークレットのヘッダーで認可する。
//       予定のリマインダーと同じ REMINDER_CRON_SECRET を使う。
//       supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import { DeliveryContext, preferNative, type DeliveryTarget } from '../_shared/deliver.ts';

// 取りこぼしを拾うため、目安の時刻を過ぎたものも一定時間ぶんは対象にする。
// 送信済み記録(feeding_reminder_deliveries)があるものは除外されるので二重には飛ばない。
// 逆にこれを過ぎたら送らない（何時間も後に「そろそろ授乳」が来ても困る）。
const LOOKBACK_MINUTES = 120;
// 次の実行までの間に来る通知を少しだけ先取りして送る
const LOOKAHEAD_MINUTES = 1;

interface ScheduleRow {
  family_id: string;
  care_log_id: string;
  last_fed_at: string;
  interval_minutes: number;
  due_at: string;
}

interface SubscriptionRow extends DeliveryTarget {
  family_id: string;
  user_id: string;
}

interface ActiveNursingRow {
  push_subscriptions: { family_id: string } | null;
}

// 家族全員が日本にいる前提。時刻は日本時間で出す。
const JST_TIME = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 180 -> 「3時間」 / 150 -> 「2時間30分」 */
function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
  if (!cronSecret) {
    return json({ error: 'REMINDER_CRON_SECRET が未設定です' }, 500);
  }
  if (request.headers.get('x-reminder-secret') !== cronSecret) {
    return json({ error: 'unauthorized' }, 401);
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
    .from('next_feeding_schedule')
    .select('*')
    .gte('due_at', from)
    .lte('due_at', to)
    .returns<ScheduleRow[]>();
  if (dueError) return json({ error: dueError.message }, 500);
  if (!due || due.length === 0) return json({ due: 0, sent: 0, failed: 0, skipped: 0 });

  // いま授乳中の家族には送らない。記録は授乳が終わってから保存されるので、
  // 飲ませている最中に「そろそろ次の授乳」が届いてしまうため。
  // 母乳のストップウォッチを止めてから記録を保存するまでの間も、行は
  // stopped_at を立てたまま残る（0027）。飲ませ終わったばかりなのに
  // 家族全員へ通知が飛んでいたのは、この隙間が抜けていたため。
  // (授乳中・記録待ちの端末だけが nursing_alarms に行を持つ。ほとんどの実行では空になる)
  const { data: nursing, error: nursingError } = await supabase
    .from('nursing_alarms')
    .select('push_subscriptions(family_id)')
    .returns<ActiveNursingRow[]>();
  if (nursingError) return json({ error: nursingError.message }, 500);
  const nursingFamilyIds = new Set(
    (nursing ?? []).map((row) => row.push_subscriptions?.family_id).filter(Boolean) as string[],
  );

  const targets = due.filter((row) => !nursingFamilyIds.has(row.family_id));
  if (targets.length === 0) {
    return json({ due: due.length, sent: 0, failed: 0, skipped: due.length });
  }

  const familyIds = [...new Set(targets.map((row) => row.family_id))];
  const { data: allSubscriptions, error: subscriptionError } = await supabase
    .from('push_subscriptions')
    .select('id, kind, family_id, user_id, endpoint, p256dh, auth')
    .in('family_id', familyIds)
    .returns<SubscriptionRow[]>();
  if (subscriptionError) return json({ error: subscriptionError.message }, 500);
  // 同じ人がネイティブ版とPWA版の両方を登録していたら、ネイティブ版だけに送る。
  // 移行の途中は1人が宛先を複数持つので、絞らないと同じお知らせが何通も出る。
  const subscriptions = preferNative(allSubscriptions ?? []);

  const subscriptionsByFamily = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptions) {
    const list = subscriptionsByFamily.get(subscription.family_id) ?? [];
    list.push(subscription);
    subscriptionsByFamily.set(subscription.family_id, list);
  }

  // 鍵は送る宛先の種類が分かってから用意する（_shared/deliver.ts）。
  // 送り始める前にそろっているかを確かめる。ここで止めないと、鍵が無いまま
  // 失敗の記録だけが残り、設定を直してもその通知は二度と送られない。
  const delivery = new DeliveryContext();
  const notReady = await delivery.ensureReady(subscriptions);
  if (notReady) return json({ error: notReady }, 500);

  let sent = 0;
  let failed = 0;
  let skipped = due.length - targets.length;

  for (const row of targets) {
    // 「次はいつだっけ」は夫婦のどちらにも起きるので、家族の全端末へ送る。
    for (const subscription of subscriptionsByFamily.get(row.family_id) ?? []) {
      // 先に記録を作って送信権を取る。(care_log_id, subscription_id, scheduled_for) の
      // 一意制約により、実行が重なっても送るのは片方だけになる。
      const { data: claim, error: claimError } = await supabase
        .from('feeding_reminder_deliveries')
        .insert({
          care_log_id: row.care_log_id,
          subscription_id: subscription.id,
          scheduled_for: row.due_at,
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

      const result = await delivery.deliver(
        subscription,
        {
          kind: 'feeding',
          title: 'そろそろ次の授乳',
          body: `前回 ${JST_TIME.format(new Date(row.last_fed_at))} から${formatMinutes(row.interval_minutes)}たちました`,
          url: '/',
        },
        // 目安の時刻を知らせるものなので、何時間も後に届いても意味がない
        30 * 60,
      );

      if (result.ok) {
        sent++;
        await supabase
          .from('feeding_reminder_deliveries')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', claim!.id);
        await supabase
          .from('push_subscriptions')
          .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
          .eq('id', subscription.id);
        continue;
      }

      failed++;
      console.error('授乳の目安の送信に失敗しました', subscription.kind, subscription.endpoint, result.error);
      await supabase
        .from('feeding_reminder_deliveries')
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
