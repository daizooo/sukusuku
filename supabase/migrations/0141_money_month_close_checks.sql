-- かぞく手帳: 月の締めを、ふたりで口座の残高を確かめる作業にする（docs/kakei.md §4.5。2026-10-24）
--
-- - 振り返りの「この月を締める」を押すと money_month_requests に押した時刻が入る。家族の保護者（is_guardian。夫婦）のアカウント全員が
--   5分以内に押すと、money_months.close_started_at が入って締めが始まる（request_money_month_close。時刻はサーバーの now()）
-- - 締めでは、口座ごとに、ひとりずつ「OK」を押す（money_month_wallet_checks）。押したときの額（銀行・財布は締めた日の残高、
--   カードはその月の利用）を amount に残し、今の額と違えば OK は外れたものとして扱う（記録を足す・直す・補正したとき）
-- - OK を外すのは amount を null にする（行は消さない）。「やめる」も requested_at を null にする
-- - 家族で共有するので attach_family_sync を呼ぶ
-- 削除を含む文は無い。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは新しい表・列を読まないだけで、今までどおり動く

alter table public.money_months
  add column if not exists close_started_at timestamptz;

comment on column public.money_months.close_started_at is
  '締めを始めた日時（保護者のアカウント全員が5分以内に「この月を締める」を押した）。null は始めていない。docs/kakei.md §4.5';

create table if not exists public.money_month_requests (
  family_id uuid not null references public.families (id) on delete cascade,
  -- その月の1日
  month date not null check (extract(day from month) = 1),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 「この月を締める」を押した日時。null は押していない（やめた）。5分を過ぎたものは数えない
  requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, month, user_id)
);

comment on table public.money_month_requests is
  '月の締めを始める合図（ひとりずつ）。全員が5分以内に押すと締めが始まる。docs/kakei.md §4.5';

alter table public.money_month_requests enable row level security;
create policy "money_month_requests_family_all" on public.money_month_requests
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.money_month_requests to authenticated;
grant all on public.money_month_requests to service_role;

create trigger money_month_requests_set_updated_at
  before update on public.money_month_requests
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_month_requests');

create table if not exists public.money_month_wallet_checks (
  family_id uuid not null references public.families (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  wallet_id uuid not null references public.money_wallets (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- OK を押したときの額（円）。null は OK していない（外した）
  amount bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (family_id, month, wallet_id, user_id)
);

comment on table public.money_month_wallet_checks is
  '月の締めで、口座ごと・ひとりずつの OK と、そのときの額。今の額と違えば OK は外れた扱い。docs/kakei.md §4.5';

alter table public.money_month_wallet_checks enable row level security;
create policy "money_month_wallet_checks_family_all" on public.money_month_wallet_checks
  for all using (family_id = public.current_family_id())
  with check (family_id = public.current_family_id());

grant select, insert, update, delete on public.money_month_wallet_checks to authenticated;
grant all on public.money_month_wallet_checks to service_role;

create trigger money_month_wallet_checks_set_updated_at
  before update on public.money_month_wallet_checks
  for each row
  execute function public.set_updated_at();

select public.attach_family_sync('public.money_month_wallet_checks');

-- 「この月を締める」を押す。押した時刻を入れ、保護者のアカウント全員が5分以内に押していれば締めを始める。
-- 返すのは { started: 始まったか, server_now: サーバーの今（アプリの残り時間を合わせる） }。
create or replace function public.request_money_month_close(p_month date)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_family uuid := public.current_family_id();
  v_members integer;
  v_pressed integer;
  v_started boolean := false;
begin
  if v_family is null or auth.uid() is null then
    raise exception 'not in a family';
  end if;
  if extract(day from p_month) <> 1 then
    raise exception 'month must be the first day';
  end if;

  insert into public.money_month_requests (family_id, month, user_id, requested_at)
  values (v_family, p_month, auth.uid(), now())
  on conflict (family_id, month, user_id) do update set requested_at = excluded.requested_at;

  select count(*) into v_members
    from public.family_members fm
   where fm.family_id = v_family and fm.user_id is not null and fm.is_guardian;

  select count(*) into v_pressed
    from public.money_month_requests r
   where r.family_id = v_family and r.month = p_month
     and r.requested_at is not null and r.requested_at >= now() - interval '5 minutes'
     and exists (select 1 from public.family_members fm
                  where fm.family_id = v_family and fm.user_id = r.user_id and fm.is_guardian);

  if v_pressed >= greatest(v_members, 1) then
    insert into public.money_months (family_id, month, close_started_at)
    values (v_family, p_month, now())
    on conflict (family_id, month) do update set close_started_at = now();
    -- 次に締めるときに、今回の合図を数えないよう空にする
    update public.money_month_requests
       set requested_at = null
     where family_id = v_family and month = p_month;
    v_started := true;
  end if;

  return jsonb_build_object('started', v_started, 'server_now', now());
end;
$function$;

revoke all on function public.request_money_month_close(date) from public, anon;
grant execute on function public.request_money_month_close(date) to authenticated;
