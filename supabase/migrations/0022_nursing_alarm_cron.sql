-- すくすく手帳: 授乳の経過時間お知らせの定期実行
--
-- Edge Function `send-nursing-alarms` を pg_cron から1分おきに叩く。
-- 予定のリマインダー(0013)が5分おきなのに対してこちらが1分おきなのは、
-- 授乳のお知らせが「5分ごと」という短い間隔で意味を持つため。
--
-- ============================================================
-- 適用条件
-- ============================================================
-- 1. Edge Function `send-nursing-alarms` がデプロイ済みであること
-- 2. Vault に共有シークレット reminder_cron_secret が登録済みであること
--    (予定のリマインダーと同じものを使うので、0013を適用済みなら追加の作業はない)
-- 手順の詳細は docs/notifications.md を参照。

-- 拡張は0013で入れているが、この migration 単独でも通るようにしておく
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('send-nursing-alarms')
 where exists (select 1 from cron.job where jobname = 'send-nursing-alarms');

select cron.schedule(
  'send-nursing-alarms',
  '* * * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/send-nursing-alarms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    -- 対象は「いま授乳中の端末」だけなので、ほとんどの実行は何も送らずに終わる。
    -- 1分おきに呼ばれる分コールドスタートは起きにくいが、余裕をもたせておく。
    timeout_milliseconds := 30000
  );
  $cron$
);
