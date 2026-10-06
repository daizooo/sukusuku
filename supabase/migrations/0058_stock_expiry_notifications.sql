-- かぞく手帳: 備蓄の期限のお知らせ（暮らしタブ。docs/home.md §3.3・フェーズ3）
--
-- 期限の3か月前・1か月前に、毎朝1回まとめて家族の全端末へ通知する。
-- 購読情報(push_subscriptions)は予定のリマインダー(0012)などと同じものを使い、
-- Edge Function `send-stock-expiry-reminders` が送る。
--
-- 何を知らせるかは「期限の3か月前の日・1か月前の日が、前回送った日の翌日から今日までに来た
-- 備蓄」という日付の計算だけで決める（_shared/stockExpiry.ts）ので、備蓄の行ごとの
-- 「知らせた」印は持たない。持つのは端末ごとの送信済み記録だけ。
--
-- ============================================================
-- 適用条件
-- ============================================================
-- 1. Edge Function `send-stock-expiry-reminders` がデプロイ済みであること
-- 2. Vault に共有シークレット reminder_cron_secret が登録済みであること
--    (予定のリマインダーと同じものを使うので、0013を適用済みなら追加の作業はない)
-- 手順の詳細は docs/notifications.md を参照。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（mobile）を出す。
--   - 古いアプリは kind = 'stock' のお知らせを予定タブへ開くだけで、動作は変わらない

-- ============================================================
-- 1. stock_expiry_deliveries: 送信済み記録
-- ============================================================
-- 同じ朝に二重に送らないよう (端末, 送った日) で一意にする。
-- 送った日(notify_on)は日本時間の日付。次の実行は、この日の翌日からの節目を拾う。
create table if not exists public.stock_expiry_deliveries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  notify_on date not null,
  sent_at timestamptz not null default now(),
  -- pending は「送信を予約した」印。実際の送信前にこの行を作ることで、
  -- 定期実行が重なっても同じお知らせが二重に飛ばないようにしている。
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  constraint stock_expiry_deliveries_subscription_day_key unique (subscription_id, notify_on)
);

comment on table public.stock_expiry_deliveries is
  '備蓄の期限のお知らせの送信済み記録。status = sent の最後の notify_on の翌日からの節目を、次の実行が拾う。';

create index if not exists idx_stock_expiry_deliveries_family_id
  on public.stock_expiry_deliveries (family_id);
-- 古い記録の掃除用
create index if not exists idx_stock_expiry_deliveries_sent_at
  on public.stock_expiry_deliveries (sent_at);

-- 送信記録は書き込みを Edge Function (service_role) に限定し、
-- 参照だけ自分の端末ぶんを許可する（通知が届かないときの確認用）。
alter table public.stock_expiry_deliveries enable row level security;

drop policy if exists "stock_expiry_deliveries_own_select" on public.stock_expiry_deliveries;
create policy "stock_expiry_deliveries_own_select" on public.stock_expiry_deliveries
  for select using (
    exists (
      select 1 from public.push_subscriptions s
      where s.id = stock_expiry_deliveries.subscription_id
        and s.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 2. 定期実行
-- ============================================================
-- 毎朝9時（日本時間）= 0時（UTC）。朝の用事を考える時間に届くようにする。
-- 拡張は0013で入れているが、この migration 単独でも通るようにしておく
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('send-stock-expiry-reminders')
 where exists (select 1 from cron.job where jobname = 'send-stock-expiry-reminders');

select cron.schedule(
  'send-stock-expiry-reminders',
  '0 0 * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/send-stock-expiry-reminders',
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
-- 3. 送信記録の掃除
-- ============================================================
-- 送信済み記録は「どの日まで送ったか」を知るためだけに使う。拾いなおしの幅（数日）より
-- 十分長く残せばよいので、他のお知らせの掃除と同じ90日にする。
select cron.unschedule('purge-stock-expiry-deliveries')
 where exists (select 1 from cron.job where jobname = 'purge-stock-expiry-deliveries');

select cron.schedule(
  'purge-stock-expiry-deliveries',
  '55 4 * * 0',
  $cron$
  delete from public.stock_expiry_deliveries where sent_at < now() - interval '90 days';
  $cron$
);
