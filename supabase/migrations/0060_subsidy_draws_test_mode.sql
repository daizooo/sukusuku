-- かぞく手帳: 補助くじの「テストモード」（確認用。docs/home.md §9）
--
-- 動作確認のために引いたくじ・券を、本物と分けて持ち、あとで消せるようにする。
--   - テストのくじ（is_test）は、月の回数に数えない・家族のお金の集計に入れない
--   - テストで出た券（is_test）も本物と別。本物のくじには使えず、本物の券もテストに使えない
--   - テストの行は、引いた本人にしか見えない（家族の履歴に出さない）
--   - 「テストデータを削除」（lottery_delete_my_test_data）で、自分のテストの行をまとめて消す
--
-- 適用の順序: 先にこれ（0059の適用後）を適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは is_test を知らないだけなので、適用しても今までどおり動く

-- ---------------------------------------------------------------------------
-- 1. 列
-- ---------------------------------------------------------------------------
alter table public.subsidy_draws add column if not exists is_test boolean not null default false;
alter table public.lottery_coupons add column if not exists is_test boolean not null default false;

comment on column public.subsidy_draws.is_test is
  '確認用のテストのくじ。月の回数・家族のお金の集計に入れず、引いた本人にだけ見える。docs/home.md §9。';
comment on column public.lottery_coupons.is_test is
  '確認用のテストで出た券。本物のくじには使えない。引いた本人にだけ見える。';

-- 図鑑の枠・日帰り旅行券は、本物とテストで別に数える。
drop index if exists public.uq_lottery_coupons_slot;
create unique index if not exists uq_lottery_coupons_slot
  on public.lottery_coupons (owner_id, is_test, cycle, slot) where slot is not null;
drop index if exists public.uq_lottery_coupons_trip;
create unique index if not exists uq_lottery_coupons_trip
  on public.lottery_coupons (owner_id, is_test, cycle) where kind = 'trip';

-- ---------------------------------------------------------------------------
-- 2. 引く前後の検査（テストは月の回数に数えない・本物の券と混ぜない）
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_draws_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  used integer;
begin
  new.drawn_at := now();
  new.rate_up_used := false;
  if not new.is_test then
    -- 同じ人の同時の複数回を並べて通さない。
    perform pg_advisory_xact_lock(hashtext('subsidy_draws:' || coalesce(new.drawn_by::text, '')));
    select count(*) into used
    from public.subsidy_draws
    where drawn_by is not distinct from new.drawn_by
      and not is_test
      and date_trunc('month', timezone('Asia/Tokyo', drawn_at)) = date_trunc('month', timezone('Asia/Tokyo', new.drawn_at));
    if used >= public.lottery_monthly_allowance(new.drawn_by, new.drawn_at) then
      raise exception '今月の補助くじの回数を使い切っています' using errcode = 'check_violation';
    end if;
  end if;
  if new.push_coupon_id is not null then
    perform 1 from public.lottery_coupons c
     where c.id = new.push_coupon_id
       and c.owner_id = new.drawn_by
       and c.is_test = new.is_test
       and c.kind = 'push'
       and c.used_at is null
       and (c.expires_at is null or c.expires_at > new.drawn_at)
     for update;
    if not found then
      raise exception 'ひと押し券が使えません' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$fn$;
revoke execute on function public.subsidy_draws_before_insert() from public, anon, authenticated;

create or replace function public.subsidy_draws_after_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.push_coupon_id is not null then
    update public.lottery_coupons
       set used_at = new.drawn_at, used_draw_id = new.id
     where id = new.push_coupon_id;
  end if;
  if new.rate = 25 and new.drawn_by is not null then
    insert into public.lottery_coupons (family_id, owner_id, kind, source_draw_id, obtained_at, is_test)
    values (new.family_id, new.drawn_by, 'push', new.id, new.drawn_at, new.is_test);
  end if;
  return new;
end;
$fn$;
revoke execute on function public.subsidy_draws_after_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 券の操作（テストのくじにはテストの券・本物には本物の券）
-- ---------------------------------------------------------------------------
create or replace function public.lottery_open_box(p_draw_id uuid)
returns setof public.lottery_coupons
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := auth.uid();
  draw public.subsidy_draws;
  cur_cycle integer;
  picked integer;
  collected integer;
  created public.lottery_coupons;
  trip public.lottery_coupons;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  select * into draw from public.subsidy_draws where id = p_draw_id and drawn_by = me and rate = 100;
  if not found then
    raise exception '100%%のくじではありません' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('lottery_box:' || me::text));
  if exists (select 1 from public.lottery_coupons where source_draw_id = p_draw_id and slot is not null) then
    raise exception 'この箱はもう開けています' using errcode = 'check_violation';
  end if;
  select 1 + count(*) into cur_cycle
  from public.lottery_coupons where owner_id = me and is_test = draw.is_test and kind = 'trip';
  select s into picked
  from generate_series(1, 6) s
  where s not in (
    select slot from public.lottery_coupons
     where owner_id = me and is_test = draw.is_test and cycle = cur_cycle and slot is not null
  )
  order by random()
  limit 1;
  insert into public.lottery_coupons (family_id, owner_id, kind, cycle, slot, source_draw_id, expires_at, is_test)
  values (
    draw.family_id, me,
    case picked when 1 then 'snack' when 2 then 'movie' when 3 then 'cafe' when 4 then 'picnic' else 'rate_up' end,
    cur_cycle, picked, p_draw_id, case when picked >= 5 then null else now() + interval '1 month' end,
    draw.is_test
  )
  returning * into created;
  return next created;
  select count(*) into collected
  from public.lottery_coupons
  where owner_id = me and is_test = draw.is_test and cycle = cur_cycle and slot is not null;
  if collected >= 6 then
    insert into public.lottery_coupons (family_id, owner_id, kind, cycle, source_draw_id, is_test)
    values (draw.family_id, me, 'trip', cur_cycle, p_draw_id, draw.is_test)
    returning * into trip;
    return next trip;
  end if;
  return;
end;
$fn$;
revoke execute on function public.lottery_open_box(uuid) from public, anon;
grant execute on function public.lottery_open_box(uuid) to authenticated;

create or replace function public.lottery_use_rate_up(p_draw_id uuid, p_coupon_id uuid)
returns public.subsidy_draws
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := auth.uid();
  draw public.subsidy_draws;
  new_rate integer;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  select * into draw from public.subsidy_draws
   where id = p_draw_id and drawn_by = me and not rate_up_used and rate in (25, 50)
     and drawn_at > now() - interval '1 day'
   for update;
  if not found then
    raise exception 'この結果には補助率アップ券を使えません' using errcode = 'check_violation';
  end if;
  perform 1 from public.lottery_coupons
   where id = p_coupon_id and owner_id = me and is_test = draw.is_test and kind = 'rate_up' and used_at is null
   for update;
  if not found then
    raise exception '補助率アップ券が使えません' using errcode = 'check_violation';
  end if;
  new_rate := draw.rate + 25;
  update public.lottery_coupons set used_at = now(), used_draw_id = p_draw_id where id = p_coupon_id;
  update public.subsidy_draws
     set rate = new_rate,
         rate_up_used = true,
         subsidy = ((price * new_rate + 5000) / 10000) * 100
   where id = p_draw_id
  returning * into draw;
  return draw;
end;
$fn$;
revoke execute on function public.lottery_use_rate_up(uuid, uuid) from public, anon;
grant execute on function public.lottery_use_rate_up(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. テストデータの削除
-- ---------------------------------------------------------------------------
-- 自分のテストの券とくじをまとめて消す。本物の行には触らない。消したくじの数を返す。
create or replace function public.lottery_delete_my_test_data()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := auth.uid();
  removed integer;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  delete from public.lottery_coupons where owner_id = me and is_test;
  with gone as (
    delete from public.subsidy_draws where drawn_by = me and is_test returning 1
  )
  select count(*) into removed from gone;
  return removed;
end;
$fn$;
revoke execute on function public.lottery_delete_my_test_data() from public, anon;
grant execute on function public.lottery_delete_my_test_data() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. 見える範囲（テストの行は引いた本人だけ）
-- ---------------------------------------------------------------------------
drop policy if exists "subsidy_draws_family_select" on public.subsidy_draws;
create policy "subsidy_draws_family_select" on public.subsidy_draws
  for select using (family_id = public.current_family_id() and (not is_test or drawn_by = auth.uid()));

drop policy if exists "lottery_coupons_family_select" on public.lottery_coupons;
create policy "lottery_coupons_family_select" on public.lottery_coupons
  for select using (family_id = public.current_family_id() and (not is_test or owner_id = auth.uid()));
