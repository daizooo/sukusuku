// かぞく手帳: 契約の更新日のお知らせ（その他タブ。docs/contracts.md §6）
//
// pg_cron から毎朝（日本時間9時）叩かれ、更新日の N 日前（契約の notify_days）に当たった契約を
// **1台につき1通にまとめて**、その契約が見える人の端末へ FCM で送る（_shared/deliver.ts）。
//
// 何を知らせるかの決まりごとは _shared/contractReminders.ts（試せるよう外に出してある）。
// 「更新日の N 日前の日が、前回送った日の翌日から今日までに来た」契約が対象。
// 日付で決めるので、契約の行を直しても同じお知らせは繰り返さないし、
// 実行が飛んだ日があっても次の朝にまとめて拾える。
//
// 宛先は、その契約が見える人の端末だけ（contracts の RLS と同じ条件。canSee）。
// この関数は service_role で動いて RLS が効かないので、ここで絞る。
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
  todayJst,
  type ContractRow,
  type Viewer,
} from '../_shared/contractReminders.ts';

// 実行が飛んだときに何日前までさかのぼって拾うか。これより古い節目は
// 知らせない（何日も遅れて「30日前です」と届いても紛らわしいため）。
const CATCH_UP_DAYS = 3;

interface SubscriptionRow extends DeliveryTarget {
  family_id: string;
  user_id: string;
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
    .select('id, kind, family_id, user_id, endpoint')
    .eq('kind', 'fcm')
    .returns<SubscriptionRow[]>();
  if (subscriptionError) return json({ error: subscriptionError.message }, 500);
  if (!subscriptions || subscriptions.length === 0) {
    return json({ families: 0, sent: 0, failed: 0, skipped: 0 });
  }

  // 更新日がこれから来る契約だけ（過ぎたものは一覧のバッジが知らせる）
  const { data: contracts, error: contractsError } = await supabase
    .from('contracts')
    .select('id, family_id, created_by, kind, title, renews_on, notify_days, visible_member_ids')
    .not('renews_on', 'is', null)
    .gte('renews_on', today)
    .returns<ContractRow[]>();
  if (contractsError) return json({ error: contractsError.message }, 500);
  if (!contracts || contracts.length === 0) {
    return json({ families: 0, sent: 0, failed: 0, skipped: 0 });
  }

  const contractsByFamily = new Map<string, ContractRow[]>();
  for (const contract of contracts) {
    const list = contractsByFamily.get(contract.family_id) ?? [];
    list.push(contract);
    contractsByFamily.set(contract.family_id, list);
  }

  // 端末の持ち主の family_members.id。見せる相手の判定に使う（アカウントの無いメンバーは端末も無い）
  const { data: members, error: membersError } = await supabase
    .from('family_members')
    .select('id, user_id')
    .not('user_id', 'is', null)
    .returns<{ id: string; user_id: string }[]>();
  if (membersError) return json({ error: membersError.message }, 500);
  const memberIdByUser = new Map<string, string>();
  for (const member of members ?? []) memberIdByUser.set(member.user_id, member.id);

  // 端末ごとに「どの日まで送り終えたか」。これより後の節目だけを拾う。
  const { data: sentRows, error: sentError } = await supabase
    .from('contract_deliveries')
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
      const viewer: Viewer = {
        userId: subscription.user_id,
        familyId: subscription.family_id,
        memberId: memberIdByUser.get(subscription.user_id) ?? null,
      };
      const since = lastSentBySubscription.get(subscription.id) ?? earliest;
      const notices = collectNotices(
        contractsByFamily.get(subscription.family_id) ?? [],
        viewer,
        since < earliest ? earliest : since,
        today,
      );
      return { subscription, notices };
    })
    .filter((plan) => plan.notices.length > 0);
  if (plans.length === 0) return json({ families: 0, sent: 0, failed: 0, skipped: 0 });

  const notReady = await delivery.ensureReady(plans.map((plan) => plan.subscription));
  if (notReady) return json({ error: notReady }, 500);

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const { subscription, notices } of plans) {
    // 先に記録を作って送信権を取る。(subscription_id, notify_on) の一意制約により、
    // 実行が重なっても送るのは片方だけになる。
    const { data: claim, error: claimError } = await supabase
      .from('contract_deliveries')
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

    const message = buildMessage(notices);
    const result = await delivery.deliver(
      subscription,
      { kind: 'contract', title: message.title, body: message.body, url: '/' },
      // 朝のお知らせなので、翌日に届いても意味が薄い
      12 * 60 * 60,
    );

    if (result.ok) {
      sent++;
      await supabase
        .from('contract_deliveries')
        .update({ status: 'sent', sent_at: new Date().toISOString() })
        .eq('id', claim!.id);
      await supabase
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', subscription.id);
      continue;
    }

    failed++;
    console.error('契約の更新日のお知らせの送信に失敗しました', subscription.kind, subscription.endpoint, result.error);
    await supabase
      .from('contract_deliveries')
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
