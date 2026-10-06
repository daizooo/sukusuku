// かぞく手帳: 備蓄の期限のお知らせ（暮らしタブ。docs/home.md §3.3）
//
// pg_cron から毎朝（日本時間9時）叩かれ、期限の3か月前・1か月前に当たった備蓄を
// **1通にまとめて**、家族の全端末へ FCM で送る（_shared/deliver.ts）。1件ずつは送らない。
//
// 何を知らせるかの決まりごとは _shared/stockExpiry.ts（試せるよう外に出してある）。
// 「期限の3か月前の日・1か月前の日が、前回送った日の翌日から今日までに来た」備蓄が対象。
// 日付で決めるので、備蓄の行を直したり持ち出しへ移したりしても同じお知らせは繰り返さないし、
// 実行が飛んだ日があっても次の朝にまとめて拾える。
//
// 認証: pg_cron から呼ぶため JWT は使わず、共有シークレットのヘッダーで認可する。
//       予定のリマインダーと同じ REMINDER_CRON_SECRET を使う。
//       supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';
import { DeliveryContext, type DeliveryTarget } from '../_shared/deliver.ts';
import {
  addDays,
  buildMessage,
  collectNotices,
  hasNotice,
  todayJst,
  type StockLot,
} from '../_shared/stockExpiry.ts';

// 実行が飛んだときに何日前までさかのぼって拾うか。これより古い期限の節目は
// 知らせない（何日も遅れて「3か月前です」と届いても紛らわしいため）。
const CATCH_UP_DAYS = 3;

interface SubscriptionRow extends DeliveryTarget {
  family_id: string;
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

  const today = todayJst(Date.now());

  // 送り先はネイティブ版だけ（ブラウザ向けの Web Push は撤去した。docs/notifications.md）。
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('push_subscriptions')
    .select('id, kind, family_id, endpoint')
    .eq('kind', 'fcm')
    .returns<SubscriptionRow[]>();
  if (subscriptionError) return json({ error: subscriptionError.message }, 500);
  if (!subscriptions || subscriptions.length === 0) {
    return json({ families: 0, sent: 0, failed: 0, skipped: 0 });
  }

  const { data: lots, error: lotsError } = await supabase
    .from('stock_items')
    .select('family_id, name, quantity, expires_on, expires_month_only')
    .not('expires_on', 'is', null)
    .gte('expires_on', today)
    .returns<(StockLot & { family_id: string })[]>();
  if (lotsError) return json({ error: lotsError.message }, 500);

  const lotsByFamily = new Map<string, StockLot[]>();
  for (const lot of lots ?? []) {
    const list = lotsByFamily.get(lot.family_id) ?? [];
    list.push(lot);
    lotsByFamily.set(lot.family_id, list);
  }

  // 端末ごとに「どの日まで送り終えたか」。これより後の節目だけを拾う。
  const { data: sentRows, error: sentError } = await supabase
    .from('stock_expiry_deliveries')
    .select('subscription_id, notify_on')
    .eq('status', 'sent')
    .gte('notify_on', addDays(today, -CATCH_UP_DAYS - 1))
    .returns<{ subscription_id: string; notify_on: string }[]>();
  if (sentError) return json({ error: sentError.message }, 500);
  const lastSentBySubscription = new Map<string, string>();
  for (const row of sentRows ?? []) {
    const last = lastSentBySubscription.get(row.subscription_id);
    if (!last || row.notify_on > last) lastSentBySubscription.set(row.subscription_id, row.notify_on);
  }

  // 送る分があると分かってから鍵を用意する。送り始める前にそろっているかを確かめる
  // （無いまま失敗の記録だけ残ると、設定を直しても送られない。deliver.ts の ensureReady）。
  const delivery = new DeliveryContext();
  const earliest = addDays(today, -CATCH_UP_DAYS);
  const plans = subscriptions
    .map((subscription) => {
      const since = lastSentBySubscription.get(subscription.id) ?? earliest;
      const notice = collectNotices(
        lotsByFamily.get(subscription.family_id) ?? [],
        since < earliest ? earliest : since,
        today,
      );
      return { subscription, notice };
    })
    .filter((plan) => hasNotice(plan.notice));
  if (plans.length === 0) return json({ families: 0, sent: 0, failed: 0, skipped: 0 });

  const notReady = await delivery.ensureReady(plans.map((plan) => plan.subscription));
  if (notReady) return json({ error: notReady }, 500);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const { subscription, notice } of plans) {
    // 先に記録を作って送信権を取る。(subscription_id, notify_on) の一意制約により、
    // 実行が重なっても送るのは片方だけになる。
    const { data: claim, error: claimError } = await supabase
      .from('stock_expiry_deliveries')
      .insert({
        family_id: subscription.family_id,
        subscription_id: subscription.id,
        notify_on: today,
        status: 'pending',
      })
      .select('id')
      .maybeSingle();

    if (claimError) {
      // 一意制約違反 = 今日はもう送った(または送信中)。それ以外はログに残す。
      if (claimError.code !== '23505') {
        console.error('送信記録の作成に失敗しました', claimError);
      }
      skipped++;
      continue;
    }

    const message = buildMessage(notice);
    const result = await delivery.deliver(
      subscription,
      { kind: 'stock', title: message.title, body: message.body, url: '/' },
      // 朝のお知らせなので、翌日に届いても意味が薄い
      12 * 60 * 60,
    );

    if (result.ok) {
      sent++;
      await supabase
        .from('stock_expiry_deliveries')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', claim!.id);
      await supabase
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', subscription.id);
      continue;
    }

    failed++;
    console.error('備蓄の期限のお知らせの送信に失敗しました', subscription.kind, subscription.endpoint, result.error);
    await supabase
      .from('stock_expiry_deliveries')
      .update({ status: 'failed', error: result.error })
      .eq('id', claim!.id);

    if (result.gone) {
      // 購読が失効している（通知を切った・アプリを消した等）。記録は cascade で一緒に消える。
      await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
    } else {
      await supabase.rpc('increment_push_failure', { p_subscription_id: subscription.id });
    }
  }

  return json({ families: new Set(plans.map((p) => p.subscription.family_id)).size, sent, failed, skipped });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
