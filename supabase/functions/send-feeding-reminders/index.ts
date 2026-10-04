// すくすく手帳: 次の授乳の目安の通知
//
// pg_cron から1分おきに叩かれ、前回の授乳から設定した間隔が経った家族の端末へ
// 「そろそろ次の授乳」を FCM で送る（_shared/deliver.ts）。
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
import { DeliveryContext, type DeliveryTarget } from '../_shared/deliver.ts';
import { isWithinQuietHours } from '../_shared/quietHours.ts';
import { decideWakeSync, planWake } from '../_shared/wakePlan.ts';

// 取りこぼしを拾うため、目安の時刻を過ぎたものも一定時間ぶんは対象にする。
// 送信済み記録(feeding_reminder_deliveries)があるものは除外されるので二重には飛ばない。
// 逆にこれを過ぎたら送らない（何時間も後に「そろそろ授乳」が来ても困る）。
const LOOKBACK_MINUTES = 120;
// **先取りはしない。** かつては次の実行までに来るぶんを1分だけ先取りしていたが、
// 通知の時刻が5の倍数の分でないと予定より早く届いてしまっていた
// （20:26の予定が20:25に届いた）。書いてある時刻と合わない通知は、
// 少し遅れて届く通知より困る。いまは pg_cron が1分おきに叩くので(0038)、
// 先取りしなくてもその分のうちに届く。

interface ScheduleRow {
  family_id: string;
  care_log_id: string;
  last_fed_at: string;
  interval_minutes: number;
  due_at: string;
}

interface SubscriptionRow extends DeliveryTarget {
  family_id: string;
  // この端末で「次の授乳」を止めるおやすみ時間（日本時間0:00からの分）。null = 止めない。
  feeding_quiet_start: number | null;
  feeding_quiet_end: number | null;
}

interface ActiveNursingRow {
  push_subscriptions: { family_id: string } | null;
}

interface WakeSubscriptionRow extends DeliveryTarget {
  family_id: string;
  wake_alarm_enabled: boolean;
  wake_quiet_start: number | null;
  wake_quiet_end: number | null;
  wake_synced_trigger_at: string | null;
}

interface WakeScheduleRow {
  family_id: string;
  due_at: string;
}

// 端末へ伝えた予約が、途中で落ちても残らないよう、データ通知は短い期限で送る。
// 取りこぼしても、次の実行（1分後）が同じ内容をもう一度伝える。
const WAKE_SYNC_TTL_SECONDS = 60 * 60;

/**
 * 夜間の起床アラームの予約を、端末へ伝え直す（docs/night-wake-alarm.md §4）。
 *
 * 端末は自分で記録したときしか予約を組み直せない。PWAやパートナーの端末での記録にも
 * 追従させるため、サーバーが毎分、端末ごとに「いま予約しているべき時刻」を求め
 * （_shared/wakePlan.ts。アプリ側と同じ規則）、前回伝えた内容と違うときだけ、
 * 画面に出ないデータ通知で伝える。受け取った端末はネイティブ側が目覚ましを入れ替える。
 *
 * 失敗してもお知らせの配信（このあとの処理）は止めない。伝えた内容は、送れたときだけ
 * 控えるので、失敗したぶんは次の実行でもう一度試される。
 */
async function syncWakeAlarms(
  supabase: ReturnType<typeof createClient>,
  now: number,
): Promise<{ scheduled: number; cancelled: number; failed: number }> {
  const result = { scheduled: 0, cancelled: 0, failed: 0 };

  // 使っている端末と、使うのをやめたが先の予約を伝えたままの端末（外すよう伝える）。
  const { data: subscriptions, error } = await supabase
    .from('push_subscriptions')
    .select(
      'id, kind, family_id, endpoint, wake_alarm_enabled, wake_quiet_start, wake_quiet_end, wake_synced_trigger_at',
    )
    .eq('kind', 'fcm')
    .or('wake_alarm_enabled.eq.true,wake_synced_trigger_at.not.is.null')
    .returns<WakeSubscriptionRow[]>();
  if (error) throw error;
  if (!subscriptions || subscriptions.length === 0) return result;

  const familyIds = [...new Set(subscriptions.map((row) => row.family_id))];
  const [schedules, nursing] = await Promise.all([
    supabase
      .from('next_feeding_schedule')
      .select('family_id, due_at')
      .in('family_id', familyIds)
      .returns<WakeScheduleRow[]>(),
    supabase.from('nursing_alarms').select('push_subscriptions(family_id)').returns<ActiveNursingRow[]>(),
  ]);
  if (schedules.error) throw schedules.error;
  if (nursing.error) throw nursing.error;

  const dueByFamily = new Map<string, number>();
  for (const row of schedules.data ?? []) dueByFamily.set(row.family_id, new Date(row.due_at).getTime());
  const nursingFamilies = new Set(
    (nursing.data ?? []).map((row) => row.push_subscriptions?.family_id).filter(Boolean) as string[],
  );

  // 伝える必要のあるものだけ集める。
  const toSend: { subscription: WakeSubscriptionRow; plan: ReturnType<typeof planWake> }[] = [];
  const toClear: string[] = [];
  for (const subscription of subscriptions) {
    const plan = planWake({
      enabled: subscription.wake_alarm_enabled,
      dueAt: dueByFamily.get(subscription.family_id) ?? null,
      nursing: nursingFamilies.has(subscription.family_id),
      quietStart: subscription.wake_quiet_start,
      quietEnd: subscription.wake_quiet_end,
      now,
    });
    const synced = subscription.wake_synced_trigger_at
      ? new Date(subscription.wake_synced_trigger_at).getTime()
      : null;
    const action = decideWakeSync(plan, synced, now);
    if (action === 'schedule' || action === 'cancel') toSend.push({ subscription, plan });
    if (action === 'clear') toClear.push(subscription.id);
  }

  // 鳴らす時刻を過ぎたぶんは、端末へは送らず控えだけ消す（端末が入れた再鳴動を取り消さないため）。
  if (toClear.length > 0) {
    await supabase
      .from('push_subscriptions')
      .update({ wake_synced_trigger_at: null, wake_synced_due_at: null })
      .in('id', toClear);
  }
  if (toSend.length === 0) return result;

  const delivery = new DeliveryContext();
  const notReady = await delivery.ensureReady(toSend.map((item) => item.subscription));
  if (notReady) throw new Error(notReady);

  for (const { subscription, plan } of toSend) {
    const sent = await delivery.deliverData(
      subscription,
      plan
        ? {
            kind: 'wake-sync',
            op: 'schedule',
            triggerAt: String(plan.triggerAt),
            dueAt: String(plan.dueAt),
          }
        : { kind: 'wake-sync', op: 'cancel' },
      WAKE_SYNC_TTL_SECONDS,
    );

    if (sent.ok) {
      if (plan) result.scheduled++;
      else result.cancelled++;
      await supabase
        .from('push_subscriptions')
        .update({
          wake_synced_trigger_at: plan ? new Date(plan.triggerAt).toISOString() : null,
          wake_synced_due_at: plan ? new Date(plan.dueAt).toISOString() : null,
        })
        .eq('id', subscription.id);
      continue;
    }

    result.failed++;
    console.error('起床アラームの予約を伝えられませんでした', subscription.endpoint, sent.error);
    if (sent.gone) {
      await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
    }
  }
  return result;
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

  // 起床アラームの予約の伝え直し。ここで失敗しても、下のお知らせの配信は続ける。
  const wake = await syncWakeAlarms(supabase, now).catch((error: unknown) => {
    console.error('起床アラームの同期に失敗しました', error);
    return null;
  });
  const respond = (body: Record<string, unknown>) => json({ ...body, wake });

  const from = new Date(now - LOOKBACK_MINUTES * 60_000).toISOString();
  const to = new Date(now).toISOString();

  const { data: due, error: dueError } = await supabase
    .from('next_feeding_schedule')
    .select('*')
    .gte('due_at', from)
    .lte('due_at', to)
    .returns<ScheduleRow[]>();
  if (dueError) return json({ error: dueError.message }, 500);
  if (!due || due.length === 0) return respond({ due: 0, sent: 0, failed: 0, skipped: 0 });

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
    return respond({ due: due.length, sent: 0, failed: 0, skipped: due.length });
  }

  const familyIds = [...new Set(targets.map((row) => row.family_id))];
  // 送り先はネイティブ版だけ。ブラウザ向けの Web Push は撤去した（フェーズ4の条件D）。
  // PWA版を開いて通知をオンにすると kind = 'webpush' の行がまた作られるが、
  // ここで絞っているので送ろうとして失敗することはない（届かないだけ）。
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('push_subscriptions')
    .select('id, kind, family_id, endpoint, feeding_quiet_start, feeding_quiet_end')
    .eq('kind', 'fcm')
    .in('family_id', familyIds)
    .returns<SubscriptionRow[]>();
  if (subscriptionError) return json({ error: subscriptionError.message }, 500);

  const subscriptionsByFamily = new Map<string, SubscriptionRow[]>();
  for (const subscription of subscriptions ?? []) {
    const list = subscriptionsByFamily.get(subscription.family_id) ?? [];
    list.push(subscription);
    subscriptionsByFamily.set(subscription.family_id, list);
  }

  // 鍵は送る宛先の種類が分かってから用意する（_shared/deliver.ts）。
  // 送り始める前にそろっているかを確かめる。ここで止めないと、鍵が無いまま
  // 失敗の記録だけが残り、設定を直してもその通知は二度と送られない。
  const delivery = new DeliveryContext();
  const notReady = await delivery.ensureReady(subscriptions ?? []);
  if (notReady) return json({ error: notReady }, 500);

  let sent = 0;
  let failed = 0;
  let skipped = due.length - targets.length;

  for (const row of targets) {
    // 「次はいつだっけ」は夫婦のどちらにも起きるので、家族の全端末へ送る。
    for (const subscription of subscriptionsByFamily.get(row.family_id) ?? []) {
      // 端末ごとのおやすみ時間に目安の時刻が入っていれば、その端末には送らない
      // （夜に授乳しない側の端末を起こさないため。docs/night-wake-alarm.md §6）。
      // 記録は残さない：目安の時刻は変わらないので、次の実行でも同じ判断になるだけで
      // 二重に送る心配がなく、止めた端末のぶんの行を増やす意味もない。
      if (
        isWithinQuietHours(
          new Date(row.due_at).getTime(),
          subscription.feeding_quiet_start,
          subscription.feeding_quiet_end,
        )
      ) {
        skipped++;
        continue;
      }

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

  return respond({ due: due.length, sent, failed, skipped });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
