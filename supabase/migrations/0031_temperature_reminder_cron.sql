-- すくすく手帳: 検温のお知らせの定期実行
--
-- Edge Function `send-temperature-reminders` を pg_cron から5分おきに叩く。
-- 決まった時刻のお知らせなので、授乳の経過時間お知らせ(0022)のような
-- 1分おきの細かさは要らない。代わりに設定した時刻から最大5分ほど遅れて届く。
--
-- ============================================================
-- 適用条件
-- ============================================================
-- 1. Edge Function `send-temperature-reminders` がデプロイ済みであること
-- 2. Vault に共有シークレット reminder_cron_secret が登録済みであること
--    (予定のリマインダーと同じものを使うので、0013を適用済みなら追加の作業はない)
-- 手順の詳細は docs/notifications.md を参照。

-- 拡張は0013で入れているが、この migration 単独でも通るようにしておく
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('send-temperature-reminders')
 where exists (select 1 from cron.job where jobname = 'send-temperature-reminders');

select cron.schedule(
  'send-temperature-reminders',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/send-temperature-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

-- ============================================================
-- 送信記録の掃除
-- ============================================================
-- 送信済み記録は二重送信を防ぐためだけに使うので、お知らせの時刻を十分過ぎたものは消す。
-- 予定のリマインダーの掃除(0013)・授乳の目安の掃除(0025)と同じ考え方・同じ保存期間。
select cron.unschedule('purge-temperature-reminder-deliveries')
 where exists (select 1 from cron.job where jobname = 'purge-temperature-reminder-deliveries');

select cron.schedule(
  'purge-temperature-reminder-deliveries',
  '50 4 * * 0',
  $cron$
  delete from public.temperature_reminder_deliveries where sent_at < now() - interval '90 days';
  $cron$
);
