-- かぞく手帳: 契約の更新日のお知らせ（docs/contracts.md §6・§9 の PR2）
--
-- 更新日の N 日前（N は契約の notify_days）に、毎朝1回まとめて、その契約が見える人の端末へ通知する。
-- 購読情報(push_subscriptions)は予定のリマインダー(0012)・備蓄の期限(0058)などと同じものを使い、
-- Edge Function `send-contract-reminders` が送る。
--
-- 何を知らせるかは「更新日の N 日前の日が、前回送った日の翌日から今日までに来た契約」という
-- 日付の計算だけで決める（_shared/contractReminders.ts）ので、契約の行ごとの「知らせた」印は持たない。
-- 持つのは端末ごとの送信済み記録だけ（0058 の stock_expiry_deliveries と同じ形）。
--
-- ============================================================
-- 適用条件
-- ============================================================
-- 1. Edge Function `send-contract-reminders` がデプロイ済みであること
-- 2. Vault に共有シークレット reminder_cron_secret が登録済みであること
--    (予定のリマインダーと同じものを使うので、0013を適用済みなら追加の作業はない)
-- 手順の詳細は docs/notifications.md §14 を参照。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（mobile）を出す。
--   - 古いアプリは kind = 'contract' のお知らせを予定タブへ開くだけで、動作は変わらない
--
-- 流し方（CLAUDE.md「本番DBへの migration の適用」）:
--   - 3. の cron.unschedule は「削除」にあたる。本番に同名のジョブが無いことを確かめたうえで、
--     その文を外して MCP で適用する（このファイルはそのまま）。2回目以降に流し直すときのための文。
--   - 送信済み記録の掃除（0058 の purge-stock-expiry-deliveries にあたるもの）は作らない。
--     記録は「お知らせが出た朝」にしか増えず（1台につき年に数行）、掃除が要るほど溜まらない。
--     掃除の文は delete を含み、MCP では流せないため。溜まって困るようになったら足す。

-- ============================================================
-- 1. contract_deliveries: 送信済み記録
-- ============================================================
-- 同じ朝に二重に送らないよう (端末, 送った日) で一意にする。
-- 送った日(notify_on)は日本時間の日付。次の実行は、この日の翌日からの節目を拾う。
create table if not exists public.contract_deliveries (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions (id) on delete cascade,
  notify_on date not null,
  sent_at timestamptz not null default now(),
  -- pending は「送信を予約した」印。実際の送信前にこの行を作ることで、
  -- 定期実行が重なっても同じお知らせが二重に飛ばないようにしている。
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  error text,
  constraint contract_deliveries_subscription_day_key unique (subscription_id, notify_on)
);

comment on table public.contract_deliveries is
  '契約の更新日のお知らせの送信済み記録。status = sent の最後の notify_on の翌日からの節目を、次の実行が拾う。家族では共有しない。';

create index if not exists idx_contract_deliveries_family_id
  on public.contract_deliveries (family_id);
create index if not exists idx_contract_deliveries_sent_at
  on public.contract_deliveries (sent_at);

-- 送信記録は書き込みを Edge Function (service_role) に限定し、
-- 参照だけ自分の端末ぶんを許可する（通知が届かないときの確認用）。
alter table public.contract_deliveries enable row level security;

drop policy if exists "contract_deliveries_own_select" on public.contract_deliveries;
create policy "contract_deliveries_own_select" on public.contract_deliveries
  for select using (
    exists (
      select 1 from public.push_subscriptions s
      where s.id = contract_deliveries.subscription_id
        and s.user_id = (select auth.uid())
    )
  );

-- ============================================================
-- 2. 他の端末での変更の台帳の対象から外す（docs/sync.md）
-- ============================================================
-- 送信記録は端末ごとのもので、家族で共有しない。付け忘れの調べ（0078・0091）から外す。
create or replace function public.family_sync_missing()
returns setof text
language sql
stable
set search_path = public
as $fn$
  select c.relname::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and exists (
      select 1 from pg_attribute a
      where a.attrelid = c.oid and a.attname = 'family_id' and not a.attisdropped
    )
    and c.relname <> all (array[
      'family_sync', 'users', 'push_subscriptions', 'member_invites',
      'stock_expiry_deliveries', 'temperature_reminder_deliveries', 'money_feed_tokens',
      'contract_deliveries'
    ])
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and t.tgname = 'family_sync_ins' and not t.tgisinternal
    )
  order by 1;
$fn$;
revoke execute on function public.family_sync_missing() from public, anon, authenticated;

-- ============================================================
-- 3. 定期実行
-- ============================================================
-- 毎朝9時（日本時間）= 0時（UTC）。朝の用事を考える時間に届くようにする。
-- 拡張は0013で入れているが、この migration 単独でも通るようにしておく
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('send-contract-reminders')
 where exists (select 1 from cron.job where jobname = 'send-contract-reminders');

select cron.schedule(
  'send-contract-reminders',
  '0 0 * * *',
  $cron$
  select net.http_post(
    url := 'https://nbkpwjtkkiaklewtegzh.supabase.co/functions/v1/send-contract-reminders',
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
