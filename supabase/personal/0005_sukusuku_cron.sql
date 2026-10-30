-- すくすくの定期実行（cron）を Persol に入れる。切り替えの日、旧プロジェクトの cron を止めるのと同時に流す
-- （先に入れると、旧プロジェクトと二重に通知が飛ぶ）。
--
-- 前提:
--   - Edge Functions を Persol にデプロイ済み（cron が呼ぶ URL がこのプロジェクトを指すため）
--   - Vault にこの名前で秘密を登録済み（値は Persol の Edge Function の REMINDER_CRON_SECRET と同じ）:
--       select vault.create_secret('<ランダムな文字列>', 'sukusuku_reminder_cron_secret');
-- 0002 で pg_cron・pg_net を有効にしてあること。スケジュールは旧本番の実際の値。

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
