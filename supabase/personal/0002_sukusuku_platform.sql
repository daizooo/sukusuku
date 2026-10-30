-- 統合プロジェクト Persol で、すくすくが sukusuku スキーマの外に必要とするもの。
-- 0001_sukusuku_schema.sql の後に流す。名前はすべて sukusuku_ / sukusuku- で始め、
-- 他のアプリ（denken3 / fittrack / public）の物と衝突させない。
--
-- 前提（ダッシュボードで行う）:
--   - Edge Functions を Persol にデプロイ済み（cron が呼ぶ URL がこのプロジェクトを指すため）
--   - Vault にこの名前で秘密を登録済み（値は Edge Function の REMINDER_CRON_SECRET と同じ）:
--       select vault.create_secret('<ランダムな文字列>', 'sukusuku_reminder_cron_secret');

-- 1. 拡張（Persol では未有効。Supabase の推奨どおり pg_net は extensions に置く）
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- 2. サインアップ時に sukusuku.users を作る（旧 0005）。
--    auth.users は Persol の全アプリで共有のため、他のアプリの登録でも sukusuku.users に1行できる
--    （行ができるだけで、家族に入らない限り何も見えない）。
create or replace trigger sukusuku_on_auth_user_created
  after insert on auth.users
  for each row execute function sukusuku.handle_new_auth_user();

-- 3. Realtime: 家族の変更台帳だけを配信する（docs/sync.md。旧 0078）
alter publication supabase_realtime add table sukusuku.family_sync;

-- 4. 定期実行（スケジュールは旧本番の実際の値）
select cron.schedule('sukusuku-send-reminders', '* * * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 60000);
$cron$);

select cron.schedule('sukusuku-send-nursing-alarms', '* * * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/send-nursing-alarms',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);

select cron.schedule('sukusuku-send-feeding-reminders', '* * * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/send-feeding-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);

select cron.schedule('sukusuku-send-temperature-reminders', '* * * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/send-temperature-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);

select cron.schedule('sukusuku-send-stock-expiry-reminders', '0 0 * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/send-stock-expiry-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);

select cron.schedule('sukusuku-send-contract-reminders', '0 0 * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/send-contract-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 30000);
$cron$);

select cron.schedule('sukusuku-fetch-security-prices', '5 22 * * *', $cron$
  select net.http_post(
    url := 'https://jmysgeulujggdmdthqkn.supabase.co/functions/v1/fetch-security-prices',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'sukusuku_reminder_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
$cron$);

select cron.schedule('sukusuku-make-money-recurring-records', '0 20 * * *',
  $cron$ select sukusuku.make_money_recurring_records(); $cron$);

-- 送信済みの記録を90日で消す（行の削除を含むため、SQL Editor で流す）
select cron.schedule('sukusuku-purge-reminder-deliveries', '30 4 * * 0',
  $cron$ delete from sukusuku.reminder_deliveries where sent_at < now() - interval '90 days'; $cron$);
select cron.schedule('sukusuku-purge-feeding-reminder-deliveries', '40 4 * * 0',
  $cron$ delete from sukusuku.feeding_reminder_deliveries where sent_at < now() - interval '90 days'; $cron$);
select cron.schedule('sukusuku-purge-temperature-reminder-deliveries', '50 4 * * 0',
  $cron$ delete from sukusuku.temperature_reminder_deliveries where sent_at < now() - interval '90 days'; $cron$);
select cron.schedule('sukusuku-purge-stock-expiry-deliveries', '55 4 * * 0',
  $cron$ delete from sukusuku.stock_expiry_deliveries where sent_at < now() - interval '90 days'; $cron$);
