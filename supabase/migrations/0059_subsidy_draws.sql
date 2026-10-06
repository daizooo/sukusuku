-- かぞく手帳: 補助くじ（暮らしタブ。docs/home.md §9）
--
-- 家のルール: お小遣い制だが、趣味以外で必要なものを買うときは家族のお金から出す。
-- 迷いをなくすため、税込500〜3,000円の商品に限り、1人あたり月2回（誕生月は3回）まで、
-- 家族のお金から補助を出す。補助率はくじ（ガラポン）で決める（25%・50%・75%・100%。はずれなし）。
--
--   subsidy_draws   くじを引いた記録。1行＝1回
--   lottery_coupons くじで手に入る券（ひと押し券・補助率アップ券・100%の箱の特典）。アカウントごとに持つ
--
-- 確率・救済（なだらか救済・3連続ブレーカー・ラッキーカラー・貯福・月ならし）は、アプリ側
-- （subsidyLotteryUtils）で決めて記録する。ここでは、月の回数・金額・券の整合・引き直し防止を守る。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは新しい表を読まないだけなので、適用しても今までどおり動く

-- ---------------------------------------------------------------------------
-- 1. くじの記録
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_draws (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- 引いた人。アカウントが消えても記録は残す。
  drawn_by uuid references public.users (id) on delete set null,
  -- 買うもの（自由入力）。
  item_name text not null default '',
  -- 商品の税込価格（円）。500〜3,000円が対象。
  price integer not null check (price >= 500 and price <= 3000),
  -- 出た玉。white＝25%、blue＝50%、red＝75%、gold＝100%。
  ball text not null check (ball in ('white', 'blue', 'red', 'gold')),
  -- 補助率（％）。玉の率から、ラッキーカラー・補助率アップ券で1段上がることがある。
  rate integer not null check (rate in (25, 50, 75, 100)),
  -- 補助率アップ券を使ったか（結果を見てから使う。25%・50%の結果だけ）。
  rate_up_used boolean not null default false,
  -- このときに使うひと押し券（引く前に使う）。検証はトリガーで行う。
  push_coupon_id uuid,
  -- 家族のお金から出る額（円）。100%は商品代そのもの。それ以外は補助率をかけて100円単位
  -- （49円以下は切り下げ、50円以上は切り上げ）。
  subsidy integer not null,
  -- 引いた時刻（サーバーの時刻。トリガーで上書きする）。
  drawn_at timestamptz not null default now(),
  constraint subsidy_draws_ball_rate check (
    (ball = 'white' and rate in (25, 50, 75))
    or (ball = 'blue' and rate in (50, 75))
    or (ball = 'red' and rate in (75, 100))
    or (ball = 'gold' and rate = 100)
  ),
  constraint subsidy_draws_rate_up_range check (not rate_up_used or rate in (50, 75)),
  constraint subsidy_draws_subsidy_matches_rate check (
    subsidy = case when rate = 100 then price else ((price * rate + 5000) / 10000) * 100 end
  )
);

comment on table public.subsidy_draws is
  '補助くじを引いた記録。1行＝1回。1人あたり月2回（誕生月は3回）まで（日本時間の月）。docs/home.md §9。';
comment on column public.subsidy_draws.subsidy is
  '家族のお金から出る額（円）。100%は商品代そのもの。それ以外は補助率をかけて100円単位（四捨五入）。';

create index if not exists idx_subsidy_draws_family_drawn_at
  on public.subsidy_draws (family_id, drawn_at desc);
create index if not exists idx_subsidy_draws_drawn_by_drawn_at
  on public.subsidy_draws (drawn_by, drawn_at desc);

-- ---------------------------------------------------------------------------
-- 2. 券
-- ---------------------------------------------------------------------------
create table if not exists public.lottery_coupons (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  owner_id uuid not null references public.users (id) on delete cascade,
  -- push＝ひと押し券（25%が出るたびに1枚。次のガラポンで25%が出なくなる。期限なし）
  -- rate_up＝補助率アップ券（25%・50%の結果を1段上げる。期限なし）
  -- snack・movie・cafe・picnic＝100%の箱の小さな特典
  -- trip＝6つ集めたときの日帰り旅行券
  kind text not null check (kind in ('push', 'rate_up', 'snack', 'movie', 'cafe', 'picnic', 'trip')),
  -- 100%の箱（図鑑）で出た券だけ。cycle＝何周目か、slot＝図鑑の6つの枠。
  cycle integer,
  slot integer check (slot between 1 and 6),
  -- この券のもとになった、くじ（ひと押し券は25%の回、箱の券は100%の回）。
  source_draw_id uuid references public.subsidy_draws (id) on delete set null,
  obtained_at timestamptz not null default now(),
  -- 手に入れた日から1か月。ひと押し券・補助率アップ券（使うために買い物を探すことになるため）と、
  -- 日帰り旅行券は期限なし。
  expires_at timestamptz,
  used_at timestamptz,
  used_draw_id uuid references public.subsidy_draws (id) on delete set null,
  constraint lottery_coupons_expiry check ((kind in ('push', 'rate_up', 'trip')) = (expires_at is null)),
  constraint lottery_coupons_slot_cycle check (slot is null or cycle is not null),
  constraint lottery_coupons_slot_kind check (
    slot is null
    or kind = case slot when 1 then 'snack' when 2 then 'movie' when 3 then 'cafe' when 4 then 'picnic' else 'rate_up' end
  )
);

comment on table public.lottery_coupons is
  '補助くじで手に入る券。アカウントごとに持つ。書き込みは関数・トリガーだけ（docs/home.md §9）。';

create index if not exists idx_lottery_coupons_owner on public.lottery_coupons (owner_id, obtained_at desc);
-- 図鑑の同じ枠は、1周に1つだけ。
create unique index if not exists uq_lottery_coupons_slot
  on public.lottery_coupons (owner_id, cycle, slot) where slot is not null;
-- 日帰り旅行券は、1周に1枚だけ。
create unique index if not exists uq_lottery_coupons_trip
  on public.lottery_coupons (owner_id, cycle) where kind = 'trip';
-- 100%の1回につき、箱は1回だけ開けられる。
create unique index if not exists uq_lottery_coupons_box
  on public.lottery_coupons (source_draw_id) where slot is not null;

-- ---------------------------------------------------------------------------
-- 3. 月の回数
-- ---------------------------------------------------------------------------
-- 1人あたり月2回。誕生月だけ+1回（3回）。回数を変えるときは、アプリ側
-- （subsidyLotteryUtils の MONTHLY_LIMIT）と合わせる。
create or replace function public.lottery_monthly_allowance(p_user uuid, p_at timestamptz)
returns integer
language sql
security definer
set search_path = public
stable
as $fn$
  select 2 + case when exists (
    select 1 from public.family_members fm
     where fm.user_id = p_user
       and fm.birth_date is not null
       and extract(month from fm.birth_date) = extract(month from timezone('Asia/Tokyo', p_at))
  ) then 1 else 0 end;
$fn$;
revoke execute on function public.lottery_monthly_allowance(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. くじを引く前後の検査（トリガー）
-- ---------------------------------------------------------------------------
-- 引いた時刻はサーバーで決め、月の回数（日本時間）を超えたら断る。使うひと押し券も確かめる。
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
  -- 同じ人の同時の複数回を並べて通さない。
  perform pg_advisory_xact_lock(hashtext('subsidy_draws:' || coalesce(new.drawn_by::text, '')));
  select count(*) into used
  from public.subsidy_draws
  where drawn_by is not distinct from new.drawn_by
    and date_trunc('month', timezone('Asia/Tokyo', drawn_at)) = date_trunc('month', timezone('Asia/Tokyo', new.drawn_at));
  if used >= public.lottery_monthly_allowance(new.drawn_by, new.drawn_at) then
    raise exception '今月の補助くじの回数を使い切っています' using errcode = 'check_violation';
  end if;
  if new.push_coupon_id is not null then
    perform 1 from public.lottery_coupons c
     where c.id = new.push_coupon_id
       and c.owner_id = new.drawn_by
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

drop trigger if exists subsidy_draws_before_insert on public.subsidy_draws;
create trigger subsidy_draws_before_insert
  before insert on public.subsidy_draws
  for each row
  execute function public.subsidy_draws_before_insert();

-- 使ったひと押し券を使用済みにし、25%が出たらひと押し券を1枚渡す。
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
    insert into public.lottery_coupons (family_id, owner_id, kind, source_draw_id, obtained_at)
    values (new.family_id, new.drawn_by, 'push', new.id, new.drawn_at);
  end if;
  return new;
end;
$fn$;
revoke execute on function public.subsidy_draws_after_insert() from public, anon, authenticated;

drop trigger if exists subsidy_draws_after_insert on public.subsidy_draws;
create trigger subsidy_draws_after_insert
  after insert on public.subsidy_draws
  for each row
  execute function public.subsidy_draws_after_insert();

-- ---------------------------------------------------------------------------
-- 5. 券の操作（関数）
-- ---------------------------------------------------------------------------
-- 100%が出たら、3つの箱から1つ選んで開ける。中身は図鑑でまだ集めていない枠からランダムに1つ
-- （重複なし）。6つ目で日帰り旅行券も出て、図鑑は次の周に進む。
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
  select 1 + count(*) into cur_cycle from public.lottery_coupons where owner_id = me and kind = 'trip';
  select s into picked
  from generate_series(1, 6) s
  where s not in (
    select slot from public.lottery_coupons where owner_id = me and cycle = cur_cycle and slot is not null
  )
  order by random()
  limit 1;
  insert into public.lottery_coupons (family_id, owner_id, kind, cycle, slot, source_draw_id, expires_at)
  values (
    draw.family_id, me,
    case picked when 1 then 'snack' when 2 then 'movie' when 3 then 'cafe' when 4 then 'picnic' else 'rate_up' end,
    cur_cycle, picked, p_draw_id, case when picked >= 5 then null else now() + interval '1 month' end
  )
  returning * into created;
  return next created;
  select count(*) into collected
  from public.lottery_coupons where owner_id = me and cycle = cur_cycle and slot is not null;
  if collected >= 6 then
    insert into public.lottery_coupons (family_id, owner_id, kind, cycle, source_draw_id)
    values (draw.family_id, me, 'trip', cur_cycle, p_draw_id)
    returning * into trip;
    return next trip;
  end if;
  return;
end;
$fn$;
revoke execute on function public.lottery_open_box(uuid) from public, anon;
grant execute on function public.lottery_open_box(uuid) to authenticated;

-- 小さな特典の券・日帰り旅行券を使う（使用済みにする）。ひと押し券・補助率アップ券は、くじの画面で使う。
create or replace function public.lottery_use_coupon(p_coupon_id uuid)
returns public.lottery_coupons
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me uuid := auth.uid();
  result public.lottery_coupons;
begin
  if me is null then
    raise exception 'ログインが必要です' using errcode = 'insufficient_privilege';
  end if;
  update public.lottery_coupons
     set used_at = now()
   where id = p_coupon_id
     and owner_id = me
     and kind in ('snack', 'movie', 'cafe', 'picnic', 'trip')
     and used_at is null
     and (expires_at is null or expires_at > now())
  returning * into result;
  if not found then
    raise exception 'この券は使えません' using errcode = 'check_violation';
  end if;
  return result;
end;
$fn$;
revoke execute on function public.lottery_use_coupon(uuid) from public, anon;
grant execute on function public.lottery_use_coupon(uuid) to authenticated;

-- 補助率アップ券を使う。結果が25%か50%のくじを、1段上げる（75%・100%には使えない）。
-- くじを引いてから1日以内の分だけ（あとから前の買い物に使えないように）。
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
   where id = p_coupon_id and owner_id = me and kind = 'rate_up' and used_at is null
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
-- 6. 権限
-- ---------------------------------------------------------------------------
alter table public.subsidy_draws enable row level security;
alter table public.lottery_coupons enable row level security;

-- 家族みんなが履歴を見られる（アカウントごとに過去を見られる）。
create policy "subsidy_draws_family_select" on public.subsidy_draws
  for select using (family_id = public.current_family_id());

-- 引けるのは自分の分だけ。引いた記録は直せない・消せない（引き直しを防ぐ）ので、
-- update / delete の policy は置かない（補助率アップ券の反映は関数だけが行う）。
create policy "subsidy_draws_own_insert" on public.subsidy_draws
  for insert with check (family_id = public.current_family_id() and drawn_by = auth.uid());

-- 券は家族が見られる。書き込みは関数・トリガーだけ（policy を置かない）。
create policy "lottery_coupons_family_select" on public.lottery_coupons
  for select using (family_id = public.current_family_id());
