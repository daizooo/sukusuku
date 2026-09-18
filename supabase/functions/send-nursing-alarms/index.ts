// すくすく手帳: 「いま授乳中」の印(nursing_alarms)の片付け
//
// pg_cron から1分おきに叩かれ、置き去りになった行を消す。
//
// **かつてはここから授乳の経過時間お知らせを Web Push で送っていた。**
// ブラウザは画面が消えるとタイマーを間引くため、端末内の setInterval だけでは
// お知らせが遅れる/鳴らない——それを肩代わりする役目だった。ネイティブ版(Android)は
// 授乳中だけ前面サービスが動いて自分で鳴らすので肩代わりが要らず
// （docs/native-app-rewrite.md §4）、家族全員がそちらへ移ったので撤去した
// （フェーズ4の条件D。docs/notifications.md §11）。
//
// そのため nursing_alarms の2つの役目のうち、いま残っているのは2つ目だけ。
//
//   1. （撤去）端末が鳴らせなかった分の肩代わり
//   2. 「いま授乳中（または飲ませ終えて記録待ち）だから『そろそろ次の授乳』を送らない」
//      という印。send-feeding-reminders がこれを見て止まる（0027 を参照）
//
// 2つ目は**行が残っていること自体が印**なので、置き去りを片付けないと
// 「そろそろ次の授乳」が永久に止まってしまう。この関数はそのための番人になる。
//
// 名前が send- のままなのは、pg_cron の登録(nursing_alarm_cron)と既にデプロイ済みの
// 関数名がこの名前を指しているため。付け替えるなら両方を同時に直す必要がある。
//
// 認証: pg_cron から呼ぶため JWT は使わず、共有シークレットのヘッダーで認可する。
//       予定のリマインダーと同じ REMINDER_CRON_SECRET を使う。
//       supabase/config.toml で verify_jwt = false にしている。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2';

// 計測を止めずにアプリを閉じたままだと、行が残って「そろそろ次の授乳」が
// 止まり続けてしまう。1回の授乳がこれを超えることはまずないので、過ぎたものは片付ける。
const MAX_ELAPSED_MINUTES = 90;

// 計測を止めてから記録が保存されるまでの「記録待ち」を、いつまで授乳中として扱うか。
// この間は「そろそろ次の授乳」(send-feeding-reminders)を止めるので、長く残しすぎると
// 記録し忘れたときに何も知らせが来なくなる。飲ませ終えて1時間たっても記録が
// 入らないなら、記録漏れとして通知を戻したほうがよい。
const MAX_PENDING_MINUTES = 60;

interface AlarmRow {
  subscription_id: string;
  /** その区切りの合計時間が0だった時刻。計測中かどうかの起点。 */
  baseline_at: string;
  /** 計測を止めた時刻。記録を保存するまでの間だけ入る（計測中は null）。 */
  stopped_at: string | null;
}

Deno.serve(async (request) => {
  const cronSecret = Deno.env.get('REMINDER_CRON_SECRET');
  if (!cronSecret) {
    return json({ error: 'REMINDER_CRON_SECRET が未設定です' }, 500);
  }
  if (request.headers.get('x-reminder-secret') !== cronSecret) {
    return json({ error: 'unauthorized' }, 401);
  }

  // service_role で動くため RLS は適用されない（全員の計測中の端末を集める必要がある）
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  // 対象は「いま授乳中・記録待ちの端末」だけなので、ほとんどの実行はここで終わる。
  const { data: alarms, error: alarmsError } = await supabase
    .from('nursing_alarms')
    .select('subscription_id, baseline_at, stopped_at')
    .returns<AlarmRow[]>();
  if (alarmsError) return json({ error: alarmsError.message }, 500);
  if (!alarms || alarms.length === 0) return json({ active: 0, kept: 0, expired: 0 });

  const now = Date.now();
  let kept = 0;
  let expired = 0;

  for (const alarm of alarms) {
    // 計測は止まっていて、記録を保存するのを待っているだけの行。
    const stoppedAt = alarm.stopped_at ? Date.parse(alarm.stopped_at) : null;
    const limitMinutes = stoppedAt === null ? MAX_ELAPSED_MINUTES : MAX_PENDING_MINUTES;
    const since = stoppedAt ?? Date.parse(alarm.baseline_at);
    const elapsedMinutes = (now - since) / 60_000;

    // 時刻が読めない行も置き去りとして片付ける（残しても印として働かない）。
    if (!Number.isFinite(elapsedMinutes) || elapsedMinutes > limitMinutes) {
      expired++;
      await supabase.from('nursing_alarms').delete().eq('subscription_id', alarm.subscription_id);
      continue;
    }

    kept++;
  }

  return json({ active: alarms.length, kept, expired });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
