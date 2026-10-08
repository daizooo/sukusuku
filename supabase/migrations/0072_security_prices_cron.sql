-- かぞく手帳: 証券の価格を毎朝取る（docs/kakei.md §9.2.1）
--
-- pg_cron から毎朝、日本時間7時5分（UTC 22時5分）に Edge Function fetch-security-prices を呼ぶ。
-- 米国市場の終値と、前の営業日の夜に出た投信の基準価額がそろう時刻。
-- 関数は価格と為替を入れ、今日の評価額の行を作る（refresh_money_holding_values）。
-- 認証は、予定のリマインダーと同じ共有シークレット（vault の reminder_cron_secret）。
--
-- 適用の順序: Edge Function fetch-security-prices を出してから、これを適用する。

select cron.unschedule('fetch-security-prices')
 where exists (select 1 from cron.job where jobname = 'fetch-security-prices');

select cron.schedule(
  'fetch-security-prices',
  '5 22 * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/fetch-security-prices',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-reminder-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'reminder_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $cron$
);
