// すくすく手帳: 授乳の経過時間お知らせ（端末が鳴らせなかった分の肩代わり）
//
// 授乳は「左5分 → 右5分 → ゲップ5分」で1セット。どの区切りを計測中かは side に入る。
//
// pg_cron から1分おきに叩かれ、計測中の端末(nursing_alarms)のうち
// 次の区切りに達したものへ Web Push を送る。
//
// なぜサーバーから送るのか:
//   ブラウザは画面が消える・裏に回るとタイマーを間引くため、端末内の
//   setInterval だけではお知らせが遅れる/鳴らない。iOS Safari は振動もできない。
//   計測そのものは端末内で完結させたまま、「鳴らす」ところだけを肩代わりする。
//
// 端末が自分で鳴らせたときは、端末側が notified_step を進める。
// ここでは区切りを少し過ぎてから送るので、画面を開いている間は送られない。
//
// stopped_at が入っている行は「計測は終わったが、まだ記録していない」印なので鳴らさない。
// (残しているのは、その間の「そろそろ次の授乳」を止めるため。0027 を参照)
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

// 区切りを過ぎてすぐには送らない。画面を開いている端末は自分で鳴らし、
// その直後に notified_step を書き戻してくるので、それを待つための猶予。
// 逆に言うと、端末が寝ている場合のお知らせはこの秒数ぶん遅れて届く。
const FOREGROUND_GRACE_SECONDS = 20;

// 計測を止めずにアプリを閉じたままだと、行が残って鳴り続けてしまう。
// 1回の授乳がこれを超えることはまずないので、過ぎたものは片付ける。
// (授乳が終わっているのに鳴り続けるのを、ここで打ち切る)
const MAX_ELAPSED_MINUTES = 90;

// 計測を止めてから記録が保存されるまでの「記録待ち」を、いつまで授乳中として扱うか。
// この間は「そろそろ次の授乳」(send-feeding-reminders)を止めるので、長く残しすぎると
// 記録し忘れたときに何も知らせが来なくなる。飲ませ終えて1時間たっても記録が
// 入らないなら、記録漏れとして通知を戻したほうがよい。
const MAX_PENDING_MINUTES = 60;

interface AlarmRow {
  subscription_id: string;
  /** 計測中の区切り。左右のほか、ゲップの時間(burp)もここに入る。 */
  side: 'left' | 'right' | 'burp';
  baseline_at: string;
  interval_minutes: number;
  notified_step: number;
  /** 計測を止めた時刻。記録を保存するまでの間だけ入る（計測中は null）。 */
  stopped_at: string | null;
  push_subscriptions: {
    endpoint: string;
    p256dh: string;
    auth: string;
  } | null;
}

const PHASE_LABEL: Record<AlarmRow['side'], string> = { left: '左', right: '右', burp: 'ゲップ' };

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

  // service_role で動くため RLS は適用されない（全員の計測中の端末を集める必要がある）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // 対象は「いま授乳中の端末」だけなので、ほとんどの実行はここで終わる。
  // VAPIDの鍵の用意は送る分があると分かってからにする。
  const { data: alarms, error: alarmsError } = await supabase
    .from('nursing_alarms')
    .select(
      'subscription_id, side, baseline_at, interval_minutes, notified_step, stopped_at, push_subscriptions(endpoint, p256dh, auth)',
    )
    .returns<AlarmRow[]>();
  if (alarmsError) return json({ error: alarmsError.message }, 500);
  if (!alarms || alarms.length === 0) return json({ active: 0, sent: 0, failed: 0, skipped: 0 });

  const now = Date.now();
  let vapid: Awaited<ReturnType<typeof createVapidContext>> | null = null;
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let expired = 0;

  for (const alarm of alarms) {
    const expire = async () => {
      expired++;
      await supabase.from('nursing_alarms').delete().eq('subscription_id', alarm.subscription_id);
    };

    // 計測は止まっていて、記録を保存するのを待っているだけの行。
    // もう飲ませていないので鳴らさない。「そろそろ次の授乳」(send-feeding-reminders)は
    // この行があることで止まる（授乳は済んでいるため）。
    if (alarm.stopped_at) {
      const pendingMinutes = (now - Date.parse(alarm.stopped_at)) / 60_000;
      if (!Number.isFinite(pendingMinutes) || pendingMinutes > MAX_PENDING_MINUTES) {
        // 記録されないまま置き去りになった分。授乳中の扱いをここで終える。
        await expire();
      } else {
        skipped++;
      }
      continue;
    }

    const baselineAt = Date.parse(alarm.baseline_at);
    const elapsedMinutes = (now - baselineAt) / 60_000;

    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes > MAX_ELAPSED_MINUTES) {
      await expire();
      continue;
    }

    const step = Math.floor(elapsedMinutes / alarm.interval_minutes);
    if (step < 1 || step <= alarm.notified_step) {
      skipped++;
      continue;
    }

    // 区切りちょうどではなく、少し過ぎてから送る（端末が自分で鳴らす猶予）
    const boundaryAt = baselineAt + step * alarm.interval_minutes * 60_000;
    if (now - boundaryAt < FOREGROUND_GRACE_SECONDS * 1000) {
      skipped++;
      continue;
    }

    const subscription = alarm.push_subscriptions;
    if (!subscription) {
      skipped++;
      continue;
    }

    // 送信権を取る。notified_step を先に進めることで、実行が重なっても
    // 送るのは片方だけになる（更新できた側だけが送る）。
    const { data: claimed, error: claimError } = await supabase
      .from('nursing_alarms')
      .update({ notified_step: step, updated_at: new Date().toISOString() })
      .eq('subscription_id', alarm.subscription_id)
      .lt('notified_step', step)
      .select('subscription_id')
      .maybeSingle();
    if (claimError) {
      console.error('お知らせの送信権の取得に失敗しました', claimError);
      skipped++;
      continue;
    }
    if (!claimed) {
      // 端末が自分で鳴らして書き戻したか、別の実行が先に取った
      skipped++;
      continue;
    }

    if (!vapid) {
      vapid = await createVapidContext(JSON.parse(vapidKeysRaw) as VapidKeys, vapidSubject);
    }

    const minutes = step * alarm.interval_minutes;
    const result = await sendPushNotification(
      vapid,
      subscription,
      JSON.stringify({
        kind: 'nursing',
        // 鳴らし方(長音=30分・短音=5分)を組み立てるのに使う
        minutes,
        step,
        side: alarm.side,
        // ゲップは飲ませている時間ではないので、見出しでも授乳と分けて出す
        title: alarm.side === 'burp' ? `ゲップ ${minutes}分` : `授乳 ${minutes}分`,
        body: `${PHASE_LABEL[alarm.side]}を計測中`,
        url: '/',
      }),
      // 経過時間のお知らせは鮮度がすべて。届かなかった分を後から出しても意味がない。
      2 * 60,
      // 配送を後回しにされると「何分経ったか」がずれるため、優先度を上げる
      'high',
    );

    if (result.ok) {
      sent++;
      await supabase
        .from('push_subscriptions')
        .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
        .eq('id', alarm.subscription_id);
      continue;
    }

    failed++;
    console.error('授乳のお知らせの送信に失敗しました', subscription.endpoint, result.error);

    if (result.gone) {
      // 購読が失効している。nursing_alarms の行も cascade で一緒に消える。
      await supabase.from('push_subscriptions').delete().eq('id', alarm.subscription_id);
    } else {
      await supabase.rpc('increment_push_failure', { p_subscription_id: alarm.subscription_id });
    }
  }

  return json({ active: alarms.length, sent, failed, skipped, expired });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
