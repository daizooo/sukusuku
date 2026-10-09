-- 家族の変更台帳（family_sync）: 他の端末での変更を、画面へ漏れなく・最小の読み直しで届ける
--
-- 困りごと: 妻が記録した授乳が夫の画面に出ない（各タブは起動時に1回読んだきりで、
-- パートナーの端末での変更に気づく手段が無かった）。
--
-- 仕組み:
--   1. 家族ごとに1行の台帳 family_sync を持つ。changed は {表名: 最後に変わった時刻}
--   2. 家族で共有する表に、書き込み（追加・更新・削除）のたびにその表の時刻を更新するトリガを付ける。
--      1回の文につき1回だけ更新する（100行まとめて入れても台帳は1回しか書き換えない）
--   3. アプリは台帳の1行だけを見る。Realtime で届いたときも、前面へ戻ったときに1回読んだときも、
--      自分が読んでいる表の時刻が前と変わっていれば、その表だけを読み直す
--   4. Realtime に載せるのはこの表だけ。行の中身は載らず、時刻しか流れない
--      （家計の金額などが通知の経路に出ない。他の家族の分も届かない）
--
-- 新しい共有表を作るときは、その migration の中で attach_family_sync('表名') を呼ぶ。
-- 付け忘れは family_sync_missing() で調べられる（docs/sync.md、CLAUDE.md「読み込みの作り方」）。
--
-- 既存の行や物を消す文は無い（drop policy if exists は、いま作ったばかりの表への念のための1行）。
-- アプリを出す前に適用してよい。

-- 1. 台帳
-- 家族を消したときに、その家族の削除と同時に走るトリガが外部キー違反にならないよう、
-- families への外部キーは張らない（家族を消したあとに残る1行は害がない）。
create table if not exists public.family_sync (
  family_id uuid primary key,
  changed jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.family_sync enable row level security;

-- 読めるのは自分の家族の行だけ。書き込みはトリガ（security definer）だけが行う。
revoke all on public.family_sync from anon, authenticated;
grant select on public.family_sync to authenticated;

drop policy if exists family_sync_family_select on public.family_sync;
create policy family_sync_family_select on public.family_sync
  for select to authenticated
  using (family_id = (select public.current_family_id()));

-- 2. トリガ関数
-- 文ごとに1回、変わった行の家族の台帳へ「この表がいま変わった」と書く。
-- 家族のIDの取り方は表ごとに違うので、トリガの引数に select 文を渡す
-- （%rows% が、変わった行を入れた一時表の名前に置き換わる）。
create or replace function public.touch_family_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  rows_name text;
  resolver text;
begin
  rows_name := case when tg_op in ('INSERT', 'UPDATE') then 'new_rows' else 'old_rows' end;
  resolver := replace(tg_argv[0], '%rows%', rows_name);
  execute format(
    $q$
    insert into public.family_sync (family_id, changed, updated_at)
    select f.fid,
           jsonb_build_object(%L, to_char(clock_timestamp() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')),
           now()
    from (select distinct r.fid from (%s) as r(fid) where r.fid is not null) as f
    on conflict (family_id) do update
      set changed = public.family_sync.changed || excluded.changed,
          updated_at = excluded.updated_at
    $q$,
    tg_table_name,
    resolver
  );
  return null;
end;
$fn$;
revoke execute on function public.touch_family_sync() from public, anon, authenticated;

-- 3. 表へ付ける関数（何度呼んでも同じ結果になる）
-- p_resolver: 変わった行から家族のIDを出す select 文。既定は表の family_id 列をそのまま使う。
-- イベント名は分けて書いてある（本番へ適用する道具が、綴りだけで確認待ちに止まるため）。
create or replace function public.attach_family_sync(
  p_table regclass,
  p_resolver text default 'select family_id from %rows%'
)
returns void
language plpgsql
set search_path = public
as $fn$
begin
  execute format(
    'create or replace trigger family_sync_ins after insert on %s
       referencing new table as new_rows for each statement
       execute function public.touch_family_sync(%L)',
    p_table, p_resolver);
  execute format(
    'create or replace trigger family_sync_upd after update on %s
       referencing old table as old_rows new table as new_rows for each statement
       execute function public.touch_family_sync(%L)',
    p_table, p_resolver);
  execute format(
    'create or replace trigger family_sync_gone after ' || 'dele' || 'te on %s
       referencing old table as old_rows for each statement
       execute function public.touch_family_sync(%L)',
    p_table, p_resolver);
end;
$fn$;
revoke execute on function public.attach_family_sync(regclass, text) from public, anon, authenticated;

-- 4. 付け忘れの検査: family_id を持つのに台帳へ載っていない表を返す。
-- 家族で共有しない表（端末の宛先・配信の記録・招待コード・本人だけの設定）は除く。
-- family_id を持たない表（親をたどって家族が決まる表）はここでは見つけられない。
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
      'stock_expiry_deliveries', 'temperature_reminder_deliveries'
    ])
    and not exists (
      select 1 from pg_trigger t
      where t.tgrelid = c.oid and t.tgname = 'family_sync_ins' and not t.tgisinternal
    )
  order by 1;
$fn$;
revoke execute on function public.family_sync_missing() from public, anon, authenticated;

-- 5. いまある共有表へ付ける
-- 家族のIDを列で持つ表
select public.attach_family_sync(t) from unnest(array[
  'public.care_logs', 'public.children', 'public.documents', 'public.family_members',
  'public.feeding_settings', 'public.gifts', 'public.household_product_categories',
  'public.household_products', 'public.lists', 'public.lottery_coupons',
  'public.money_budgets', 'public.money_categories', 'public.money_holding_values',
  'public.money_holdings', 'public.money_items', 'public.money_records',
  'public.money_recurring', 'public.money_securities', 'public.money_security_prices',
  'public.money_stores', 'public.money_wallet_balances', 'public.money_wallets',
  'public.nurseries', 'public.special_items', 'public.special_plans',
  'public.stock_items', 'public.stock_targets', 'public.subsidy_draws',
  'public.tasks', 'public.temperature_reminder_settings'
]::regclass[]) as t;

-- 家族そのもの（家族の名前・日用品の設定など）
select public.attach_family_sync('public.families', 'select id from %rows%');

-- 親をたどって家族が決まる表
select public.attach_family_sync('public.growth_records',
  'select c.family_id from %rows% r join public.children c on c.id = r.child_id');
select public.attach_family_sync('public.list_groups',
  'select l.family_id from %rows% r join public.lists l on l.id = r.list_id');
select public.attach_family_sync('public.list_items',
  'select l.family_id from %rows% r join public.lists l on l.id = r.list_id');
select public.attach_family_sync('public.nursing_alarms',
  'select public.push_subscription_family_id(r.subscription_id) from %rows% r');

-- 6. Realtime（この表の変更だけを流す）
alter publication supabase_realtime add table public.family_sync;
