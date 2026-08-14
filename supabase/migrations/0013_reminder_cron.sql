-- すくすく手帳: リマインダー配信の定期実行
--
-- Edge Function `send-reminders` を pg_cron から5分おきに叩く。
--
-- ============================================================
-- 適用条件
-- ============================================================
-- 1. Edge Function `send-reminders` がデプロイ済みであること
-- 2. Vault に共有シークレット reminder_cron_secret が登録済みであること
--      select vault.create_secret('<ランダムな文字列>', 'reminder_cron_secret');
--    同じ値を Edge Function の REMINDER_CRON_SECRET にも設定する。
-- 手順の詳細は docs/notifications.md を参照。

-- pg_net は public を汚さないよう extensions スキーマに入れる
-- (関数自体は net.http_post として生える)
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ============================================================
-- 1. 5分おきの配信
-- ============================================================
-- Edge Function 側は通知時刻を過ぎたぶんも2時間さかのぼって拾うため、
-- 数回ぶん実行が飛んでも通知は失われない（送信済み記録で二重送信は防いでいる）。
select cron.unschedule('send-reminders')
 where exists (select 1 from cron.job where jobname = 'send-reminders');

select cron.schedule(
  'send-reminders',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $cron$
);

-- ============================================================
-- 2. 送信記録の掃除
-- ============================================================
-- 送信済み記録は二重送信を防ぐためだけに使うので、通知時刻を十分過ぎたものは消す。
select cron.unschedule('purge-reminder-deliveries')
 where exists (select 1 from cron.job where jobname = 'purge-reminder-deliveries');

select cron.schedule(
  'purge-reminder-deliveries',
  '30 4 * * 0',
  $cron$
  delete from public.reminder_deliveries where sent_at < now() - interval '90 days';
  $cron$
);
