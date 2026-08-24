-- すくすく手帳: 次の授乳の目安の通知の定期実行
--
-- Edge Function `send-feeding-reminders` を pg_cron から5分おきに叩く。
-- 授乳の間隔は数時間単位なので、経過時間のお知らせ(0022)のような
-- 1分おきの細かさは要らない。代わりに目安の時刻から最大5分ほど遅れて届く。
--
-- ============================================================
-- 適用条件
-- ============================================================
-- 1. Edge Function `send-feeding-reminders` がデプロイ済みであること
-- 2. Vault に共有シークレット reminder_cron_secret が登録済みであること
--    (予定のリマインダーと同じものを使うので、0013を適用済みなら追加の作業はない)
-- 手順の詳細は docs/notifications.md を参照。

-- 拡張は0013で入れているが、この migration 単独でも通るようにしておく
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('send-feeding-reminders')
 where exists (select 1 from cron.job where jobname = 'send-feeding-reminders');

select cron.schedule(
  'send-feeding-reminders',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/send-feeding-reminders',
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
