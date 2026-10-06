-- かぞく手帳: 補助くじ（暮らしタブ。docs/home.md §9）
--
-- 家のルール: お小遣い制だが、趣味以外で必要なものを買うときは家族のお金から出す。
-- 迷いをなくすため、税込3,000円未満の商品に限り、1人あたり月2回まで家族のお金から補助を出す。
-- 補助はくじで決める（0円・1,000円・2,000円・全額。小銭を増やさないため100円単位にしない）。
-- この表は「くじを引いた記録」で、1行＝1回。家族のお金から出た額（subsidy）もここから数える。
--
-- 適用の順序: 先にこれを適用し、そのあとにアプリ（PWA・mobile）を出す。
--   - 古いアプリは subsidy_draws を読まないだけなので、適用しても今までどおり動く

create table if not exists public.subsidy_draws (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  -- 引いた人。アカウントが消えても記録（家族のお金の出入り）は残す。
  drawn_by uuid references public.users (id) on delete set null,
  -- 買うもの（自由入力）。
  item_name text not null default '',
  -- 商品の税込価格（円）。3,000円未満が対象。
  price integer not null check (price >= 1 and price < 3000),
  -- 出た玉。white＝ティッシュ賞（0円）、blue＝ちょい助け賞（1,000円）、
  -- red＝大助かり賞（2,000円）、gold＝福の神賞（全額）。
  prize text not null check (prize in ('white', 'blue', 'red', 'gold')),
  -- 実際に家族のお金から出る額（円）。玉の額が商品代を超えるときは商品代まで。
  subsidy integer not null check (subsidy >= 0),
  -- 引いた時刻（サーバーの時刻。トリガーで上書きする）。
  drawn_at timestamptz not null default now(),
  constraint subsidy_draws_subsidy_matches_prize check (
    subsidy = case prize
      when 'white' then 0
      when 'blue' then least(1000, price)
      when 'red' then least(2000, price)
      else price
    end
  )
);

comment on table public.subsidy_draws is
  '補助くじを引いた記録。1行＝1回。1人あたり月2回まで（日本時間の月）。docs/home.md §9。';
comment on column public.subsidy_draws.subsidy is
  '家族のお金から出る額（円）。玉の額が商品代を超えるときは商品代まで。';

create index if not exists idx_subsidy_draws_family_drawn_at
  on public.subsidy_draws (family_id, drawn_at desc);
create index if not exists idx_subsidy_draws_drawn_by_drawn_at
  on public.subsidy_draws (drawn_by, drawn_at desc);

-- 引いた時刻はサーバーで決め、1人あたり月2回（日本時間）を超えたら断る。
-- アプリでも残りの回数を出すが、画面の古い表示で引き直せないよう、ここでも守る。
-- 回数を変えるときは、アプリ側（subsidyLotteryUtils の MONTHLY_LIMIT）と合わせる。
create or replace function public.subsidy_draws_before_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  used integer;
begin
  new.drawn_at := now();
  -- 同じ人の同時の2回を並べて通さない。
  perform pg_advisory_xact_lock(hashtext('subsidy_draws:' || coalesce(new.drawn_by::text, '')));
  select count(*) into used
  from public.subsidy_draws
  where drawn_by is not distinct from new.drawn_by
    and date_trunc('month', timezone('Asia/Tokyo', drawn_at)) = date_trunc('month', timezone('Asia/Tokyo', new.drawn_at));
  if used >= 2 then
    raise exception '今月の補助くじは2回までです' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger subsidy_draws_before_insert
  before insert on public.subsidy_draws
  for each row
  execute function public.subsidy_draws_before_insert();

alter table public.subsidy_draws enable row level security;

-- 家族みんなが履歴を見られる（誰がいくら補助を受けたかは家族のお金の話）。
create policy "subsidy_draws_family_select" on public.subsidy_draws
  for select using (family_id = public.current_family_id());

-- 引けるのは自分の分だけ。引いた記録は直さない・消さない（引き直しを防ぐ）ので、
-- update / delete の policy は置かない。
create policy "subsidy_draws_own_insert" on public.subsidy_draws
  for insert with check (family_id = public.current_family_id() and drawn_by = auth.uid());
